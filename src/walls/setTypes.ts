import { WALL_TAG } from './tags';
import type { PageText } from '../pageText';

/**
 * What a drawing set says its type tags are, read from its own text (no AI):
 *
 * - an assembly types sheet: headings such as "Partition (p) Types:", "WALL TYPES",
 *   "Floor (f) Types:" with the type codes listed under them. Codes under a wall,
 *   partition, furring or foundation wall heading are wall types; codes under floor,
 *   roof, ceiling, soffit, door or window headings are not.
 * - a symbol legend on a plan: a placeholder code in its symbol ("w#", "p#", "Wxx")
 *   beside what it stands for ("Partition Type", "Window Type, see A300 Sheets"). That
 *   gives which code prefixes are walls and which are something else.
 */
export interface SetTypes {
  /** Wall type codes as the set writes them (px7, EW3A). */
  wall: string[];
  /** Codes the set lists as other assemblies (floor fx2, ceiling c1, soffit sx1). */
  other: string[];
  /** Kind of each wall code read from its heading: exterior, partition, furring, foundation. */
  kinds: Record<string, string>;
  /** Code prefixes a legend gives as walls (w, p) and as other things (W window, f floor). */
  wallPrefixes: string[];
  otherPrefixes: string[];
}

export const emptySetTypes = (): SetTypes => ({ wall: [], other: [], kinds: {}, wallPrefixes: [], otherPrefixes: [] });

/**
 * A type code as drawings write them: one to four letters (an "x" in them often marks
 * existing work: px7, fwx2), an optional dash, a number and an optional letter.
 */
export const CODE = /^[A-Za-z]{1,4}[- #]?\d{1,3} ?[A-Za-z]?$/;

/** A code as written, without the spaces some sets put in it ("EX 1", "P1 a") or a number sign (W#1 is W1). */
export const codeOfText = (str: string) =>
  str
    .trim()
    .replace(/\s+/g, '')
    .replace(/^([A-Za-z]{1,4})#(?=\d)/, '$1');

const WALL_WORDS = /\b(?:walls?|partitions?|furring|linings?|shaft\s*walls?|demising|chase|parapets?)\b/i;
const OTHER_WORDS = /\b(?:floors?|roofs?|ceilings?|soffits?|slabs?|decks?|doors?|windows?|openings?|frames?|glazing|storefronts?|millwork|casework|equipment|rooms?|fixtures?|finish(?:es)?|stairs?|curtain\s*walls?|louvres?|louvers?|bulkheads?)\b/i;
/** A heading over a list of types: "Partition (p) Types:", "WALL TYPES", "Floor Assemblies". */
const HEADING = /^(.{2,48}?)\s*(?:\(([A-Za-z]{1,4})\)\s*)?(?:types?|assembl(?:y|ies)|schedules?|legend)(?:\s*[-–(]?\s*continued\)?)?\s*:?$/i;

/** A code's letters without the digits, and without a trailing existing-work "x" (px7 → p). */
export function codePrefix(code: string): { letters: string; base: string } {
  const letters = code.replace(/-?\d.*$/, '');
  const base = letters.length > 1 && /x$/i.test(letters) ? letters.slice(0, -1) : letters;
  return { letters, base };
}

/** What a heading or legend description names: a kind of wall, or something else. */
export function describes(text: string, partitionsListed = false): 'exterior' | 'partition' | 'furring' | 'foundation' | 'other' | null {
  const t = text.replace(/\([^)]*\)/g, ' ');
  // "Curtain wall" and "wall finishes" are not wall types.
  if (/curtain\s*walls?|wall\s+finish/i.test(t)) return 'other';
  if (WALL_WORDS.test(t)) {
    if (/foundation/i.test(t)) return 'foundation';
    if (/furring|lining/i.test(t)) return 'furring';
    if (/exterior|\bext\b|outside|cladding|parapet/i.test(t)) return 'exterior';
    if (/partition|interior|\bint\b|demising|shaft|chase/i.test(t)) return 'partition';
    // A plain "Wall Types" beside a list of partition types is the outside walls.
    return partitionsListed ? 'exterior' : 'partition';
  }
  if (OTHER_WORDS.test(t)) return 'other';
  return null;
}

interface Heading {
  text: string;
  /** Null: a heading over a list of several kinds (a construction legend): its codes are listed, their kind unsaid. */
  kind: ReturnType<typeof describes>;
  prefix?: string;
  x0: number;
  x1: number;
  cy: number;
}

/** Structural members and other non-wall things a schedule lists ("PIER SCHEDULE", "BLOCK LINTEL SCHEDULE"). */
const MEMBER_WORDS = /\b(?:footings?|piers?|columns?|lintels?|beams?|brac(?:es?|ing)|plates?|joists?|girders?|trusses?|anchors?|dowels?|reinforc\w*|connections?|hatch(?:es|ing)?|lines?|symbols?|keynotes?|abbreviations?|fixtures?)\b/i;

/**
 * What a list heading names: its last word is the thing listed ("WALL PLATE schedule" lists
 * plates); a heading naming walls and other things together ("Wall / Floor / Roof Types",
 * "Exterior Walls & Roofs") says nothing about any one code.
 */
export function headingKind(phrase: string, partitionsListed = false): ReturnType<typeof describes> {
  const t = phrase.replace(/\([^)]*\)/g, ' ').replace(/[-–:]+\s*$/, '').replace(/\s+types?$/i, '').trim();
  // A plan's legend explains every symbol on the plan.
  if (/\bplans?\b/i.test(t)) return null;
  const words = t.split(/[^A-Za-z]+/).filter(Boolean);
  const last = words[words.length - 1] ?? '';
  const parts = t.split(/\s*(?:\/|&|\+|,|\band\b)\s*/i).filter(Boolean);
  if (MEMBER_WORDS.test(last) || (OTHER_WORDS.test(last) && !/curtain/i.test(t))) {
    // "Wall plate": plates. "Exterior walls & roofs": both.
    return parts.length > 1 && parts.some((q) => WALL_WORDS.test(q.replace(/curtain\s*walls?/gi, ''))) ? null : 'other';
  }
  if (parts.length > 1) {
    const kinds = new Set(parts.map((q) => describes(q, partitionsListed)).filter(Boolean));
    if (kinds.size > 1 && kinds.has('other')) return null;
  }
  if (MEMBER_WORDS.test(t) && !WALL_WORDS.test(t)) return 'other';
  // "Foundation Types": foundation walls.
  if (/^foundations?$/i.test(last) && !OTHER_WORDS.test(t)) return 'foundation';
  return describes(t, partitionsListed);
}

