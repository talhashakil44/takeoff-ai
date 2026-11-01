import { guessDivision } from '../divisionGuess';
import { findLegends } from '../fill/autoSymbols';
import { findLegendAreas } from '../fill/legend';
import { dashLines, pairParallels } from '../fill/runs';
import { buildWallModel, fillRoom } from '../fill/roomFill';
import { findEnclosedTags } from '../fill/typeTags';
import type { Segment } from '../fill/vectors';
import { newId, type Measurement, type Project, type Pt, type Sheet, type TakeoffType } from '../model';
import type { PageText } from '../pageText';
import { tradeOfNumber } from '../sheetKind';
import { drawingTitles } from '../sheetScale';
import { titleBlockBox } from '../titleBlock';
import { replaceRun, type Automation } from './result';
import { pause, perSheet, PALETTE, type SetAccess } from './set';

/**
 * Automate › Keynotes and demolition: the architect's numbered notes, taken off where the plans
 * point to them, as an estimator works a renovation set.
 *
 * - A sheet's keynote list ("5  REMOVE AND DISPOSE OF EXISTING RUBBER CLIMBING WALL", a washroom
 *   accessory legend "7  INTERIOR LOCK BUTTON") is read off the sheet, and every tag of a note's
 *   number on the sheet (a number in a box, circle or hexagon) counts one.
 * - On a demolition plan, a note that removes a surface (flooring, a ceiling, tile, a slab) is
 *   measured as the area of the room its tag is in; every other note is counted.
 * - On a demolition plan, walls drawn dashed (to be demolished) are measured as one length.
 */

export interface KeynotesResult extends Automation {
  checks: string[];
}

export interface Keynote {
  number: string;
  text: string;
  /** The note's own number run (not a tag). */
  run: PageText;
}

