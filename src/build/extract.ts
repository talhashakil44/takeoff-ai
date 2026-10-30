import { recoverFacadeOpenings, rejectUnsupportedCurtainWalls } from './facades';
import { imperialDatumEvidence } from './datumEvidence';
import { quarantineDetachedSheets } from './placementQuality';
import { recoverRoof, type DrawingLines } from './roof';
import { simpleRing } from './surface';
import {
  addBuilding,
  cutOpenings,
  registerSheets,
  levelDatums,
  type DrawingTexts,
} from "./building";
import type { Measurement, Project, Sheet, TakeoffType } from '../model';
import { measurementVars, primaryOf, primaryUnit } from '../quantities';
import { wordsOf, type SpecSection } from '../spec/parse';
import type { Basis, BuildEdits, BuildElement, BuildModel, ElementShape, Issue, Level, SourceRef } from './types';

/**
 * The proposed building, from the takeoff: every measurement becomes an element of its work
 * package (trade), on its level, at its place on the plan, linked to its type, its spec sections
 * and the sheet it was measured on. What can't be placed honestly (an enlarged plan, an
 * unscaled sheet, a sheet whose level isn't known) is listed with the reason and not drawn.
 */

export const MODEL_VERSION = 8;

export interface Trade {
  key: string;
  name: string;
  /** Where it falls in the usual order of work on a floor (lower first). */
  order: number;
  colour: string;
}

export const TRADES: Trade[] = [
  { key: 'demolition', name: 'Demolition', order: 1, colour: '#ff6b6b' },
  { key: 'structure', name: 'Structure & masonry', order: 2, colour: '#ffb340' },
  { key: 'envelope', name: 'Roofing & envelope', order: 2, colour: '#c8a27a' },
  { key: 'mech-rough', name: 'Mechanical & plumbing rough-in', order: 3, colour: '#3ddc84' },
  { key: 'elec-rough', name: 'Electrical rough-in', order: 3, colour: '#ffd60a' },
  { key: 'fire-rough', name: 'Fire protection piping', order: 3, colour: '#ff6b6b' },
  { key: 'partitions', name: 'Partitions & framing', order: 4, colour: '#4da3ff' },
  { key: 'ceilings', name: 'Ceilings', order: 5, colour: '#9d8cff' },
  { key: 'doors', name: 'Doors, frames, windows & hardware', order: 6, colour: '#ff9f43' },
  { key: 'painting', name: 'Painting', order: 6, colour: '#6fe3c5' },
  { key: 'flooring', name: 'Flooring', order: 7, colour: '#c58cff' },
  { key: 'finishes', name: 'Other finishes', order: 7, colour: '#8fd0ff' },
  { key: 'specialties', name: 'Specialties & millwork', order: 8, colour: '#e3a35b' },
  { key: 'mech-trim', name: 'Mechanical & plumbing fixtures', order: 8, colour: '#5be3b0' },
  { key: 'elec-trim', name: 'Electrical fixtures & devices', order: 8, colour: '#ffe066' },
  { key: 'fire-heads', name: 'Sprinkler heads & fire devices', order: 8, colour: '#ff8a80' },
  { key: 'site', name: 'Site work', order: 2, colour: '#a3e35b' },
  { key: 'other', name: 'Other work', order: 6, colour: '#b8c4ff' },
];
export const tradeByKey = new Map(TRADES.map((t) => [t.key, t]));

/** The estimate division's number: "09 Finishes" → 9, "20-25 Mechanical" → 20. */
const divNum = (division?: string) => parseInt(/^\s*(\d{1,2})/.exec(division ?? '')?.[1] ?? '', 10);

