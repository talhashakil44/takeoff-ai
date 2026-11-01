import type { Pt } from '../model';
import type { PageText } from '../pageText';
import { SegmentIndex } from '../walls/bands';
import { dedupe, describeSymbol, symbolLoops } from '../walls/tags';
import type { Segment } from './vectors';

/**
 * A short code drawn inside a small closed symbol: a door number in an oval, a window type in a
 * hexagon, an equipment tag in a pentagon, a wall type in a box.
 */
export interface EnclosedTag {
  code: string;
  at: Pt;
  /** Text height. */
  h: number;
  /** Outline(s) round it, smallest first, as `describeSymbol` names them: round, polygon, diamond, box, triangle. */
  shape: string;
  /** Number of straight sides of the smallest outline (0 when round). */
  sides: number;
  /** Across the symbol, in sheet points. */
  size: number;
  filled: boolean;
  /**
   * Other text inside the symbol (the sheet number under a detail number in a callout bubble,
   * a height under a ceiling type): a tag holds its code alone.
   */
  others: string[];
}

/** A code a tag can hold: letters, digits, a dash or dot between, a letter after (101a, W1A, EQ-14, TA-3, D110c, x125). */
export const TAG_CODE = /^[A-Za-z]{0,4}[-.]?\d{1,4}[A-Za-z]{0,2}(?:[-.]\d{1,3}[A-Za-z]?)?$/;

/** Straight sides of one closed outline (0 for a round one). */
function sidesOf(loop: Segment[]): number {
  if (loop.some((s) => s.curve)) return 0;
  const sides: { a: number; off: number }[] = [];
  for (const s of loop) {
    const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (L < 0.3) continue;
    let a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    if (a < 0) a += Math.PI;
    if (a >= Math.PI - 0.035) a -= Math.PI;
    const off = -Math.sin(a) * s.x1 + Math.cos(a) * s.y1;
    if (!sides.some((q) => Math.abs(q.a - a) < 0.07 && Math.abs(q.off - off) < 1)) sides.push({ a, off });
  }
  return sides.length > 8 ? 0 : sides.length;
}

/** A light ink (white, pale grey): a fill drawn as a mask. */
const light = (c?: string) => {
  if (!c || !/^#[0-9a-f]{6}$/i.test(c)) return false;
  const n = parseInt(c.slice(1), 16);
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) > 3 * 225;
};