const pointIn = ([x, y]: Pt, ring: Pt[]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const ringArea = (r: Pt[]) => Math.abs(r.reduce((a, [x, y], i) => a + x * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y, 0)) / 2;

const upright = (t: PageText) => Math.abs(Math.sin(t.angle ?? 0)) < 0.1;

/**
 * Numbered notes listed down a column: a number alone (no full stop: "1." is a general note) with
 * the note's words starting just right of it, three or more one under another; each note's words
 * run on down to the next number.
 */
export function keynoteList(texts: PageText[]): Keynote[] {
  const nums = texts.filter((t) => upright(t) && /^\d{1,2}$/.test(t.str.trim()) && +t.str.trim() > 0);
  // The note's words start just right of its number: on its line, or (a number centred on a note
  // of several lines) a line or two above or below it.
  const withWords = nums
    .map((n) => {
      const words = texts.filter((o) => o !== n && upright(o) && Math.abs(o.cy - n.cy) < n.h * 2.5 && o.cx - o.w / 2 > n.cx + n.w / 2 && o.cx - o.w / 2 - (n.cx + n.w / 2) < n.h * 9 && /^[A-Z*"(][A-Za-z]/.test(o.str.trim()));
      const level = words.filter((o) => Math.abs(o.cy - n.cy) < n.h * 0.6).sort((a, b) => a.cx - b.cx)[0];
      return { n, first: level ?? words.sort((a, b) => Math.abs(a.cy - n.cy) - Math.abs(b.cy - n.cy) || a.cx - b.cx)[0] };
    })
    .filter((x) => x.first && /[A-Za-z]{3}/.test(x.first.str));
  // Columns: numbers whose words start at one left edge.
  const cols = new Map<number, typeof withWords>();
  for (const x of withWords) {
    const k = Math.round((x.first.cx - x.first.w / 2) / 4);
    const key = [...cols.keys()].find((c) => Math.abs(c - k) <= 1) ?? k;
    cols.set(key, [...(cols.get(key) ?? []), x]);
  }
  const out: Keynote[] = [];
  // The longest list first: a number in both a keynote list and a short legend is the keynote's.
  for (const all0 of [...cols.values()].sort((a, b) => b.length - a.length)) {
    // Numbers down one column (not room tags scattered beside their names).
    const mid = [...all0.map((x) => x.n.cx)].sort((a, b) => a - b)[Math.floor(all0.length / 2)];
    const col = all0.filter((x) => Math.abs(x.n.cx - mid) <= Math.max(3, x.n.h * 0.6));
    if (col.length < 3) continue;
    col.sort((a, b) => a.n.cy - b.n.cy);
    const left = Math.min(...col.map((x) => x.first.cx - x.first.w / 2));
    const h = col[0].n.h;
    const all = texts
      .filter((o) => upright(o) && Math.abs(o.cx - o.w / 2 - left) <= 3 && o.cy >= col[0].n.cy - h * 6 && o.cy <= col[col.length - 1].n.cy + h * 8)
      .sort((a, b) => a.cy - b.cy);
    // Notes set apart by a blank line: each number takes the note it sits beside (its first line
    // or its middle), so a number centred on its note does not take the next note's first line.
    const blocks = noteBlocks(all);
    const owner = (cy: number) => blocks?.filter((b) => cy >= b[0].cy - h * 1.6 && cy <= b[b.length - 1].cy + h * 1.6).sort((a, b) => Math.abs((a[0].cy + a[a.length - 1].cy) / 2 - cy) - Math.abs((b[0].cy + b[b.length - 1].cy) / 2 - cy))[0];
    const owned = blocks && col.map((x) => owner(x.n.cy));
    const byBlock = owned && owned.every((b, i) => b && owned.indexOf(b) === i);
    col.forEach((x, i) => {
      const next = col[i + 1]?.n.cy ?? x.n.cy + x.n.h * 6;
      const lines = byBlock
        ? owned![i]!
        : all.filter((o) => o.cy >= x.n.cy - x.n.h * 0.5 && o.cy < next - x.n.h * 0.5 && o.cy - x.n.cy < x.n.h * 6);
      const text = lines
        .map((l) => l.str.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      out.push({ number: x.n.str.trim(), text, run: x.n });
    });
  }
  // One note per number: the first list wins (a sheet with two lists keeps both only if their numbers differ).
  // A note with no words, or only a pointer to other sheets ("Building Elevation, see A300 series
  // Sheets": a symbol legend's row), is not a note to take off.
  const seen = new Set<string>();
  return out.filter((k) => k.text && !REFERENCE.test(k.text) && (seen.has(k.number) ? false : (seen.add(k.number), true)));
}

/** A legend row pointing to other sheets or schedules, with nothing to do. */
const REFERENCE = /^(?!.*\b(REMOVE|DEMOLISH|DISPOSE|SALVAGE|RELOCATE|PROVIDE|INSTALL|REPLACE)\b)[^.]*\bSEE\b[^.]*\b(SHEETS?|SERIES|SCHEDULES?|A\d{3})\b[^.]*\.?$/i;

/** Lines of a list split into notes at blank lines (a gap over 1.5 times the line pitch); null when no gap splits them. */
function noteBlocks(lines: PageText[]): PageText[][] | null {
  if (lines.length < 3) return null;
  const gaps = lines.slice(1).map((l, i) => l.cy - lines[i].cy);
  const pitch = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 4)];
  if (!(pitch > 0)) return null;
  const blocks: PageText[][] = [[lines[0]]];
  gaps.forEach((g, i) => (g > pitch * 1.5 ? blocks.push([lines[i + 1]]) : blocks[blocks.length - 1].push(lines[i + 1])));
  return blocks.length > 1 ? blocks : null;
}

/** A note removing a room's surface, measured as the room's area: flooring, a ceiling (not a thing hung from one). */
const AREA = /^(FLOORING|CARPET|[A-Z ]*\bFLOOR (AND BASE|TILE|FINISH)|[A-Z ]*\b(ACT|TILE|ACOUSTIC|GYPSUM BOARD|PLASTER) CEILING|[A-Z ]*\bCEILING(,| AND| TILES?\b|$)(?! MOUNTED))/i;

/** Whether a sheet is an architectural demolition plan. */
export const isDemoPlan = (s: Sheet, texts: PageText[]) => {
  if (s.superseded || !s.metersPerPoint || tradeOfNumber(s.name ?? '')) return false;
  // Titles, not pointers to other sheets ("For Floor Plan Removals see A200 series Sheets").
  const t = [s.title ?? '', ...drawingTitles(texts).slice(0, 3).map((d) => d.str)].filter((x) => !/^FOR\b|\bSEE\b/i.test(x)).join(' ').toUpperCase();
  return /\bPLANS?\b/.test(t) && /DEMOLITION|\bDEMO\b|REMOVALS?/.test(t) && !/\bOBC\b|\bCODE\b|EGRESS|LIFE SAFETY|MATRIX/.test(t);
};

/** A note removing a wall or partition (not something on one): measured as a length. */
const WALL_NOTE = { test: (t: string) => /\b(PARTITIONS?|WALLS?)\b/i.test(t) && !/\bWITHIN\b|\bIN WALL|MOUNTED|CLIMBING|TILE|BRACKETS?|BACKSTOP|SCREEN|FIXTURE|DRAIN|OPENING/i.test(t) };

/** What a removal note removes: the words after "Remove (and dispose of) (existing)" up to the first comma, full stop or "c/w". */
export const removed = (text: string) =>
  text
    .replace(/^(DISCONNECT,? )?REMOVE,?( AND DISPOSE( OF)?| STORE AND REINSTALL)?,? (EXISTING )?/i, '')
    .split(/[,.;]|\bC\/W\b|\bAND (MAKE GOOD|DISPOSE|PREP)\b|\bFROM ABOVE\b/i)[0]
    .trim();

const SITE_SURFACE = /\b(ASPHALT|PAVEMENT|PAVING|PAVERS?|CONCRETE|GRASS|SOD|SEED|TOPSOIL|GRAVEL|GRANULAR|LANDSCAP\w*|MULCH|PLANTING)\b/i;

const short = (text: string) => {
  const t = text.replace(/^REMOVE AND DISPOSE OF (EXISTING )?/i, '').replace(/\.\s.*$/, '').replace(/[.,;:]+$/, '');
  return t.length > 70 ? `${t.slice(0, 67)}…` : t;
};

export async function automateKeynotes(p: Project, access: SetAccess, maxOpening = 3): Promise<KeynotesResult> {
  const checks: string[] = [];
  const sheets = p.sheets.filter((s) => !s.superseded && !tradeOfNumber(s.name ?? ''));
  const fresh: TakeoffType[] = [];
  const added: Measurement[] = [];
  const typeFor = (name: string, kind: TakeoffType['kind'], division: string, unit: string) => {
    const got = p.types.find((t) => t.name === name && t.kind === kind) ?? fresh.find((t) => t.name === name && t.kind === kind);
    if (got) return got.id;
    const t: TakeoffType = { id: newId(), name, color: PALETTE[(p.types.length + fresh.length) % PALETTE.length], kind, height: kind === 'linear' ? 10 : 0, division, items: [{ id: newId(), name, unit, formula: kind === 'area' ? 'A' : kind === 'linear' ? 'L' : 'N' }] };
    fresh.push(t);
    return t.id;
  };
  const units = p.units === 'metric';
  let lists = 0;
  let unfilled = 0;
  for (const [i, s] of sheets.entries()) {
    access.progress?.(`Keynotes… ${s.name} (${i + 1} of ${sheets.length})`);
    if (i % 3 === 0) await pause();
    await perSheet(access, s, async () => {
      const texts = await access.texts(s);
      const notes = keynoteList(texts);
      const demo = isDemoPlan(s, texts);
      const heads = [s.title ?? '', ...drawingTitles(texts).slice(0, 3).map((d) => d.str)].join(' ').toUpperCase();
      // Notes on plans of the building (not a code, site or life safety plan's notes).
      const planSheet = /\bPLANS?\b/.test(heads) && !/CODE|SITE|LIFE SAFETY|KEY PLAN/.test(heads);
      const site = !!s.metersPerPoint && /\bSITE PLAN\b/.test(heads) && !/KEY PLAN|LOCATION/.test(heads);
      if (!notes.length && !demo && !site) return;
      const segs = await access.segments(s);
      if (!segs) return;
      const box = titleBlockBox(texts, s.width, s.height);
      const wallTags: { note: string; name: string; at: Pt }[] = [];
      const outside = ([x, y]: Pt) => !box || x < box[0] || x > box[2] || y < box[1] || y > box[3];
      if (notes.length) {
        lists++;
        const own = new Set(notes.map((n) => n.run));
        const byNumber = new Map(notes.map((n) => [n.number, n]));
        const tags = findEnclosedTags(texts, segs, (c) => /^\d{1,2}\*?$/.test(c)).filter((t) => !t.others.length && outside(t.at) && !texts.some((x) => own.has(x) && Math.hypot(x.cx - t.at[0], x.cy - t.at[1]) < 1));
        // A model of the walls, once, for rooms to measure removals in.
        let model: ReturnType<typeof buildWallModel> | null = null;
        const filled: { note: string; points: Pt[] }[] = [];
        const failed: { note: string; name: string; at: Pt }[] = [];
        // Notes on new-work plans are counted only from a list headed as keynotes: a washroom
        // legend's notes describe a detail's requirements, not items to count.
        const keyed = texts.some((x) => /\bKEY ?NOTES?\b/i.test(x.str));
        for (const t of tags) {
          const n = byNumber.get(t.code.replace('*', ''));
          if (!n) continue;
          const what = short(n.text);
          if (demo) {
            const name = `Demo ${n.number}: ${what}`;
            // A wall or partition to remove: measured from the dashed walls it points at (below).
            // What the note removes: its first words ("floor finish c/w base and make good … wall
            // substrates" removes a floor finish, not a wall).
            const object = removed(n.text);
            if (WALL_NOTE.test(object)) {
              wallTags.push({ note: n.number, name, at: t.at });
              continue;
            }
            if (AREA.test(object)) {
              model ??= buildWallModel(segs, s.metersPerPoint, { maxOpening });
              // A second tag of the note in a room already measured: the same room.
              if (filled.some((f) => f.note === n.number && pointIn(t.at, f.points))) continue;
              const r = fillRoom(model, [t.at], s.width, s.height, 2);
              // A fill over 120 m² (1,300 SF) has run out through an open doorway into the floor: counted instead.
              if (r.ok && ringArea(r.points) * s.metersPerPoint! ** 2 <= 120) {
                filled.push({ note: n.number, points: r.points });
                added.push({ id: newId(), sheetId: s.id, typeId: typeFor(name, 'area', '02 Existing Conditions', units ? 'm²' : 'SF'), points: r.points, holes: [], source: 'demolition', label: `${n.number}` });
                continue;
              }
              failed.push({ note: n.number, name, at: t.at });
              continue;
            }
            added.push({ id: newId(), sheetId: s.id, typeId: typeFor(`${name} (each)`, 'count', '02 Existing Conditions', 'ea'), points: [t.at], holes: [], source: 'demolition', label: n.number });
          } else {
            if (!planSheet || !keyed) continue;
            const name = `Note ${n.number} (${s.name}): ${what}`;
            added.push({ id: newId(), sheetId: s.id, typeId: typeFor(name, 'count', ['08 Openings', '20-25 Mechanical', '26 Electrical'].includes(guessDivision(n.text) ?? '') ? guessDivision(n.text)! : '10 Specialties', 'ea'), points: [t.at], holes: [], source: 'demolition', label: n.number });
          }
        }
        // A surface note's tag that no closed room took: counted, to measure by hand.
        for (const f of failed) {
          // A tag in a room the note already measured (a second tag, or one on the room's edge) is that room.
          if (filled.some((x) => x.note === f.note && pointIn(f.at, x.points))) continue;
          unfilled++;
          added.push({ id: newId(), sheetId: s.id, typeId: typeFor(`${f.name} (each, measure by hand)`, 'count', '02 Existing Conditions', 'ea'), points: [f.at], holes: [], source: 'demolition', label: f.note });
        }
      }
      if (site) {
        // A site plan's legend swatches (asphalt, concrete, grass): every area hatched the same way.
        const legends = findLegends(texts, segs, s.width, s.height, box ? [box] : []);
        for (const l of legends) {
          const rows = l.rows.filter((r) => r.graphic && (r.kind === 'area' || SITE_SURFACE.test(r.label)));
          for (const r of rows) r.kind = 'area';
          findLegendAreas(rows, segs, l.box, s.width, s.height, s.metersPerPoint!);
          for (const r of rows) {
            // A swatch filled solid (asphalt grey): the shapes filled in its colour.
            if (!r.areas?.length && r.graphic) r.areas = sameFill(segs, r.graphic, l.box);
            if (!r.areas?.length) continue;
            const name = `Site: ${r.label.replace(/\s+/g, ' ').trim()}`;
            const id = typeFor(name, 'area', guessDivision(r.label) ?? '32 Exterior Improvements', units ? 'm²' : 'SF');
            for (const a of r.areas) added.push({ id: newId(), sheetId: s.id, typeId: id, points: a.points, holes: [], source: 'demolition', label: r.label.slice(0, 30) });
          }
        }
      }
      // A roof plan's dashed pairs are curbs, parapets and overhead lines, not walls to demolish.
      if (demo && !/\bROOF\b/.test(heads)) {
        // Walls to demolish: drawn dashed, two lines 3" to 14" (75 to 350 mm) apart.
        const pt = (m: number) => m / s.metersPerPoint!;
        const dashed = dashLines(segs, pt(0.5)).filter((g: Segment) => outside([g.x1, g.y1]));
        const walls = pairParallels(dashed, pt(0.075), pt(0.36), pt(0.45));
        // Each dashed wall under the nearest wall keynote pointing at it (within 25 ft / 7.5 m), so
        // a wall is in one line only; the rest under one line of their own.
        for (const w of walls) {
          const mid: Pt = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
          const near = wallTags.map((t) => ({ t, d: Math.min(Math.hypot(t.at[0] - mid[0], t.at[1] - mid[1]), Math.hypot(t.at[0] - w.a[0], t.at[1] - w.a[1]), Math.hypot(t.at[0] - w.b[0], t.at[1] - w.b[1])) })).filter((x) => x.d <= pt(7.5)).sort((a, b) => a.d - b.d)[0];
          const name = near ? near.t.name : 'Demo: other walls and partitions shown dashed';
          const id = typeFor(name, 'linear', '02 Existing Conditions', units ? 'm' : 'ft');
          added.push({ id: newId(), sheetId: s.id, typeId: id, points: [w.a, w.b], holes: [], source: 'demolition', label: near ? near.t.note : 'dashed wall' });
        }
        // A wall keynote with no dashed wall near it: counted, to measure by hand.
        for (const t of wallTags) if (!added.some((m) => m.sheetId === s.id && m.label === t.note && m.points.length === 2)) added.push({ id: newId(), sheetId: s.id, typeId: typeFor(`${t.name} (each, measure by hand)`, 'count', '02 Existing Conditions', 'ea'), points: [t.at], holes: [], source: 'demolition', label: t.note });
      }
    });
  }
  if (!added.length) return { message: lists ? 'Keynote lists found, but no tags of their numbers on the sheets.' : 'No keynote lists or demolition plans.', checks };
  if (unfilled) checks.push(`${unfilled} demolition keynote${unfilled === 1 ? '' : 's'} for a surface (flooring, ceiling, slab) did not sit in a closed room; counted instead of measured. Measure those areas by hand.`);
  checks.push('Demolition walls are the walls drawn dashed on the demolition plans, each measured once along its length under the nearest wall keynote (height per the note). Overhead and hidden lines drawn dashed can be picked up too: check them on the plan.');
  const ids = new Set(added.map((m) => m.typeId));
  return {
    message: `Took off ${added.length} keynotes and demolition items as ${ids.size} types`,
    checks,
    apply: (q) => replaceRun(q, 'demolition', fresh, added),
  };
}

/** Shapes filled in the colour a legend swatch is filled with, outside the legend: their outlines and areas. */
export function sameFill(segs: Segment[], [gx0, gy0, gx1, gy1]: [number, number, number, number], legend: [number, number, number, number]) {
  const inBox = (x: number, y: number, b: number[]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  const colours = new Map<string, number>();
  for (const g of segs) if (g.filled && g.color && !/^#(f{6}|0{6})$/i.test(g.color) && inBox(g.x1, g.y1, [gx0 - 1, gy0 - 1, gx1 + 1, gy1 + 1])) colours.set(g.color, (colours.get(g.color) ?? 0) + 1);
  const colour = [...colours].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!colour) return [];
  const subs = new Map<number, Segment[]>();
  for (const g of segs) if (g.filled && g.color === colour && g.sub !== undefined && !inBox(g.x1, g.y1, legend)) subs.set(g.sub, [...(subs.get(g.sub) ?? []), g]);
  const out: { points: Pt[]; area: number; how: 'hatch' }[] = [];
  for (const list of subs.values()) {
    const points: Pt[] = [[list[0].x1, list[0].y1], ...list.map((g) => [g.x2, g.y2] as Pt)];
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      a += x1 * y2 - x2 * y1;
    }
    if (Math.abs(a) / 2 > 50) out.push({ points, area: Math.abs(a) / 2, how: 'hatch' });
  }
  return out;
}