/**
 * The codes an assembly types sheet lists, sorted by the heading each sits under: the
 * nearest heading above it in its column (and, when the heading names its prefix
 * "(fw)", only codes with that prefix). Codes listed under a heading naming several kinds
 * (or none: "Construction Legend") are wall types when they read as wall tags.
 */
export function readTypeSheet(texts: PageText[], pageWidth: number, pageHeight = pageWidth * 0.7): Pick<SetTypes, 'wall' | 'other' | 'kinds'> | null {
  const owner = listedCodes(texts, pageWidth, pageHeight);
  const out = { wall: [] as string[], other: [] as string[], kinds: {} as Record<string, string> };
  for (const [t, kind] of owner) {
    // W-1 and W1 are the same type.
    const code = codeOfText(t.str).replace('-', '');
    if (kind === null) {
      if (WALL_TAG.test(code)) {
        if (!out.wall.includes(code)) out.wall.push(code);
      } else if (!out.other.includes(code)) out.other.push(code);
    } else if (kind === 'other') {
      if (!out.other.includes(code)) out.other.push(code);
    } else if (!out.wall.includes(code)) {
      out.wall.push(code);
      out.kinds[code] = kind;
    }
  }
  out.other = out.other.filter((c) => !out.wall.includes(c));
  return out.wall.length + out.other.length ? out : null;
}

/** A sheet of assembly types, by a title on it ("ASSEMBLY TYPES MATRIX", "WALL TYPES"): its lists of codes are the types even where their headings are not text. */
const TYPES_SHEET = /^(?:[A-Za-z]+\s+){0,2}(?:assembl(?:y|ies)|wall|partition|construction)\s+types?(?:\s+(?:matrix|legend|schedule))?$/i;

/**
 * Codes listed one under another down a column: aligned on their centres or their left
 * edges, each a table row or so below the last. A legend or schedule lists its codes that
 * way; a plan's tags lie scattered over the drawing.
 */
export function codeLists(codes: PageText[], maxStep: number): PageText[][] {
  const lists: PageText[][] = [];
  for (const t of [...codes].sort((a, b) => a.cy - b.cy)) {
    const tol = Math.max(2, t.h * 2);
    let best: PageText[] | null = null;
    let bestDy = Infinity;
    for (const l of lists) {
      const q = l[l.length - 1];
      const dy = t.cy - q.cy;
      if (dy < Math.max(t.h, q.h) * 0.8 || dy > maxStep) continue;
      const aligned = Math.abs(t.cx - q.cx) <= tol || Math.abs(t.cx - t.w / 2 - (q.cx - q.w / 2)) <= tol;
      if (aligned && dy < bestDy) {
        best = l;
        bestDy = dy;
      }
    }
    if (best) best.push(t);
    else lists.push([t]);
  }
  return lists;
}