const bbox = (g: Segment[]) => {
  const xs = g.flatMap((s) => [s.x1, s.x2]);
  const ys = g.flatMap((s) => [s.y1, s.y2]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

/**
 * Every text matching `accept` (by default `TAG_CODE`) that sits alone, or nearly, in a small
 * closed outline: the smallest loop of lines (in one pen) or filled shape round it whose lines
 * all lie within a short reach of the text.
 */
export function findEnclosedTags(texts: PageText[], segs: Segment[], accept: (s: string) => boolean = (s) => TAG_CODE.test(s)): EnclosedTag[] {
  // White fills are masks behind lettering, not symbols.
  const lines = segs.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.2 && !(s.filled && light(s.color)));
  const index = new SegmentIndex(lines, 16);
  const out: EnclosedTag[] = [];
  for (const t of texts) {
    const code = t.str.trim();
    if (!code || code.length > 9 || !accept(code)) continue;
    const r = Math.max(t.w, t.h) * 0.5 + Math.max(14, 1.6 * t.h);
    const local = dedupe(index.query(t.cx - r, t.cy - r, t.cx + r, t.cy + r).map((i) => lines[i]));
    const inside = (x: number, y: number) => Math.hypot(x - t.cx, y - t.cy) <= r;
    const candidates = local.filter((s) => inside(s.x1, s.y1) && inside(s.x2, s.y2));
    let best: { loop: Segment[]; area: number; filled: boolean } | null = null;
    const pens = new Map<string, Segment[]>();
    for (const s of candidates) {
      const k = `${s.filled ? 'f' : 's'}${s.width}`;
      const list = pens.get(k);
      if (list) list.push(s);
      else pens.set(k, [s]);
    }
    for (const group of pens.values()) {
      for (const loop of symbolLoops(group, t.cx, t.cy)) {
        if (loop.length < 3) continue;
        const b = bbox(loop);
        // The text inside it, not a loop crossing through the lettering.
        if (Math.max(b.x1 - b.x0, b.y1 - b.y0) < Math.max(t.w, t.h) * 0.6 || Math.min(b.x1 - b.x0, b.y1 - b.y0) < Math.min(t.w, t.h) * 0.9) continue;
        const area = (b.x1 - b.x0) * (b.y1 - b.y0);
        if (!best || area < best.area) best = { loop, area, filled: !!group[0].filled };
      }
    }
    if (!best) continue;
    const b = bbox(best.loop);
    const symbol = describeSymbol([best.loop], best.filled);
    const others = texts
      .filter((o) => o !== t && o.cx > b.x0 && o.cx < b.x1 && o.cy > b.y0 && o.cy < b.y1 && o.str.trim())
      .map((o) => o.str.trim());
    out.push({ code, at: [t.cx, t.cy], h: t.h, shape: symbol?.shape ?? 'round', sides: sidesOf(best.loop), size: symbol?.size ?? 0, filled: best.filled, others });
  }
  return out;
}

/** A code's letters, upper-cased, without its number (EQ-14 → EQ, W1a → W, TA-3 → TA). */
export const familyOf = (code: string) => (/^[A-Za-z]*/.exec(code)?.[0] ?? '').toUpperCase();

/** An item code as schedules and legends list them: letters, then a number (EQ-14, TA-3, W1A, CW2, P-1). */
export const ITEM_CODE = /^[A-Za-z]{1,4}[-.]?\d{1,3}[A-Za-z]{0,2}$/;

/**
 * The codes in one text run: the run itself, or several codes run together ("TA-3 TA-8",
 * "EQ-9EQ-7" where two tags touch), each placed along the run in proportion.
 */
export function codesIn(t: PageText, accept: (s: string) => boolean = (s) => ITEM_CODE.test(s)): { code: string; at: Pt }[] {
  const s = t.str.trim();
  if (accept(s)) return [{ code: s, at: [t.cx, t.cy] }];
  const parts: { code: string; start: number }[] = [];
  // Split at spaces, then where a code's letters start again after its number (EQ-9|EQ-7).
  let at = 0;
  for (const word of s.split(/(\s+)/)) {
    if (/^\s+$/.test(word) || !word) {
      at += word.length;
      continue;
    }
    const pieces = word.split(/(?<=\d)(?=[A-Za-z]{1,4}[-.]?\d)/);
    for (const p of pieces) {
      if (!accept(p)) return [];
      parts.push({ code: p, start: at });
      at += p.length;
    }
  }
  if (parts.length < 2) return [];
  const a = t.angle ?? 0;
  return parts.map((p) => {
    const off = ((p.start + p.code.length / 2) / s.length - 0.5) * t.w;
    return { code: p.code, at: [t.cx + Math.cos(a) * off, t.cy + Math.sin(a) * off] as Pt };
  });
}

/** One line of a schedule or legend: a code at the start of a row, with what the row says about it. */
export interface ListedCode {
  code: string;
  /** The code's own text run. */
  text: PageText;
  /** The rest of its row, left to right ("TIRE LIFT ATLAS X Relocated", "WASTE RECEPTACLE: ITEM TO BE…"). */
  description: string;
  /** Which list (column) of the sheet it is in: rows of one list share it. */
  list: number;
}

const upright = (t: PageText) => Math.abs(Math.sin(t.angle ?? 0)) < 0.1;

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Whether a column of codes reads as a list: each code once, in order (mostly: a schedule can
 * slot a type in), rows evenly spaced give or take a two-line entry. Tags on a plan that happen
 * to line up are not.
 */
function orderly(run: PageText[]): boolean {
  const codes = run.map((t) => t.str.trim().toUpperCase());
  if (new Set(codes).size !== codes.length) return false;
  const pairs = codes.slice(1).map((c, i) => natural(codes[i], c));
  const up = pairs.filter((d) => d < 0).length;
  if (Math.max(up, pairs.length - up) < 0.7 * pairs.length) return false;
  const gaps = run.slice(1).map((t, i) => t.cy - run[i].cy).sort((a, b) => a - b);
  return gaps[gaps.length - 1] <= 3 * gaps[gaps.length >> 1];
}

/**
 * Codes listed down a column, as a schedule's tag column or a legend lists them: three or more
 * codes of one family (EQ-1, EQ-2, …) one under another, left edges in line, each row close to
 * the one before. A plan's tags are scattered, not stacked like this.
 */
export function codeLists(texts: PageText[], accept: (code: string) => boolean = (c) => ITEM_CODE.test(c), opts: { mixed?: boolean } = {}): ListedCode[] {
  const cands = texts.filter((t) => upright(t) && accept(t.str.trim()));
  const out: ListedCode[] = [];
  const used = new Map<PageText, number>();
  let lists = 0;
  const byFamily = new Map<string, PageText[]>();
  for (const t of cands) {
    // `mixed`: one column may list codes of several families (a fixture schedule's WC-1, L-1, U-1).
    const f = opts.mixed ? '' : familyOf(t.str.trim());
    const list = byFamily.get(f);
    if (list) list.push(t);
    else byFamily.set(f, [t]);
  }
  for (const group of byFamily.values()) {
    if (group.length < 3) continue;
    for (const t of group) {
      if (used.has(t)) continue;
      const x0 = t.cx - t.w / 2;
      // Lined up on their left edges, or centred in a column's cells.
      // (A schedule of several families: codes of different widths, a little looser.)
      const tol = Math.max(1.5, (opts.mixed ? 0.8 : 0.3) * t.h);
      const col = group
        .filter((o) => !used.has(o) && (Math.abs(o.cx - o.w / 2 - x0) <= tol || Math.abs(o.cx - t.cx) <= tol) && Math.abs(o.h - t.h) <= 0.25 * t.h)
        .sort((a, b) => a.cy - b.cy);
      // Runs of rows each within a few lines of the one before.
      let run: PageText[] = [];
      const flush = () => {
        if (run.length >= 3 && (opts.mixed ? new Set(run.map((r) => r.str.trim().toUpperCase())).size === run.length : orderly(run))) {
          lists++;
          for (const r of run) used.set(r, lists);
        }
        run = [];
      };
      for (const o of col) {
        // (A schedule of several families has tall rows: a maker, a model, notes under each code.)
        if (run.length && o.cy - run[run.length - 1].cy > (opts.mixed ? 40 : 12) * Math.max(o.h, 3)) flush();
        run.push(o);
      }
      flush();
    }
  }
  for (const [t, list] of used) {
    // The rest of its row: text level with it to its right (a two-line entry beside it too), up to a wide gap.
    const row = texts.filter((o) => o !== t && upright(o) && Math.abs(o.cy - t.cy) < 1.1 * Math.max(t.h, o.h) && o.cx > t.cx);
    const lineOf = (o: PageText) => Math.round((o.cy - t.cy) / (0.8 * Math.max(t.h, 3)));
    row.sort((a, b) => lineOf(a) - lineOf(b) || a.cx - b.cx);
    const words: string[] = [];
    const edges = new Map<number, number>();
    for (const o of row) {
      const line = lineOf(o);
      const edge = edges.get(line) ?? t.cx + t.w / 2;
      // A wide gap ends the row (the next table over).
      if (o.cx - o.w / 2 - edge > 80 * t.h) continue;
      words.push(o.str.trim());
      edges.set(line, o.cx + o.w / 2);
    }
    // Cells (text runs) two spaces apart, so the first cell can be told from the rest.
    out.push({ code: t.str.trim(), text: t, description: words.join('  ').replace(/^[-–:\s]+/, '').trim(), list });
  }
  return out;
}

/**
 * A legend's sample of a tag: the symbol drawn beside the words saying what it is ("W1  WINDOW
 * TYPE", "101  DOOR NUMBER"), not a tag on the drawing.
 */
export function isLegendSample(at: Pt, h: number, texts: PageText[]): boolean {
  return texts.some(
    (o) =>
      Math.abs(o.cy - at[1]) < 1.2 * Math.max(h, o.h) &&
      o.cx - o.w / 2 > at[0] &&
      o.cx - o.w / 2 - at[0] < 12 * h &&
      /\b(TAGS?|TYPES?|NUMBERS?|MARKS?|SYMBOLS?|DESIGNATIONS?|IDENTIFIERS?|REFERENCES?|INDICATES?|DENOTES?)\b/i.test(o.str),
  );
}
