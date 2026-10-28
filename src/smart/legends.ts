import { findEnclosedTags } from '../fill/typeTags';
import type { Segment } from '../fill/vectors';
import type { PageText } from '../pageText';

/**
 * The drawn legends a set explains its tags with, read from their text: a partition or ceiling
 * type's tag with its construction written beside it (P3: INTERIOR PARTITION CONSTRUCTION, 5/8"
 * TYPE 'X' GYPSUM BOARD, 3 5/8" STEEL STUDS @ 16" O.C.), and the abbreviations list (HM HOLLOW
 * METAL, PTD PAINTED).
 */

export interface LegendEntry {
  code: string;
  /** The legend it is in (PARTITION TYPE LEGEND, SCREEN ELEVATIONS), when found. */
  legend: string;
  /** Its heading line (INTERIOR PARTITION CONSTRUCTION) and the lines under it. */
  lines: string[];
  /** A dimension written with it (the wall's overall thickness: 4 7/8"). */
  size?: string;
  at: [number, number];
  /** The tag and its lines on the sheet: x0, y0, x1, y1. */
  box?: [number, number, number, number];
}

const level = (t: PageText) => !t.angle || Math.abs(Math.sin(t.angle)) < 0.1;
/** A type's tag: P1, ACT1, SC-2, WS1, EW3A, D1. */
const TYPE_CODE = /^[A-Z]{1,4}-?\d{1,3}[A-Z]?$/;
const DIMENSION = /^\d+(?:\s+\d+\/\d+)?\s*"$|^\d+'\s*-\s*\d+(?:\s+\d+\/\d+)?"$|^\d{2,3}\s*mm$/i;
/** A heading naming a legend of types. */
const LEGEND_HEAD = /\b(TYPES?|ASSEMBL(Y|IES)|LEGEND|ELEVATIONS|CONSTRUCTION)\b/i;

/**
 * Type legends on a sheet: each tag (written once or twice on the sheet, as a legend lists it)
 * with a block of at least two lines beside it, its heading level with the tag.
 */
export function readTypeLegends(texts: PageText[], segs: Segment[], exclude: [number, number, number, number][] = []): LegendEntry[] {
  const inside = (t: PageText) => exclude.some(([x0, y0, x1, y1]) => t.cx > x0 && t.cx < x1 && t.cy > y0 && t.cy < y1);
  const flat = texts.filter((t) => level(t) && !inside(t));
  const heads = flat.filter((t) => LEGEND_HEAD.test(t.str) && t.str.trim().split(/\s+/).length <= 6);
  if (!heads.length) return [];
  const uses = new Map<string, number>();
  for (const t of flat) if (TYPE_CODE.test(t.str.trim())) uses.set(t.str.trim(), (uses.get(t.str.trim()) ?? 0) + 1);
  // A legend's tags are drawn in their symbol (P1 in a diamond, ACT1 in a box).
  const tagged = new Set(findEnclosedTags(flat, segs, (x) => TYPE_CODE.test(x)).map((e) => `${e.code}@${Math.round(e.at[0])},${Math.round(e.at[1])}`));
  const isTag = (c: PageText) => [...tagged].some((k) => {
    const [code, xy] = k.split('@');
    const [x, y] = xy.split(',').map(Number);
    return code === c.str.trim() && Math.hypot(x - c.cx, y - c.cy) < 3 * c.h;
  });
  const diag = Math.hypot(Math.max(...flat.map((t) => t.cx)), Math.max(...flat.map((t) => t.cy)));
  const out: LegendEntry[] = [];
  const seen = new Set<string>();
  for (const c of flat) {
    const code = c.str.trim();
    if (!TYPE_CODE.test(code) || (uses.get(code) ?? 0) > 2 || seen.has(code) || !isTag(c)) continue;
    if (!heads.some((t) => Math.hypot(t.cx - c.cx, t.cy - c.cy) < diag * 0.3)) continue;
    const h = c.h;
    // The block's first line: the nearest text to the right, level with the tag (a little above or below).
    const right = flat
      .filter((o) => o !== c && o.cx - o.w / 2 > c.cx + c.w / 2 && o.cx - o.w / 2 - (c.cx + c.w / 2) < 40 * h && Math.abs(o.cy - c.cy) < 6 * h && /[A-Z]{3}/i.test(o.str) && !TYPE_CODE.test(o.str.trim()) && !DIMENSION.test(o.str.trim()))
      .sort((a, b) => Math.round(a.cx - a.w / 2) - Math.round(b.cx - b.w / 2) || a.cy - b.cy);
    const first = right[0];
    if (!first) continue;
    const x0 = first.cx - first.w / 2;
    // Nothing else between the tag and the block but its drawing (no other tag's text).
    const lines: PageText[] = [first];
    for (;;) {
      const prev = lines[lines.length - 1];
      const next = flat
        .filter((o) => !lines.includes(o) && Math.abs(o.cx - o.w / 2 - x0) < 3 && o.cy > prev.cy + 0.3 * prev.h && o.cy - prev.cy < 2.4 * Math.max(prev.h, h))
        .sort((a, b) => a.cy - b.cy)[0];
      if (!next) break;
      // Another entry's tag level with it: that entry's lines.
      if (flat.some((o) => o !== c && TYPE_CODE.test(o.str.trim()) && Math.abs(o.cy - next.cy) < 1.5 * h && o.cx < x0 && o.cx > c.cx - 40 * h)) break;
      lines.push(next);
      if (lines.length > 14) break;
    }
    // Lines continuing a line (indented under it) join it.
    if (new Set(lines.map((l) => l.str.trim())).size < 2) continue;
    // The legend it is in: its drawing's title, written larger, under the drawing (PARTITION TYPE LEGEND).
    const near = (a: PageText, b: PageText) => Math.hypot(a.cx - c.cx, a.cy - c.cy) - Math.hypot(b.cx - c.cx, b.cy - c.cy);
    const big = heads.filter((t) => t !== first && !lines.includes(t) && t.h >= 1.5 * c.h);
    const under = big.filter((t) => t.cy > c.cy);
    const head = (under.length ? under : big).sort(near)[0];
    // A title on two lines (PARTITION TYPE over LEGEND) is one.
    if (!head) continue;
    const beside = (dir: 1 | -1) =>
      flat.find((o) => o !== head && Math.abs(o.cx - o.w / 2 - (head.cx - head.w / 2)) < 3 && dir * (o.cy - head.cy) > 0.5 * head.h && dir * (o.cy - head.cy) < 2.5 * head.h && Math.abs(o.h - head.h) < 0.3 * head.h);
    const legendName = [beside(-1), head, beside(1)].filter((t): t is PageText => !!t).map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
    // Its size: a dimension just above, between the tag and the block.
    const size = flat
      .filter((o) => DIMENSION.test(o.str.trim()) && o.cy < c.cy && c.cy - o.cy < 16 * h && o.cx > c.cx && o.cx < x0)
      .sort((a, b) => b.cy - a.cy)[0];
    seen.add(code);
    const parts = [c, ...lines];
    const box: [number, number, number, number] = [Math.min(...parts.map((t) => t.cx - t.w / 2)) - 4, Math.min(...parts.map((t) => t.cy - t.h)) - 4, Math.max(...parts.map((t) => t.cx + t.w / 2)) + 4, Math.max(...parts.map((t) => t.cy + t.h)) + 4];
    out.push({ box, code, legend: legendName, lines: lines.map((l) => l.str.replace(/\s+/g, ' ').trim()), ...(size ? { size: size.str.trim() } : {}), at: [c.cx, c.cy] });
  }
  return out;
}