/** The codes a sheet lists under type headings (a schedule or legend), each with its heading's kind (null: listed, kind unsaid). */
export function listedCodes(texts: PageText[], pageWidth: number, pageHeight = pageWidth * 0.7, directOnly = false): Map<PageText, Heading['kind']> {
  const owner = new Map<PageText, Heading['kind']>();
  for (const { list, heading, direct } of typeLists(texts, pageWidth, pageHeight)) {
    if (directOnly && !direct) continue;
    for (const t of list) owner.set(t, heading ? heading.kind : null);
  }
  return owner;
}

/**
 * The lists of codes a sheet has under type headings, each with its heading (none: a list on a
 * types sheet whose heading is not text); `direct`: right under its heading, not a further
 * column of a table the heading is centred over.
 */
export function typeLists(texts: PageText[], pageWidth: number, pageHeight = pageWidth * 0.7): { list: PageText[]; heading: Heading | null; direct: boolean }[] {
  const heights = texts.map((t) => t.h).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 0;
  const flat = (t: PageText) => Math.abs(Math.sin(t.angle ?? 0)) < 0.5;
  // A heading is a title, not a sentence in the notes ("refer to the Construction Schedule, ...").
  const raw = texts.filter((t) => flat(t) && HEADING.test(t.str.trim()) && !/[,.;]/.test(t.str));
  // Headings stand out from the notes by their size, when the sheet sizes them.
  // A title of a few words that starts like no note ("refer to door schedule", "- existing
  // exterior wall assembly") counts at any size.
  const titled = (t: PageText) => t.str.trim().split(/\s+/).length <= 5 && !/^(?:[-–•*]|(?:see|refer|as|per|for|to|in|on|and|or|the|all|by|with|notes?|existing)\b)/i.test(t.str.trim());
  const pool = raw.filter((t) => t.h >= median * 1.3 || titled(t));
  const partitionsListed = pool.some((t) => /partition|interior/i.test(t.str));
  const headings: Heading[] = [];
  for (const t of pool) {
    const m = HEADING.exec(t.str.trim())!;
    // "Wall Type", "Partition Type": a legend's words for the symbol beside them; a list is headed "Wall Types".
    if (/\btype\s*:?\s*$/i.test(t.str.trim())) continue;
    // A legend's line ("p#  Partition Type", "W1  Window Type") explains a symbol beside it: no heading.
    const beside = texts.some((o) => o !== t && (PLACEHOLDER.test(o.str.trim()) || CODE.test(o.str.trim())) && Math.abs(o.cy - t.cy) < 1.5 * Math.max(o.h, t.h) && o.cx < t.cx && t.cx - t.w / 2 - (o.cx + o.w / 2) < 12 * t.h && t.cx - t.w / 2 - (o.cx + o.w / 2) > -t.h);
    if (beside) continue;
    const kind = headingKind(m[1] ?? '', partitionsListed);
    // A heading naming no kind ("Construction Legend") is a title of a few words, not a note ("see schedule").
    if (kind === null && (m[1].trim().split(/\s+/).length > 4 || /\d/.test(m[1]) || /^(?:see|refer|as|per|for|to|in|on|and|or|the|all|by|with|notes?)\b/i.test(m[1].trim()))) continue;
    headings.push({ text: t.str, kind, prefix: m[2], x0: t.cx - t.w / 2, x1: t.cx + t.w / 2, cy: t.cy });
  }
  const typesSheet = texts.some((t) => TYPES_SHEET.test(t.str.trim()) && t.h >= median * 1.3);
  if (!headings.length && !typesSheet) return [];
  const codes = texts.filter((t) => CODE.test(t.str.trim()) && flat(t));
  // A list's rows are at most this far apart; its heading at most this far above its first code.
  const maxStep = pageHeight * 0.15;
  const span = (list: PageText[]) => [Math.min(...list.map((t) => t.cx - t.w / 2)), Math.max(...list.map((t) => t.cx + t.w / 2))];
  const dxOf = (h: Heading, list: PageText[]) => {
    const [lx0, lx1] = span(list);
    return Math.max(0, h.x0 - lx1, lx0 - h.x1);
  };
  // A list ends at a heading between two of its rows (the next kind's list starts under it).
  const lists = codeLists(codes, maxStep).flatMap((list) => {
    const parts: PageText[][] = [[list[0]]];
    for (let i = 1; i < list.length; i++) {
      const q = list[i - 1];
      const t = list[i];
      if (headings.some((h) => h.cy > q.cy && h.cy < t.cy && dxOf(h, [q, t]) <= pageWidth * 0.12)) parts.push([]);
      parts[parts.length - 1].push(t);
    }
    return parts;
  });
  // Its heading: above it, the best aligned one; of those as well aligned, the lowest. Over
  // its column first; then a title centred over a wide table heads the table's other type
  // columns too, those starting on the same row as a column it heads.
  const near = pageWidth * 0.1;
  const headOf = new Map<PageText[], Heading>();
  for (const list of lists) {
    const over = headings.filter((h) => h.cy < list[0].cy && list[0].cy - h.cy <= maxStep && dxOf(h, list) <= near);
    const nearest = Math.min(...over.map((h) => dxOf(h, list)));
    const h = over.filter((o) => dxOf(o, list) <= nearest + 40).sort((x, y) => y.cy - x.cy)[0];
    if (h) headOf.set(list, h);
  }
  const nearHead = new Set(headOf.keys());
  const gapOf = (a: PageText[], b: PageText[]) => {
    const [a0, a1] = span(a);
    const [b0, b1] = span(b);
    return Math.max(0, a0 - b1, b0 - a1);
  };
  const aligned = (a: PageText, b: PageText) => {
    const tol = Math.max(2, Math.max(a.h, b.h) * 2);
    return Math.abs(a.cx - b.cx) <= tol || Math.abs(a.cx - a.w / 2 - (b.cx - b.w / 2)) <= tol;
  };
  const stepOf = (l: PageText[]) => (l.length > 1 ? (l[l.length - 1].cy - l[0].cy) / (l.length - 1) : 0);
  for (let grew = true; grew; ) {
    grew = false;
    for (const list of lists) {
      if (headOf.has(list)) continue;
      // A table column going on below an empty row or two.
      const above = [...headOf].find(([l]) => {
        const last = l[l.length - 1];
        const gap = list[0].cy - last.cy;
        return aligned(last, list[0]) && gap > 0 && gap <= Math.max(maxStep, 2.5 * stepOf(l)) && !headings.some((h) => h.cy > last.cy && h.cy < list[0].cy && dxOf(h, [last, list[0]]) <= pageWidth * 0.12);
      });
      if (above) {
        headOf.set(list, above[1]);
        grew = true;
        continue;
      }
      if (list.length < 3) continue;
      const row = Math.max(list[0].h, 4) * 1.5;
      const next = [...headOf]
        .filter(([l, o]) => Math.abs(l[0].cy - list[0].cy) <= row && o.cy < list[0].cy && gapOf(l, list) <= pageWidth * 0.3)
        .sort(([a], [b]) => gapOf(a, list) - gapOf(b, list))[0];
      if (next) {
        headOf.set(list, next[1]);
        grew = true;
      }
    }
  }
  const out: { list: PageText[]; heading: Heading | null; direct: boolean }[] = [];
  for (const list of lists) {
    const h = headOf.get(list);
    const distinct = new Set(list.map((t) => codeOfText(t.str))).size;
    if (!h) {
      // No heading read over it: on a types sheet, a list of several types is still one.
      if (typesSheet && list.length >= 3 && distinct === list.length) out.push({ list, heading: null, direct: false });
      continue;
    }
    // A column of a few codes repeated over and over is a detail's notes, not a list of types;
    // a legend of all sorts of symbols lists more than one.
    if ((list.length >= 3 && distinct < list.length / 2) || (h.kind === null && list.length < 2)) continue;
    const mine = h.prefix ? list.filter((t) => h.prefix!.toLowerCase() === codePrefix(codeOfText(t.str)).base.toLowerCase()) : list;
    if (mine.length) out.push({ list: mine, heading: h, direct: nearHead.has(list) });
  }
  return out;
}