/** Which work package a takeoff type belongs to, from its division, kind and name. */
export function tradeOf(type: TakeoffType): string {
  const d = divNum(type.division);
  const name = `${type.name} ${type.assemblyTitle ?? ''}`.toLowerCase();
  if (d === 2) return 'demolition';
  if (/\bdemo(lition|lish)?\b|\bremove\b|\bexisting to be removed\b/.test(name)) return 'demolition';
  if (d === 3 || d === 4 || d === 5) return 'structure';
  if (d === 7) return /roof|membrane|flashing|eaves|soffit|siding|cladding|air barrier|vapour/.test(name) ? 'envelope' : 'finishes';
  if (d === 8) return 'doors';
  if (d === 21 || /sprinkler|standpipe|fire pump|fire protection/.test(name)) return type.kind === 'count' ? 'fire-heads' : 'fire-rough';
  if (d >= 20 && d <= 25) return type.kind === 'count' ? 'mech-trim' : 'mech-rough';
  if (d >= 26 && d <= 28) return type.kind === 'count' ? 'elec-trim' : 'elec-rough';
  if (d >= 31 && d <= 33) return 'site';
  if (d === 10 || d === 11 || d === 12) return 'specialties';
  if (!d && type.kind === 'linear' && !/duct|pipe|conduit|cable|tray|sprinkler/.test(name)) return /\bfw|foundation|footing|grade beam/.test(name) ? 'structure' : 'partitions';
  if (d === 6 || d === 9 || !d) {
    if (/ceil|\bact\b|t-bar|bulkhead|acoustic(al)? (tile|panel)/.test(name)) return 'ceilings';
    if (/paint|coating|stain/.test(name)) return 'painting';
    if (type.kind === 'area' && /floor|carpet|tile|vinyl|\blvt\b|\bvct\b|resilient|epoxy|rubber|terrazzo|sealed concrete|sheet/.test(name)) return 'flooring';
    if (type.kind === 'linear' && /wall|partition|stud|gyp|\bgb\b|board|furring|demis|framing/.test(name)) return 'partitions';
    if (d === 6) return /millwork|casework|cabinet|counter/.test(name) ? 'specialties' : 'partitions';
    if (d === 9) return type.kind === 'linear' ? 'partitions' : 'finishes';
  }
  return 'other';
}

/** The level a sheet is of, from its title (or its title block's words): a number, or a word to resolve. */
export function levelWords(text: string): { num?: number; word?: string } {
  const t = text.toUpperCase();
  const n = /\bLEVEL\s*(\d{1,2})\b/.exec(t) ?? /\b(\d)(?:ST|ND|RD|TH)\s+(?:FLOOR|LEVEL)\b/.exec(t);
  const ord: Record<string, number> = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6 };
  const o = /\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH)\s+(?:FLOOR|LEVEL|STOREY)\b/.exec(t);
  const word = /\bROOF\b/.test(t) ? 'roof' : /\bFOUNDATION|FOOTING\b/.test(t) ? 'foundation' : /\b(BASEMENT|CELLAR|BELOW GRADE|LOWER)\b/.test(t) ? 'lower' : /\b(MAIN|GROUND)\b/.test(t) ? 'main' : /\bMEZZANINE\b/.test(t) ? 'mezzanine' : undefined;
  return { ...(n ? { num: parseInt(n[1], 10) } : o ? { num: ord[o[1]] } : {}), ...(word ? { word } : {}) };
}

/**
 * The title block's words (bottom-right of the sheet), for a sheet whose title doesn't say
 * its level: "LOWER LEVEL PLAN - PIPING" is often only there in full.
 */
export function titleBlockWords(texts: { str: string; cx: number; cy: number }[], width: number, height: number): string {
  return texts
    .filter((t) => t.cx > width * 0.72 && t.cy > height * 0.6)
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
    .map((t) => t.str)
    .join(' ')
    .slice(0, 1500);
}

/** Plan sheets only carry a place on the building: not elevations, sections, details or schedules. */
export const isPlan = (s: Sheet) => !/ELEVATION|SECTION|DETAIL|SCHEDULE|LEGEND|DIAGRAM|RISER|MILLWORK/i.test(s.title ?? '') || /PLAN/i.test(s.title ?? '');

const isEnlarged = (s: Sheet) => /ENLARGED|PART PLAN|PARTIAL PLAN|ENLARGEMENT/i.test(s.title ?? '');

export interface ExtractInput {
  project: Project;
  sections: SpecSection[];
  /** Words from a sheet's title block, for sheets whose title doesn't say the level. */
  levelHints?: Record<string, string>;
  drawingTexts?: DrawingTexts;
  drawingLines?: DrawingLines;
  edits?: BuildEdits;
  /** Metres between floors (a planning assumption unless documented). */
  floorToFloor: number;
}

const FT = 0.3048;

