import type { Segment } from '../fill/vectors';
import { newId, type AssemblyItem, type Measurement, type Project, type Pt, type Sheet, type TakeoffType } from '../model';
import type { PageText } from '../pageText';
import { tradeOfNumber } from '../sheetKind';
import { readSchedules, type Schedule } from '../smart/schedules';
import { markPlaces, tagTexts, type FoundationMark } from './foundations';
import { replaceRun, type Automation } from './result';
import { viewScaleAt } from '../sheetViews';
import { perSheet, type SetAccess } from './set';
import { automateWalls } from './walls';

/**
 * The structure above the foundations, off the structural framing plans and their schedules:
 * beams, columns, lintels, braces, posts and base plates counted where the plans tag them (B1,
 * C2, L3, BR1, BP4), each named and sized from its schedule ("B2 – Beam 265 x 608 GLULAM"), and
 * structural walls (WT-1, SW-1 shear walls) taken along their tagged runs. Wood members go to
 * Division 06, steel to 05, concrete to 03. Beams are measured between their supports: the
 * heavy line the tag is written along, from the column (or the line's end) before the tag to the
 * one after it; other members are counted.
 */

export type MemberKind = 'beam' | 'column' | 'lintel' | 'brace' | 'joist' | 'post' | 'plate' | 'connector' | 'wall';

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
  [/HOLD[\s-]*DOWN|TIE[\s-]*DOWN|STRAP|HANGER|CONNECTOR/, 'connector'],
  [/STRUCTURAL\s+WALL|SHEAR\s+WALL|BEARING\s+WALL|STUD\s+WALL/, 'wall'],
];

const MATERIAL = /\b(?:GLULAM|LVL|PSL|LSL|CLT|SPF|D\.?\s?FIR|TIMBER|HSS|STEEL|CONCRETE|CONC\.?|CMU|MASONRY)\b/i;

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
      let size = ((sizeCol >= 0 ? r.cells[sizeCol] : r.cells.filter(Boolean).slice(1, 3).join(' ')) ?? '').trim();
      // A size given as bare dimensions ("265 x 342") takes its material from the row's
      // description ("GLULAM COLUMN"): what it is made of decides the trade that prices it.
      if (!MATERIAL.test(size) && !materialOf(size)) {
        const made = r.cells.join(' ').toUpperCase().match(MATERIAL)?.[0];
        if (made) size = `${size} ${made}`.trim();
      }
      out.push({ mark, kind, size, schedule: s.title });
    }
  }
  return out;
}

/** The division a member's size names its material by, or null when the size is bare dimensions. */
function materialOf(size: string): string | null {
  const s = size.toUpperCase();
  if (/GLULAM|LVL|PSL|LSL|\bPLY\b|SPF|D\.?FIR|TIMBER|CLT|OSB|\b38\s*[xX]|\(2X\d+\)|NAIL/.test(s)) return '06 Wood, Plastics & Composites';
  if (/\bW\s*\d|HSS|\bL\s*\d|\bC\s*\d+\s*[xX]|PLATE|STEEL|ANCHOR|ROD|PL\s*\d/.test(s)) return '05 Metals';
  if (/CONC|CMU|BLOCK|MASONRY|BRICK/.test(s)) return /CONC/.test(s) ? '03 Concrete' : '04 Masonry';
  return null;
}

/** The division a member is priced in, by what it is made of. */
export function divisionOf(size: string): string {
  return materialOf(size) ?? '05 Metals';
}

const NAMES: Record<MemberKind, string> = {
  beam: 'Beam',
  column: 'Column',
  lintel: 'Lintel',
  brace: 'Brace',
  joist: 'Joist / truss',
  post: 'Post',
  plate: 'Base plate',
  connector: 'Hold-down / connector',
  wall: 'Structural wall',
};

const item = (name: string, unit: string, formula: string): AssemblyItem => ({ id: newId(), name, unit, formula });

export interface StructureResult extends Automation {
  checks: string[];
}

/**
 * The span of the beam a tag names: the beam's line is the heavy straight line drawn along the
 * tag (a vertical tag, a vertical beam) nearest it; the span runs from the support before the tag
 * to the one after, a support being a column drawn on the line (a small shape drawn across
 * it) or, failing one, the end of the line (gaps of a column's width bridged). Null when no line
 * runs along the tag.
 */