/** A legend placeholder: a prefix and "#", "##", "xx" or "XX" in place of the number (w#, Wxx). */
const PLACEHOLDER = /^([A-Za-z]{1,4})(?:#{1,2}|xx|XX)$/;

/**
 * Prefixes a symbol legend explains: each placeholder with the words to its right on
 * its line ("p#  Partition Type", "Wxx  Window Type, see A300 Sheets").
 */
export function readTagLegend(texts: PageText[]): Pick<SetTypes, 'wallPrefixes' | 'otherPrefixes'> {
  const wallPrefixes: string[] = [];
  const otherPrefixes: string[] = [];
  for (const t of texts) {
    const m = PLACEHOLDER.exec(t.str.trim());
    if (!m) continue;
    const right = texts
      .filter((o) => o !== t && o.cx - o.w / 2 > t.cx && o.cx - o.w / 2 - (t.cx + t.w / 2) < 30 * t.h && Math.abs(o.cy - t.cy) < 1.5 * Math.max(t.h, o.h))
      .sort((a, b) => a.cx - a.w / 2 - (b.cx - b.w / 2));
    if (!right.length) continue;
    // The first words beside it name the symbol ("Foundation Wall Type, Wall Type").
    const kind = describes(right[0].str);
    if (!kind) continue;
    const list = kind === 'other' ? otherPrefixes : wallPrefixes;
    if (!list.includes(m[1])) list.push(m[1]);
  }
  return { wallPrefixes, otherPrefixes };
}

/** Merges what each sheet of a set says. */
export function mergeSetTypes(parts: Partial<SetTypes>[]): SetTypes {
  const out = emptySetTypes();
  for (const p of parts) {
    for (const c of p.wall ?? []) if (!out.wall.includes(c)) out.wall.push(c);
    for (const c of p.other ?? []) if (!out.other.includes(c) && !out.wall.includes(c)) out.other.push(c);
    // A plain "Wall Types" heading reads as partitions: a sheet naming the kind outright wins.
    for (const [c, k] of Object.entries(p.kinds ?? {})) if (!out.kinds[c] || out.kinds[c] === 'partition') out.kinds[c] = k;
    for (const c of p.wallPrefixes ?? []) if (!out.wallPrefixes.includes(c)) out.wallPrefixes.push(c);
    for (const c of p.otherPrefixes ?? []) if (!out.otherPrefixes.includes(c)) out.otherPrefixes.push(c);
  }
  out.other = out.other.filter((c) => !out.wall.includes(c));
  // A prefix explained both ways on different sheets says nothing.
  const both = out.wallPrefixes.filter((c) => out.otherPrefixes.includes(c));
  out.wallPrefixes = out.wallPrefixes.filter((c) => !both.includes(c));
  out.otherPrefixes = out.otherPrefixes.filter((c) => !both.includes(c));
  return out;
}

export type TagClass = { wall: true; confirmed: boolean } | { wall: false; generic: boolean };

/**
 * Whether a code on a plan is a wall type tag, by what the set says:
 * the project's own wall types, then the set's assembly types sheet, then its symbol
 * legend's prefixes, then the usual wall prefixes (`fallback`). A set that lists its wall
 * types makes any other code something else; without a list, an unknown code counts
 * only when its leader lands on a wall (`generic`).
 */
export function classifyCode(code: string, set: SetTypes, known: readonly string[], fallback: (code: string) => boolean): TagClass | null {
  const plain = code.replace('-', '');
  if (known.includes(plain) || known.includes(code)) return { wall: true, confirmed: true };
  if (set.wall.includes(code) || set.wall.includes(plain)) return { wall: true, confirmed: true };
  if (set.other.includes(code) || set.other.includes(plain)) return null;
  const { letters, base } = codePrefix(plain);
  // Exact case first: W (window) and w (wall) are different symbols on some sets.
  const exact = (list: string[]) => list.includes(letters) || list.includes(base);
  const loose = (list: string[]) => list.some((q) => [letters, base].some((p) => q.toLowerCase() === p.toLowerCase()));
  if (exact(set.otherPrefixes)) return null;
  // The set lists its wall types and this is none of them (a legend's "w#" does not add w1),
  // unless it is lettered like listed ones (P2b beside a legend of P1a, P1b, P2a): a type the
  // legend leaves out, read as a guess.
  if (set.wall.length >= 2) return set.wall.some((w) => codePrefix(w.replace('-', '')).letters === letters) ? { wall: true, confirmed: false } : null;
  if (exact(set.wallPrefixes)) return { wall: true, confirmed: true };
  if (loose(set.otherPrefixes) && !loose(set.wallPrefixes)) return null;
  if (loose(set.wallPrefixes) && !loose(set.otherPrefixes)) return { wall: true, confirmed: true };
  // The set's legend says what its partition tags look like ("P#  Partition / wall tag"): other
  // codes in symbols are something else (grid bubbles x6y, screen tags SC2), except exterior,
  // foundation and furring types a legend of partition tags often leaves out (EW1, FW2, FR1).
  if (set.wallPrefixes.length && !/^(E|EW|EX|EXT|F|FW|FR|FN|CB|CMU|M|MW)$/i.test(base)) return null;
  if (known.length) return { wall: false, generic: true };
  return fallback(plain) ? { wall: true, confirmed: false } : { wall: false, generic: true };
}