export function hashOf(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** What the model depends on, so a change to any of it marks the model stale. */
export function sourceHashOf(input: ExtractInput): string {
  const p = input.project;
  const parts = [
    MODEL_VERSION,
    JSON.stringify(p.sheets),
    JSON.stringify(p.types),
    JSON.stringify(p.measurements),
    JSON.stringify(input.sections),
    JSON.stringify(input.edits?.levels),
    JSON.stringify(input.edits?.elevations),
    JSON.stringify(input.levelHints),
    JSON.stringify(input.drawingTexts),
    JSON.stringify(input.drawingLines),
    p.units,
    input.floorToFloor,
  ];
  return hashOf(parts.join('|'));
}

/** Spec sections a type is governed by: same division, sharing words with its name. */
function specsFor(type: TakeoffType, sections: SpecSection[]): { key: string; basis: Basis }[] {
  const d = divNum(type.division);
  if (!d) return [];
  const inDiv = (s: SpecSection) => {
    const sd = parseInt(s.division, 10);
    if (d >= 20 && d <= 25) return sd >= 20 && sd <= 25;
    if (d >= 26 && d <= 28) return sd >= 26 && sd <= 28;
    return sd === d;
  };
  // Drawings abbreviate what specs spell out.
  const ABBR: [RegExp, string][] = [
    [/\b(G\.?W\.?B|GB|GYP)\b/gi, ' gypsum board '],
    [/\bACT\b/g, ' acoustical ceiling tile panel '],
    [/\bHM\b/g, ' hollow metal '],
    [/\bCMU\b/g, ' concrete masonry unit '],
    [/\bVCT\b/g, ' vinyl composition tile resilient '],
    [/\bLVT\b/g, ' luxury vinyl tile resilient '],
    [/\bSAFB\b/g, ' insulation '],
    [/\bRB\b/g, ' resilient base '],
    [/\bPT\b/g, ' paint '],
    [/\bEPX?\b/g, ' epoxy '],
    [/\bRCP\b/g, ' ceiling '],
  ];
  let text = `${type.name} ${type.assemblyTitle ?? ''} ${type.description ?? ''}`;
  for (const [re, w] of ABBR) text = text.replace(re, w);
  const words = new Set(wordsOf(text));
  // Sections listed but not issued count too: the link is real, the missing section an issue.
  const pool = sections.filter((s) => inDiv(s));
  const scored = pool
    .map((s) => ({ s, score: wordsOf(s.title).filter((w) => words.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (scored.length) return scored.map((x) => ({ key: x.s.key, basis: 'inferred' as Basis }));
  // Nothing in common by name: the division's sections for this kind of work.
  const KIND: Record<string, RegExp> = {
    partitions: /GYPSUM|STUD|FRAMING|PARTITION|BOARD/i,
    ceilings: /CEILING|ACOUSTIC/i,
    doors: /DOOR|FRAME|HARDWARE|WINDOW|GLAZING|OPENING/i,
    flooring: /FLOOR|TILE|CARPET|RESILIENT|BASE/i,
    painting: /PAINT|COATING/i,
    demolition: /DEMOLITION|REMOVAL|ABATEMENT/i,
  };
  const re = KIND[tradeOf(type)];
  if (!re) return [];
  return pool
    .filter((s) => re.test(s.title))
    .slice(0, 3)
    .map((s) => ({ key: s.key, basis: 'inferred' as Basis }));
}

export function extractModel(input: ExtractInput): BuildModel {
  const { project, sections, edits } = input;
  const units = project.units;
  const toM = (v: number) => (units === 'imperial' ? v * FT : v);
  const issues: Issue[] = [];
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  const types = new Map(project.types.map((t) => [t.id, t]));
  const used = new Map<string, Measurement[]>();
  for (const m of project.measurements) used.set(m.sheetId, [...(used.get(m.sheetId) ?? []), m]);

  // Levels: from each measured plan sheet's title (or title block), numbers and words resolved together.
  const parsed = new Map<string, { num?: number; word?: string; basis: Basis; from: string }>();
  for (const sid of new Set([
    ...used.keys(),
    ...Object.keys(input.drawingTexts ?? {}),
  ])) {
    const s = sheets.get(sid);
    if (!s || s.superseded || (!used.has(sid) && (!isPlan(s) || isEnlarged(s)))) continue;
    const byHand = edits?.levels?.[sid];
    if (byHand) {
      parsed.set(sid, { word: `id:${byHand}`, basis: 'assumed', from: 'set by you' });
      continue;
    }
    const fromTitle = levelWords(s.title ?? '');
    const fromHint = input.levelHints?.[sid] ? levelWords(input.levelHints[sid]) : {};
    const got = fromTitle.num !== undefined || fromTitle.word ? fromTitle : fromHint;
    if (got.num !== undefined || got.word) parsed.set(sid, { ...got, basis: 'inferred', from: got === fromTitle ? `sheet title “${s.title}”` : 'its title block' });
  }
  // "LEVEL 1 (LOWER)" says what LOWER means on this job.
  const alias = new Map<string, number>();
  for (const p of parsed.values()) if (p.from.startsWith('sheet title') && p.num !== undefined && p.word && ["main", "lower", "mezzanine"].includes(p.word)) alias.set(p.word, p.num);
  const resolve = (p: { num?: number; word?: string }): string | null => {
    if (p.word?.startsWith('id:')) return p.word.slice(3);
    if (p.word === 'roof') return 'roof';
    if (p.num !== undefined) return `L${p.num}`;
    if (p.word && alias.has(p.word)) return `L${alias.get(p.word)}`;
    // Without the drawings saying otherwise: the ground (main) floor is Level 1, below it Level 0.
    if (p.word === 'main') return 'L1';
    if (p.word === 'lower') return alias.has('main') ? `L${alias.get('main')! - 1}` : 'L0';
    if (p.word === 'foundation') return 'fdn';
    if (p.word === 'mezzanine') return 'mezz';
    return null;
  };
  const levelOfSheet = new Map<string, { id: string; basis: Basis; from: string }>();
  for (const [sid, p] of parsed) {
    const id = resolve(p);
    if (id) levelOfSheet.set(sid, { id, basis: p.basis, from: p.from });
  }
  // The levels, bottom up, at the floor-to-floor height unless set.
  const ids = [...new Set([...levelOfSheet.values()].map((x) => x.id))];
  const rank = (id: string) => (id === 'roof' ? 1e3 : id === 'mezz' ? 1.5 : id === 'fdn' ? -1e3 : parseFloat(id.replace(/^L/, '')) || 0);
  ids.sort((a, b) => rank(a) - rank(b));
  const levels: Level[] = [];
  const datums = levelDatums(project, input.drawingTexts ?? {});
  const wingDatums = imperialDatumEvidence(project, input.drawingTexts ?? {});
  const splitLevels = new Set<string>();
  for (const id of new Set(wingDatums.map(d=>d.level))) {
    const evidence=wingDatums.filter(d=>d.level===id).sort((a,b)=>b.count-a.count);
    datums[id]=evidence[0].elevation;
    if(evidence.some(d=>Math.abs(d.elevation-evidence[0].elevation)>.05)) {
      splitLevels.add(id);
      issues.push({id:`split-datum:${id}`,severity:'warning',text:`${id}: split-level evidence — ${evidence.map(d=>`${d.zone} ${d.elevation.toFixed(3)} m`).join('; ')}. Using ${evidence[0].zone} as the reference storey; wing boundaries must be mapped before claiming coordinated geometry.`,sources:evidence.flatMap(d=>d.sources)});
    }
  }
  let z = 0;
  for (const id of ids) {
    const set = edits?.elevations?.[id];
    // Foundations sit just under the lowest floor; it stays at 0.
    const elevation = set ?? datums[id] ?? (id === 'fdn' ? -1.2 : z);
    levels.push({
      id,
      name: id === 'roof' ? 'Roof' : id === 'mezz' ? 'Mezzanine' : id === 'fdn' ? 'Foundation' : `Level ${id.slice(1)}`,
      elevation,
      basis: set !== undefined ? 'assumed' : splitLevels.has(id) ? 'inferred' : datums[id] !== undefined
            ? "documented"
            : levels.length ? 'assumed' : 'inferred',
      sheets: [...levelOfSheet].filter(([, l]) => l.id === id).map(([sid]) => sid),
    });
    z = id === 'fdn' ? 0 : elevation + input.floorToFloor;
  }
  const levelById = new Map(levels.map((l) => [l.id, l]));

  // Placement: plan sheets at the set's main plan scale are placed by their position on the
  // page (CAD sets keep each floor's plan in one place on its sheet). Enlarged plans are not.
  const scales = new Map<number, number>();
  for (const [sid, ms] of used) {
    const s = sheets.get(sid);
    if (s?.metersPerPoint && isPlan(s) && !isEnlarged(s)) scales.set(Math.round(s.metersPerPoint * 1e5), (scales.get(Math.round(s.metersPerPoint * 1e5)) ?? 0) + ms.length);
  }
  const mainScale = [...scales].sort((a, b) => b[1] - a[1])[0]?.[0];
  const registration = registerSheets(project, input.drawingTexts ?? {});
  const placeable = (s: Sheet) => !!s.metersPerPoint && isPlan(s) && !isEnlarged(s) && (Math.round(s.metersPerPoint * 1e5) === mainScale || !!registration[s.id]) && levelOfSheet.has(s.id);
  const unplaced = new Map<string, string>();

  const specCache = new Map<string, { key: string; basis: Basis }[]>();
  const missingSec = new Map(sections.filter((s) => s.missing).map((s) => [s.key, `${s.number} ${s.title}`]));
  const elements: BuildElement[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of project.measurements) {
    const s = sheets.get(m.sheetId);
    const type = types.get(m.typeId);
    if (!s || !type || s.superseded) continue;
    const classifiedTrade = tradeOf(type);
    const trade = type.kind === 'area' && m.ceilingHeight && classifiedTrade !== 'demolition' ? 'ceilings' : classifiedTrade;
    const lv = levelOfSheet.get(s.id);
    const level = lv ? levelById.get(lv.id) ?? null : null;
    const vars = measurementVars(m, type, s, units);
    const quantity = vars ? primaryOf(type.kind, vars) : 0;
    const xs = m.points.map((p) => p[0]);
    const ys = m.points.map((p) => p[1]);
    const box: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const src: SourceRef = { kind: 'sheet', id: s.id, page: s.page, label: s.name, box };
    const elIssues: string[] = [];
    let shape: ElementShape | null = null;
    let placement: Basis = 'unknown';
    if (!s.metersPerPoint) {
      elIssues.push(`${s.name} has no scale: its quantity and place are unknown.`);
      unplaced.set(s.id, 'no scale');
    } else if (!isPlan(s)) {
      elIssues.push(`Measured on ${s.name} (${s.title ?? 'not a plan'}): not a plan, so its place on the building is not known.`);
      unplaced.set(s.id, 'not a plan');
    } else if (isEnlarged(s)) {
      elIssues.push(`Measured on an enlarged plan (${s.name}): where it sits on the floor isn't recovered yet.`);
      unplaced.set(s.id, 'enlarged plan');
    } else if (!level) {
      elIssues.push(`The level of ${s.name} (${s.title ?? ''}) isn't known: set it in Build setup.`);
      unplaced.set(s.id, 'level unknown');
    } else if (!placeable(s)) {
      elIssues.push(`${s.name} is at another scale than the main plans: not placed with them.`);
      unplaced.set(s.id, 'other scale');
    } else {
      placement = 'inferred';
      const k = s.metersPerPoint;
      const reg = registration[s.id];
      const transform = (p: [number, number]): [number, number] => [
        (p[0] * Math.cos(reg?.rotation ?? 0) - p[1] * Math.sin(reg?.rotation ?? 0)) * k - (reg?.x ?? 0),
        (p[0] * Math.sin(reg?.rotation ?? 0) + p[1] * Math.cos(reg?.rotation ?? 0)) * k - (reg?.y ?? 0),
      ];
      const pts = m.points.map(transform);
      const ceil = level.elevation + (m.ceilingHeight ? toM(m.ceilingHeight) : Math.max(2.4, input.floorToFloor - 0.6));
      const storeyHeight =
        (levels.find((l) => l.elevation > level.elevation)?.elevation ??
          level.elevation + input.floorToFloor) - level.elevation;
      const typeH = type.height > 0 ? toM(type.height) : 0;
      if (type.kind === 'linear') {
        if (trade === 'mech-rough') shape = { type: 'run', points: pts, z0: ceil - 0.05, height: 0.3, thickness: 0.3 };
        else if (trade === 'fire-rough') shape = { type: 'run', points: pts, z0: ceil + 0.2, height: 0.1, thickness: 0.1 };
        else if (trade === 'elec-rough') shape = { type: 'run', points: pts, z0: ceil + 0.1, height: 0.06, thickness: 0.06 };
        else shape = { type: 'run', points: pts, z0: level.elevation, height: /to ceiling/i.test(type.description ?? "")
              ? ceil - level.elevation
              : storeyHeight, thickness: type.thickness ? toM(type.thickness) : 0.15 };
      } else if (type.kind === 'area') {
        const holes = m.holes.map((h) => h.map(transform));
        const zz = trade === 'ceilings' ? m.ceilingHeight
              ? level.elevation + toM(m.ceilingHeight)
              : level.elevation + (typeH > 0 && typeH < input.floorToFloor ? typeH : Math.max(2.4, input.floorToFloor - 0.6)) : level.elevation + 0.02;
        shape = { type: 'surface', ring: pts, holes, z: zz, thickness: trade === 'structure' ? 0.2 : 0.04 };
      } else {
        const at = pts[0];
        if (trade === 'doors') shape = { type: 'point', at, z: level.elevation, size: [0.95, 0.12, 2.1] };
        else if (trade === 'elec-trim' && /light|luminaire|fixture|exit/i.test(type.name)) shape = { type: 'point', at, z: ceil - 0.1, size: [0.6, 0.6, 0.1] };
        else if (trade === 'elec-trim') shape = { type: 'point', at, z: level.elevation + 0.45, size: [0.12, 0.12, 0.12] };
        else if (trade === 'fire-heads') shape = { type: 'point', at, z: ceil - 0.05, size: [0.15, 0.15, 0.12] };
        else if (trade === 'mech-trim' && /diffuser|grille|register|fan/i.test(type.name)) shape = { type: 'point', at, z: ceil - 0.05, size: [0.6, 0.6, 0.15] };
        else if (trade === 'mech-trim') shape = { type: 'point', at, z: level.elevation, size: [0.5, 0.5, 0.8] };
        else shape = { type: 'point', at, z: level.elevation, size: [0.4, 0.4, 0.4] };
      }
      for (const p of pts) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
      }
    }
    if (trade === 'structure' && type.kind === 'count' && /\bPLY\b|DENOTES SPAN|\bWT-?\d/i.test(type.name)) {
      shape=null;placement='unknown';
      elIssues.push('Structural tag quantity retained; member span, direction and section must be established before generating physical geometry.');
    }
    if (shape?.type === 'surface' && (!simpleRing(shape.ring) || shape.holes.some(h => !simpleRing(h)))) {
      shape = null; placement = 'unknown';
      elIssues.push('Self-intersecting or degenerate polygon: retained in takeoff quantities, omitted from 3D/IFC geometry pending drawing review.');
      issues.push({id:`invalid-surface:${m.id}`,severity:'warning',text:`${type.name}: invalid polygon retained as an unplaced element. Repair its source outline only after review.`,refs:[m.id],sources:[src]});
    }
    if (!specCache.has(type.id)) specCache.set(type.id, specsFor(type, sections));
    const specs = specCache.get(type.id)!;
    if (!specs.length) elIssues.push(`No spec section found for ${type.name}.`);
    for (const sp of specs) if (missingSec.has(sp.key)) elIssues.push(`Spec section ${missingSec.get(sp.key)} is listed in the table of contents but not issued.`);
    elements.push({
      id: m.id,
      origin: "takeoff",
      status: trade === 'demolition' ? 'demolished' : /(?:^|\s[–-]\s)Existing\b|\b(?:frx|fwx|px|wx|cx)\d/i.test(type.name) ? 'existing' : 'new',
      name: m.label ? `${type.name} · ${m.label}` : type.name,
      trade,
      level: level?.id ?? null,
      shape,
      quantity,
      unit: primaryUnit(type.kind, units),
      typeId: type.id,
      typeName: type.name,
      division: type.division ?? '',
      measurementId: m.id,
      sheetId: s.id,
      specs,
      sources: [src],
      placement,
      issues: elIssues,
    });
  }

  const modelOrigin: [number,number] = Number.isFinite(minX) ? [(minX+maxX)/2,(minY+maxY)/2] : [0,0];
  // Centre what is drawn on the origin.
  if (Number.isFinite(minX)) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const shift = (p: [number, number]): [number, number] => [p[0] - cx, p[1] - cy];
    for (const e of elements) {
      const sh = e.shape;
      if (!sh) continue;
      if (sh.type === 'run') sh.points = sh.points.map(shift);
      else if (sh.type === 'surface') {
        sh.ring = sh.ring.map(shift);
        sh.holes = sh.holes.map((h) => h.map(shift));
      } else sh.at = shift(sh.at);
    }
    maxX -= cx;
    minX -= cx;
    maxY -= cy;
    minY -= cy;
  }

  // What could not be placed, by sheet.
  const why = new Map<string, string[]>();
  for (const [sid, reason] of unplaced) why.set(reason, [...(why.get(reason) ?? []), sid]);
  const label = (sid: string) => sheets.get(sid)?.name ?? sid;
  const say: Record<string, string> = {
    'no scale': 'have no scale, so their takeoffs have no size or place',
    'not a plan': 'are not plans (elevations, sections, details): their takeoffs are counted; only openings supported by elevation grids and dimensioned details are placed',
    'enlarged plan': 'are enlarged plans: where they sit on the floor isn’t recovered yet, so their takeoffs are counted but not drawn',
    'level unknown': 'don’t say which level they are: set it in Build setup to place their takeoffs',
    'other scale': 'are at another scale than the main plans: not placed with them',
  };
  for (const [reason, sids] of why)
    issues.push({ id: `unplaced:${reason}`, severity: reason === 'level unknown' ? 'warning' : 'info', text: `${sids.length} sheet${sids.length === 1 ? '' : 's'} (${sids.map(label).join(', ')}) ${say[reason]}.`, refs: sids });
  if (levels.length > 1)
    issues.push({
      id: 'placement',
      severity: 'info',
      text: `${Object.keys(registration).length} sheets registered by matching grid labels on both axes. Other sheets fall back to sheet position; verify their alignment. Heights use setup unless a level datum is available.`,
    });
  const noSpec = new Set(elements.filter((e) => !e.specs.length).map((e) => e.typeName));
  if (noSpec.size) issues.push({ id: 'nospec', severity: 'info', text: `${noSpec.size} takeoff type${noSpec.size === 1 ? '' : 's'} have no spec section linked (${[...noSpec].slice(0, 4).join('; ')}${noSpec.size > 4 ? '; …' : ''}).` });
  const notIssued = [...new Set(elements.flatMap((e) => e.specs.filter((sp) => missingSec.has(sp.key)).map((sp) => missingSec.get(sp.key)!)))];
  if (notIssued.length) issues.push({ id: 'notissued', severity: 'warning', text: `Takeoffs are governed by spec sections listed but not issued: ${notIssued.join('; ')}. Their submittal, testing and lead-time requirements are unknown.` });
  if (!sections.length) issues.push({ id: 'nospecbook', severity: 'warning', text: 'No specification in this project: submittal, testing, commissioning and closeout requirements can’t be read, so those activities rest on assumptions.' });

  const model: BuildModel = {
    version: MODEL_VERSION,
    sourceHash: sourceHashOf(input),
    units,
    levels,
    elements,
    issues,
    extent: Number.isFinite(minX) ? [minX, minY, maxX, maxY] : [0, 0, 0, 0],
  };
  addBuilding(model, project, input.floorToFloor);
  quarantineDetachedSheets(model, new Set(Object.keys(registration)));
  recoverRoof(model, project, input.drawingTexts ?? {}, input.drawingLines ?? {}, modelOrigin);
  if (model.elements.some((e) => e.origin === "building"))
    model.issues.push({
      id: "building-review",
      severity: "warning",
      text: "Building context is not yet verified against elevations: roof slopes/overhangs, slab openings, structural member sizes, and split wing datums need review. Do not use the shell as a coordinated BIM deliverable.",
    });
  recoverFacadeOpenings(model, project, input.drawingTexts ?? {}, input.drawingLines ?? {}, modelOrigin);
  rejectUnsupportedCurtainWalls(model);
  cutOpenings(model);
  return model;
}