export function beamSpan(t: PageText, segs: Segment[], maxSpan: number, columns: Pt[] = [], cantilever = false): [Pt, Pt] | null {
  const vertical = Math.abs(Math.sin(t.angle ?? 0)) > 0.7;
  const across = (x: number, y: number) => (vertical ? x : y);
  const along = (x: number, y: number) => (vertical ? y : x);
  const at = along(t.cx, t.cy);
  const reach = Math.max(t.h * 3, 12);
  type Line = { off: number; lo: number; hi: number; w: number };
  const lines: Line[] = [];
  for (const s of segs) {
    if (s.filled || s.curve) continue;
    const d = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (d < 6 || Math.abs(across(s.x2, s.y2) - across(s.x1, s.y1)) > 0.3) continue;
    lines.push({ off: (across(s.x1, s.y1) + across(s.x2, s.y2)) / 2, lo: Math.min(along(s.x1, s.y1), along(s.x2, s.y2)), hi: Math.max(along(s.x1, s.y1), along(s.x2, s.y2)), w: s.width });
  }
  // The beam's line: beside the tag and running past it; the heavier the likelier.
  let best: Line | null = null;
  let score = Infinity;
  for (const l of lines) {
    const d = Math.abs(l.off - across(t.cx, t.cy));
    if (d > reach || l.w < 0.4 || l.hi - l.lo < 20 || at < l.lo - 5 || at > l.hi + 5) continue;
    const sc = d - 4 * l.w;
    if (sc < score) {
      score = sc;
      best = l;
    }
  }
  if (!best) return null;
  const on = lines.filter((l) => Math.abs(l.off - best!.off) <= 0.6 && Math.abs(l.w - best!.w) <= 0.2).sort((a, b) => a.lo - b.lo);
  // The pieces, joined across gaps a column or a tag wide.
  const pieces: [number, number][] = [];
  for (const l of on) {
    const last = pieces[pieces.length - 1];
    if (last && l.lo <= last[1] + 25) last[1] = Math.max(last[1], l.hi);
    else pieces.push([l.lo, l.hi]);
  }
  const piece = pieces.reduce((a, b) => (Math.max(b[0] - at, at - b[1], 0) < Math.max(a[0] - at, at - a[1], 0) ? b : a));
  // Columns on the line: a small shape drawn across it (the short sides of a column's square or
  // the chords of its circle cross the beam's line), clustered.
  const crossing: number[] = [];
  for (const g of segs) {
    if (g.filled) continue;
    const d = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
    if (d < 3 || d > 25) continue;
    const c1 = across(g.x1, g.y1);
    const c2 = across(g.x2, g.y2);
    if (Math.min(c1, c2) > best.off - 1.5 || Math.max(c1, c2) < best.off + 1.5) continue;
    const a = (along(g.x1, g.y1) + along(g.x2, g.y2)) / 2;
    if (a >= piece[0] - 15 && a <= piece[1] + 15) crossing.push(a);
  }
  crossing.sort((p, q) => p - q);
  // Column tags beside the line: a column drawn off the line's edge (hung under a beam drawn
  // as two lines) crosses nothing, but its grid line does.
  const tagged = columns.filter(([x, y]) => Math.abs(across(x, y) - best!.off) <= 25).map(([x, y]) => along(x, y));
  const supports: number[] = [];
  for (let i = 0; i < crossing.length; ) {
    let j = i;
    while (j + 1 < crossing.length && crossing[j + 1] - crossing[i] <= 25) j++;
    // A column is two or more crossings (its two sides); a lone tick is not, unless a column is tagged beside it.
    const mid = (crossing[i] + crossing[j]) / 2;
    if (j > i || tagged.some((a) => Math.abs(a - mid) <= 25)) supports.push(mid);
    i = j + 1;
  }
  let before = Math.max(piece[0], ...supports.filter((a) => a < at - 2));
  let after = Math.min(piece[1], ...supports.filter((a) => a > at + 2));
  if (!(after - before >= 10 && after - before <= maxSpan)) return null;
  // A cantilever (noted "CANT." at its tag): past the support at one end the line runs on to a
  // free end with no support, and the beam runs out to it (Kelso S2.1 B2: grid 8 to 9, then the
  // roof cantilever past 9).
  if (cantilever) {
    // Free: no support out to the line's end, a crossing right at the end being its edge (the roof
    // edge drawn across it) or a column; the other side must have a support beyond the span.
    const column = (a: number) => tagged.some((c) => Math.abs(c - a) <= 25);
    const openAfter = after < piece[1] - 10 && !supports.some((a) => a > after + 2 && (a < piece[1] - 15 || column(a)));
    const openBefore = before > piece[0] + 10 && !supports.some((a) => a < before - 2 && (a > piece[0] + 15 || column(a)));
    const heldAfter = supports.some((a) => a > after + 2);
    const heldBefore = supports.some((a) => a < before - 2);
    const freeAfter = openAfter && heldBefore;
    const freeBefore = openBefore && heldAfter;
    if (freeAfter !== freeBefore) {
      if (freeAfter && piece[1] - after <= maxSpan / 2) after = piece[1];
      if (freeBefore && before - piece[0] <= maxSpan / 2) before = piece[0];
    }
  }
  const pt = (a: number): Pt => (vertical ? [best!.off, a] : [a, best!.off]);
  return [pt(before), pt(after)];
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
  let unspanned = 0;
  const tagOf = new Map<Measurement, Pt>();
  const counted = members.filter((m) => m.kind !== 'wall');
  const walls = new Map(members.filter((m) => m.kind === 'wall').map((m) => [norm(m.mark), m]));
  // A shear wall schedule written as one assembly with no mark column (Williamsburg S2.1): the
  // plans tag its walls SW-1, SW-2; those codes are its walls.
  const shear = [...textsOf.values()].flat().find((t) => /^SHEAR\s*WALL\s+SCHEDULE\b/i.test(t.str.trim()));

  // Base plates sit on the foundation plan; the rest on the framing plans.
  for (const s of live) {
    if (!s.metersPerPoint && !textsOf.get(s.id)?.length) continue;
    const texts = textsOf.get(s.id) ?? [];
    const framing = isFramingPlan(s, texts);
    const foundation = /FOUNDATION/i.test(s.title ?? '') || texts.some((t) => /^FOUNDATION\s+PLAN$/i.test(t.str.trim()));
    if (!framing && !foundation) continue;
    await perSheet(access, s, async () => {
      const tags = tagTexts(texts, s, boxes.get(s.id) ?? []);
      const segs = framing ? ((await access.segments(s)) ?? []) : [];
      const these = counted.filter((m) => (foundation && !framing ? m.kind === 'plate' : true));
      const places = markPlaces(
        tags,
        these.map((m) => ({ mark: m.mark, kind: 'pad', says: m.size, schedule: m.schedule }) as FoundationMark),
      );
      const columnsAt = [...places].filter(([mark]) => /^(?:column|post)$/.test(these.find((x) => x.mark === mark)?.kind ?? '')).flatMap(([, at]) => at);
      for (const [mark, at] of places) {
        const m = these.find((x) => x.mark === mark)!;
        let t = typeOf.get(norm(mark));
        if (!t) {
          t = {
            id: newId(),
            name: `${m.mark} – ${NAMES[m.kind]}${m.size ? ` ${m.size.replace(/\s+/g, ' ').slice(0, 60)}` : ''}`,
            color: m.kind === 'column' || m.kind === 'post' ? '#c0a060' : m.kind === 'beam' || m.kind === 'lintel' ? '#b08850' : '#9a8f80',
            kind: m.kind === 'beam' ? 'linear' : 'count',
            height: 0,
            division: divisionOf(m.size),
            package: divisionOf(m.size).startsWith('06') ? 'Framing sub' : divisionOf(m.size).startsWith('05') ? 'Steel sub' : 'Concrete sub',
            description:
              m.kind === 'beam'
                ? `${m.schedule}: ${m.mark} ${m.size}. One per tag on the framing plans, measured between the supports either side of the tag.`
                : `${m.schedule}: ${m.mark} ${m.size}. Counted where the framing plans tag it.`,
            items: m.kind === 'beam' ? [item('Beams', 'ea', 'N'), item('Beam length', metric ? 'm' : 'ft', 'L')] : [item(NAMES[m.kind] + 's', 'ea', 'N')],
          };
          typeOf.set(norm(mark), t);
          types.push(t);
        }
        for (const pt of at) {
          if (m.kind !== 'beam') {
            added.push({ id: newId(), sheetId: s.id, typeId: t.id, points: [pt], holes: [], source: 'structure', label: m.mark });
            continue;
          }
          const tag = tags.find((x) => x.cx === pt[0] && x.cy === pt[1]);
          // 20 m at the sheet's scale, or at the scale of the drawing on it the tag is in.
          const mpp = s.metersPerPoint ?? viewScaleAt(s.views, [pt])?.metersPerPoint;
          // "(CANT.)" written with the tag: the beam runs on past its last support.
          const cant = !!tag && texts.some((x) => x !== tag && /^\(?CANT(\.|ILEVER)?\)?$/i.test(x.str.trim().replace(new RegExp(`^${m.mark}\\s*-?\\s*`, 'i'), '')) && Math.abs(x.cy - tag.cy) <= tag.h * 3.5 && Math.abs(x.cx - tag.cx) <= Math.max(tag.w, x.w) * 2);
          const span = tag && segs.length ? beamSpan(tag, segs, mpp ? 20 / mpp : 600, columnsAt, cant) : null;
          if (!span) unspanned++;
          const beam: Measurement = { id: newId(), sheetId: s.id, typeId: t.id, points: span ?? [pt, pt], holes: [], source: 'structure', label: m.mark };
          tagOf.set(beam, pt);
          added.push(beam);
        }
        tally.set(m.mark, (tally.get(m.mark) ?? 0) + at.length);
      }

      // Structural walls along their tagged runs.
      if (!framing || (!walls.size && !shear) || !s.metersPerPoint) return;
      const page = await access.page(s);
      if (!page) return;
      const read = await automateWalls({ ...p, types: [] }, page, undefined, s, maxOpening);
      if (!read.apply) return;
      const after = read.apply({ ...p, types: [], measurements: [] });
      for (const r of after.measurements.filter((m) => m.sheetId === s.id)) {
        const code = after.types.find((t) => t.id === r.typeId)?.name.split(/\s+[–-]\s+/)[0].trim() ?? '';
        const w = walls.get(norm(code)) ?? (shear && /^SW\d{1,2}[A-Z]?$/.test(norm(code)) ? { mark: code, kind: 'wall' as const, size: 'shear wall', schedule: 'SHEAR WALL SCHEDULE' } : undefined);
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

  // One beam per span: tags along a line whose supports weren't found all give the same span.
  // Two different marks on one span: the tag nearer the line keeps it; the other is counted
  // with no length, to be measured (each is a beam the drawing tags).
  const seen = new Map<string, Measurement>();
  let repeats = 0;
  let contested = 0;
  const gap = (m: Measurement) => {
    const t = tagOf.get(m);
    const [[x1, y1], [x2, y2]] = m.points;
    return t ? Math.abs((x2 - x1) * (y1 - t[1]) - (x1 - t[0]) * (y2 - y1)) / Math.max(1e-9, Math.hypot(x2 - x1, y2 - y1)) : Infinity;
  };
  for (let k = added.length - 1; k >= 0; k--) {
    const m = added[k];
    if (m.points.length !== 2 || (m.points[0][0] === m.points[1][0] && m.points[0][1] === m.points[1][1])) continue;
    const key = `${m.sheetId}|${m.points.flat().map((v) => v.toFixed(1)).join(',')}`;
    const other = seen.get(key);
    if (!other) seen.set(key, m);
    else if (other.typeId === m.typeId) {
      added.splice(k, 1);
      repeats++;
    } else {
      const loser = gap(m) < gap(other) ? other : m;
      if (loser === other) seen.set(key, m);
      const t = tagOf.get(loser);
      loser.points = t ? [t, t] : [loser.points[0], loser.points[0]];
      contested++;
    }
  }
  if (repeats) checks.push(`${repeats} beam tag${repeats === 1 ? '' : 's'} named a span already taken from another tag on the same line: counted once. The supports along that line weren't found, so check its spans.`);
  if (contested) checks.push(`${contested} beam tag${contested === 1 ? '' : 's'} named the same span as a different beam mark: the tag nearer the line keeps it, the other is counted with no length. Check those spans on the framing plans.`);
  if (!added.length) return { message: 'No scheduled members tagged on the structural plans.', checks };
  const notFound = counted.filter((m) => !tally.has(m.mark)).map((m) => m.mark);
  if (notFound.length) checks.push(`Structural schedule marks not tagged on any framing plan: ${notFound.join(', ')}. Count them by hand if they are used.`);
  checks.push('Structure: columns, lintels and braces are counted from their tags with the schedule size. Beams are measured between the supports either side of each tag: check spans that run past a column drawn without a symbol.');
  if (unspanned) checks.push(`${unspanned} beam tag${unspanned === 1 ? '' : 's'} had no beam line along ${unspanned === 1 ? 'it' : 'them'}: counted with no length. Measure ${unspanned === 1 ? 'it' : 'them'} on the framing plans.`);
  return {
    message: [...tally].map(([m, n]) => `${n} ${m}`).join(', '),
    checks,
    apply: (q) => replaceRun(q, 'structure', types, added),
  };
}


