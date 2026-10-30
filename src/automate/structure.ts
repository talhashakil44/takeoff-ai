import { newId, type AssemblyItem, type Measurement, type Project, type Sheet, type TakeoffType } from '../model';
import type { PageText } from '../pageText';
import { tradeOfNumber } from '../sheetKind';
import { readSchedules, type Schedule } from '../smart/schedules';
import { markPlaces, tagTexts, type FoundationMark } from './foundations';
import { replaceRun, type Automation } from './result';
import { perSheet, type SetAccess } from './set';
import { automateWalls } from './walls';

/**
 * The structure above the foundations, off the structural framing plans and their schedules:
 * beams, columns, lintels, braces, posts and base plates counted where the plans tag them (B1,
 * C2, L3, BR1, BP4), each named and sized from its schedule ("B2 – Beam 265 x 608 GLULAM"), and
 * structural walls (WT-1, SW-1 shear walls) taken along their tagged runs. Wood members go to
 * Division 06, steel to 05, concrete to 03. Member lengths are not measured: the count and the
 * schedule size are what the plans give; a check says so.
 */

export type MemberKind = 'beam' | 'column' | 'lintel' | 'brace' | 'joist' | 'post' | 'plate' | 'wall';

export interface Member {
  mark: string;
  kind: MemberKind;
  size: string;
  schedule: string;
}

const MARK = /^[A-Z]{1,3}-?\d{1,2}[A-Z]?$/;
const norm = (s: string) => s.toUpperCase().replace(/[\s.-]/g, '');

const KIND: [RegExp, MemberKind][] = [
  [/LINTEL|HEADER/, 'lintel'],
  [/BEAM|GIRDER/, 'beam'],
  [/COLUMN/, 'column'],
  [/\bPOSTS?\b/, 'post'],
  [/BRAC/, 'brace'],
  [/JOIST|TRUSS|RAFTER|PURLIN/, 'joist'],
  [/BASE\s*PLATE|BEARING\s*PLATE/, 'plate'],
  [/STRUCTURAL\s+WALL|SHEAR\s+WALL|BEARING\s+WALL|STUD\s+WALL/, 'wall'],
];

/** The members the structural schedules list, foundations left to the foundation step. */
export function structuralMembers(schedules: Schedule[]): Member[] {
  const out: Member[] = [];
  for (const s of schedules) {
    const t = s.title.toUpperCase();
    if (/FOOTING|PIER|FOUNDATION|PILE|SLAB/.test(t)) continue;
    const kind = KIND.find(([re]) => re.test(t))?.[1];
    if (!kind) continue;
    const sizeCol = s.columns.findIndex((c) => /\bSIZE\b|SECTION|MEMBER|WALL\s*TYPE|TYPE/i.test(c.join(' ')));
    for (const r of s.rows) {
      const mark = MARK.test(r.mark) && !/^\d+M$/.test(r.mark) ? r.mark : r.cells.find((c) => MARK.test(c.trim()))?.trim();
      if (!mark || out.some((o) => norm(o.mark) === norm(mark))) continue;
      const size = (sizeCol >= 0 ? r.cells[sizeCol] : r.cells.filter(Boolean).slice(1, 3).join(' ')) ?? '';
      out.push({ mark, kind, size: size.trim(), schedule: s.title });
    }
  }
  return out;
}

/** The division a member is priced in, by what it is made of. */
export function divisionOf(size: string): string {
  const s = size.toUpperCase();
  if (/GLULAM|LVL|PSL|LSL|\bPLY\b|SPF|D\.?FIR|TIMBER|CLT|OSB|\b38\s*[xX]|\(2X\d+\)|NAIL/.test(s)) return '06 Wood, Plastics & Composites';
  if (/\bW\s*\d|HSS|\bL\s*\d|\bC\s*\d+\s*[xX]|PLATE|STEEL|ANCHOR|ROD|PL\s*\d/.test(s)) return '05 Metals';
  if (/CONC|CMU|BLOCK|MASONRY|BRICK/.test(s)) return /CONC/.test(s) ? '03 Concrete' : '04 Masonry';
  return '05 Metals';
}

const NAMES: Record<MemberKind, string> = {
  beam: 'Beam',
  column: 'Column',
  lintel: 'Lintel',
  brace: 'Brace',
  joist: 'Joist / truss',
  post: 'Post',
  plate: 'Base plate',
  wall: 'Structural wall',
};

const item = (name: string, unit: string, formula: string): AssemblyItem => ({ id: newId(), name, unit, formula });

export interface StructureResult extends Automation {
  checks: string[];
}

/** Framing plans: structural plans that are not foundation plans, details, sections or schedules. */
export function isFramingPlan(sheet: Pick<Sheet, 'name' | 'title'>, texts: PageText[]): boolean {
  if (tradeOfNumber(sheet.name ?? '') !== 'S') return false;
  const t = (sheet.title ?? '').toUpperCase();
  if (/FOUNDATION|FOOTING|DETAIL|SECTION|SCHEDULE|ELEVATION|NOTES|GENERAL/.test(t)) return false;
  if (/PLAN|FRAMING/.test(t)) return true;
  return texts.some((x) => /FRAMING\s+PLAN|ROOF\s+PLAN|FLOOR\s+PLAN/i.test(x.str) && x.h >= 6);
}