/** An abbreviation as lists write it: AB, A/C, @, BSMT, P.LAM. */
const ABBR = /^[A-Z0-9@&/.\-]{1,6}$/;

/** The abbreviations list on a sheet: each short code with its meaning to its right. */
export function readAbbreviations(texts: PageText[]): Map<string, string> {
  const out = new Map<string, string>();
  const flat = texts.filter(level);
  const heads = flat.filter((t) => /^ABBREVIATIONS?:?$/i.test(t.str.trim()));
  for (const head of heads) {
    const h = head.h;
    const pairs: { a: PageText; m: PageText }[] = [];
    for (const a of flat) {
      if (a.cy <= head.cy || a.cy - head.cy > 1100 || a.cx < head.cx - head.w / 2 - 20 || a.cx > head.cx + 1100 || !ABBR.test(a.str.trim()) || !/[A-Z@&]/.test(a.str)) continue;
      const m = flat
        .filter((o) => o !== a && Math.abs(o.cy - a.cy) < 0.4 * a.h && o.cx - o.w / 2 > a.cx + a.w / 2 - 0.5 && o.cx - o.w / 2 - (a.cx + a.w / 2) < 14 * a.h && /[A-Z]{2}/i.test(o.str))
        .sort((p, q) => p.cx - q.cx)[0];
      if (m) pairs.push({ a, m });
    }
    // The list's columns: abbreviations lined up on their left edge, several to a column.
    const cols = new Map<number, typeof pairs>();
    for (const p of pairs) {
      const k = Math.round((p.a.cx - p.a.w / 2) / 3);
      cols.set(k, [...(cols.get(k) ?? []), p]);
    }
    for (const [k, ps] of cols) {
      const all = [...ps, ...(cols.get(k - 1) ?? []), ...(cols.get(k + 1) ?? [])];
      if (all.length < 5) continue;
      for (const { a, m } of ps) if (!out.has(a.str.trim().toUpperCase())) out.set(a.str.trim().toUpperCase(), m.str.replace(/\s+/g, ' ').trim());
    }
    void h;
  }
  return out;
}