export async function automateStructure(p: Project, access: SetAccess, maxOpening: number): Promise<StructureResult> {
  const metric = p.units === 'metric';
  const live = p.sheets.filter((s) => !s.superseded && tradeOfNumber(s.name ?? '') === 'S');
  const checks: string[] = [];
  if (!live.length) return { message: 'No structural drawings.', checks };

  const schedules: Schedule[] = [];
  const boxes = new Map<string, [number, number, number, number][]>();
  const textsOf = new Map<string, PageText[]>();
  for (const s of live)
    await perSheet(access, s, async () => {
      const texts = await access.texts(s);
      textsOf.set(s.id, texts);
      if (!texts.some((t) => /SCHEDULE/i.test(t.str))) return;
      const read = readSchedules(texts, (await access.segments(s)) ?? []);
      schedules.push(...read);
      boxes.set(s.id, read.map((x) => x.box));
    });
  const members = structuralMembers(schedules);
  if (!members.length) return { message: 'No beam, column or lintel schedules on the structural drawings.', checks };

  const types: TakeoffType[] = [];
  const added: Measurement[] = [];
  const typeOf = new Map<string, TakeoffType>();
  const tally = new Map<string, number>();
  const counted = members.filter((m) => m.kind !== 'wall');
  const walls = new Map(members.filter((m) => m.kind === 'wall').map((m) => [norm(m.mark), m]));

  // Base plates sit on the foundation plan; the rest on the framing plans.
  for (const s of live) {
    if (!s.metersPerPoint && !textsOf.get(s.id)?.length) continue;
    const texts = textsOf.get(s.id) ?? [];
    const framing = isFramingPlan(s, texts);
    const foundation = /FOUNDATION/i.test(s.title ?? '') || texts.some((t) => /^FOUNDATION\s+PLAN$/i.test(t.str.trim()));
    if (!framing && !foundation) continue;
    await perSheet(access, s, async () => {
      const tags = tagTexts(texts, s, boxes.get(s.id) ?? []);
      const these = counted.filter((m) => (foundation && !framing ? m.kind === 'plate' : true));
      const places = markPlaces(
        tags,
        these.map((m) => ({ mark: m.mark, kind: 'pad', says: m.size, schedule: m.schedule }) as FoundationMark),
      );
      for (const [mark, at] of places) {
        const m = these.find((x) => x.mark === mark)!;
        let t = typeOf.get(norm(mark));
        if (!t) {
          t = {
            id: newId(),
            name: `${m.mark} – ${NAMES[m.kind]}${m.size ? ` ${m.size.replace(/\s+/g, ' ').slice(0, 60)}` : ''}`,
            color: m.kind === 'column' || m.kind === 'post' ? '#c0a060' : m.kind === 'beam' || m.kind === 'lintel' ? '#b08850' : '#9a8f80',
            kind: 'count',
            height: 0,
            division: divisionOf(m.size),
            package: divisionOf(m.size).startsWith('06') ? 'Framing sub' : divisionOf(m.size).startsWith('05') ? 'Steel sub' : 'Concrete sub',
            description: `${m.schedule}: ${m.mark} ${m.size}. Counted where the framing plans tag it; lengths are not measured.`,
            items: [item(NAMES[m.kind] + 's', 'ea', 'N')],
          };
          typeOf.set(norm(mark), t);
          types.push(t);
        }
        for (const pt of at) added.push({ id: newId(), sheetId: s.id, typeId: t.id, points: [pt], holes: [], source: 'structure', label: m.mark });
        tally.set(m.mark, (tally.get(m.mark) ?? 0) + at.length);
      }

      // Structural walls along their tagged runs.
      if (!framing || !walls.size || !s.metersPerPoint) return;
      const page = await access.page(s);
      if (!page) return;
      const read = await automateWalls({ ...p, types: [] }, page, undefined, s, maxOpening);
      if (!read.apply) return;
      const after = read.apply({ ...p, types: [], measurements: [] });
      for (const r of after.measurements.filter((m) => m.sheetId === s.id)) {
        const code = after.types.find((t) => t.id === r.typeId)?.name.split(/\s+[–-]\s+/)[0].trim() ?? '';
        const w = walls.get(norm(code));
        if (!w) continue;
        let t = typeOf.get(`wall:${norm(code)}`);
        if (!t) {
          t = {
            id: newId(),
            name: `${w.mark} – Structural wall ${w.size}`.trim(),
            color: '#a1887f',
            kind: 'linear',
            height: metric ? 3 : 10,
            division: divisionOf(w.size),
            package: divisionOf(w.size).startsWith('06') ? 'Framing sub' : 'Concrete sub',
            description: `${w.schedule}: ${w.mark} ${w.size}. Height (H) assumed one storey: set it from the sections.`,
            items: [item('Wall length', metric ? 'm' : 'ft', 'L'), item('Wall area', metric ? 'm²' : 'SF', 'L * H')],
          };
          typeOf.set(`wall:${norm(code)}`, t);
          types.push(t);
        }
        added.push({ ...r, id: newId(), typeId: t.id, source: 'structure', label: w.mark });
        tally.set(w.mark, (tally.get(w.mark) ?? 0) + 1);
      }
    });
  }

  if (!added.length) return { message: 'No scheduled members tagged on the structural plans.', checks };
  const notFound = counted.filter((m) => !tally.has(m.mark)).map((m) => m.mark);
  if (notFound.length) checks.push(`Structural schedule marks not tagged on any framing plan: ${notFound.join(', ')}. Count them by hand if they are used.`);
  checks.push('Structure: beams, columns, lintels and braces are counted from their tags with the schedule size; their lengths are not measured. Take the lengths off the framing plans for pricing by the metre.');
  return {
    message: [...tally].map(([m, n]) => `${n} ${m}`).join(', '),
    checks,
    apply: (q) => replaceRun(q, 'structure', types, added),
  };
}


