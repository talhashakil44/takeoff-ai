import type { Pt } from '../model';
import type { Segment } from '../fill/vectors';
import { SegmentIndex } from './bands';

/** A tag's text on the sheet: its centre and size in sheet points. */
export interface TagText {
  code: string;
  cx: number;
  cy: number;
  /** Text width and height. */
  w: number;
  h: number;
  /**
   * A code outside the usual wall prefixes (VS1 shaftwall, CW2…): offices name their types
   * their own way. It counts only as a tag in a symbol with a leader onto a wall, and
   * is never reported as unmatched (a stair or equipment tag isn't a missed wall).
   */
  generic?: boolean;
}

export interface WallTag extends TagText {
  /** Where the tag points: the far end of its leader, or the tag itself when it has none. */
  target: Pt;
  /**
   * Each line leading off the symbol, as the points along it: the symbol corner it
   * starts from, then each bend out to its end.
   * Leaders can bend, and other linework drawn with the same pen (window frames)
   * can touch their ends, so the takeoff picks the first point that lands on a wall.
   */
  paths: Pt[][];
  leader: boolean;
  /**
   * The leader is a short tick from the side of a box across the wall it labels: the wall
   * is the first one it crosses, not where it happens to end.
   */
  tick?: boolean;
}

/** Wall type tags (W1, EW3A, FR2, CB1, …). */
/**
 * Wall type tags as drawing sets write them: EW3A, W1, FR2, CB1, and with a dash or
 * other common prefixes (W-1, EW-2A, WT1, IP2, EXT1, INT4).
 */
export const WALL_TAG = /^(?:EW|IW|W|FR|FW|CB|PW|SW|WT|IP|EP|EXT|INT)-?\d{1,2}[A-Z]?$/;
/** Any type code: letters then a number (VS1, CW-2, SH3A, WP2a). */
export const TYPE_TAG = /^[A-Z]{1,4}-?\d{1,3}[A-Za-z]?$/;

const near = (ax: number, ay: number, bx: number, by: number, tol: number) => Math.abs(ax - bx) <= tol && Math.abs(ay - by) <= tol;

/**
 * Finds what each tag points at. A tag is text inside a closed symbol (diamond,
 * hexagon, box, circle) with a leader line running from the symbol to the wall.
 * The symbol is the loop of short lines around the text; the leader is a line
 * that starts on that loop and leads away, possibly in several pieces.
 */
export function resolveTags(texts: TagText[], segs: Segment[]): WallTag[] {
  const lines = segs.filter((s) => !s.filled && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.2);
  const index = new SegmentIndex(lines, 16);
  return texts.map((t) => {
    const r = Math.max(t.w, t.h) * 0.5 + 18; // reach of the symbol around the text
    const local = dedupe(index.query(t.cx - r, t.cy - r, t.cx + r, t.cy + r).map((i) => lines[i]));
    const inside = (x: number, y: number) => Math.hypot(x - t.cx, y - t.cy) <= r;
    const candidates = local.filter(
      (s) => inside(s.x1, s.y1) && inside(s.x2, s.y2) && distToSeg(t.cx, t.cy, s) >= Math.min(t.w, t.h) * 0.4,
    );
    // Tags and their leaders are drawn with one pen. Furniture or hatching can sit under
    // a tag, so each pen is tried and the smallest loop with a leader wins.
    let best: { paths: Pt[][]; size: number; tick?: boolean } | null = null;
    const loops: Segment[][] = [];
    for (const pen of new Set(candidates.map((s) => s.width))) {
      const symbol = symbolLoop(
        candidates.filter((s) => s.width === pen),
        t.cx,
        t.cy,
      );
      if (symbol.length < 3) continue;
      loops.push(symbol);
      if (best && symbol.length >= best.size) continue;
      const paths = leadersFrom(symbol, local.filter((s) => s.width === pen), t, index, lines);
      if (paths.length) best = { paths, size: symbol.length };
    }
    // A box set beside its wall with a short tick from the middle of its edge onto the wall,
    // often in a heavier pen than the box.
    if (!best) {
      for (const symbol of loops.sort((a, b) => a.length - b.length)) {
        const paths = leadersFrom(symbol, local, t, index, lines, true);
        if (paths.length) {
          best = { paths, size: symbol.length, tick: true };
          break;
        }
      }
    }
    if (!best) return { ...t, target: [t.cx, t.cy] as Pt, paths: [], leader: false };
    return { ...t, target: best.paths[0][1], paths: best.paths, leader: true, ...(best.tick ? { tick: true } : {}) };
  });
}

/** Drops repeated segments (some CAD exports draw lines twice, sometimes reversed). */
export function dedupe(segs: Segment[]): Segment[] {
  const seen = new Set<string>();
  return segs.filter((s) => {
    const a = `${s.x1.toFixed(2)},${s.y1.toFixed(2)}`;
    const b = `${s.x2.toFixed(2)},${s.y2.toFixed(2)}`;
    const k = `${s.width}|${a < b ? a + '|' + b : b + '|' + a}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The closed loop of lines around the text. Lines with a loose end (leaders,
 * ticks) are peeled off until only loops remain, and only a loop enclosing the
 * text counts.
 */
export function symbolLoop(segs: Segment[], x: number, y: number): Segment[] {
  let symbol = segs;
  for (let pass = 0; pass < 20; pass++) {
    const joined = (px: number, py: number, self: Segment) =>
      symbol.some((o) => o !== self && (near(o.x1, o.y1, px, py, 0.3) || near(o.x2, o.y2, px, py, 0.3)));
    const kept = symbol.filter((s) => joined(s.x1, s.y1, s) && joined(s.x2, s.y2, s));
    if (kept.length === symbol.length) break;
    symbol = kept;
  }
  return surrounding(symbol, x, y);
}

/** Lines leading off the symbol's corners, each followed through its bends. */
function leadersFrom(symbol: Segment[], pen: Segment[], t: TagText, index: SegmentIndex, lines: Segment[], fromEdge = false): Pt[][] {
  const corners: Pt[] = [];
  for (const e of symbol) {
    for (const [x, y] of [
      [e.x1, e.y1],
      [e.x2, e.y2],
    ]) {
      if (symbol.some((o) => o !== e && (near(o.x1, o.y1, x, y, 0.3) || near(o.x2, o.y2, x, y, 0.3)))) corners.push([x, y]);
    }
  }
  const atCorner = (x: number, y: number) => corners.some((c) => near(c[0], c[1], x, y, 0.6));
  const onSymbol = (x: number, y: number) => symbol.some((s) => distToSeg(x, y, s) < 0.6);
  // A tick leaves from the middle of a side of the box (a line merely touching it does not).
  const xs = symbol.flatMap((e) => [e.x1, e.x2]);
  const ys = symbol.flatMap((e) => [e.y1, e.y2]);
  const [bx0, bx1, by0, by1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const midSide = (x: number, y: number) =>
    onSymbol(x, y) &&
    ((Math.min(Math.abs(y - by0), Math.abs(y - by1)) < 0.6 && Math.abs(x - (bx0 + bx1) / 2) < 0.2 * (bx1 - bx0)) ||
      (Math.min(Math.abs(x - bx0), Math.abs(x - bx1)) < 0.6 && Math.abs(y - (by0 + by1) / 2) < 0.2 * (by1 - by0)));
  const paths: Pt[][] = [];
  for (const s of pen) {
    if (symbol.includes(s)) continue;
    for (const [ax, ay, bx, by] of [
      [s.x1, s.y1, s.x2, s.y2],
      [s.x2, s.y2, s.x1, s.y1],
    ]) {
      if (!(atCorner(ax, ay) || (fromEdge && midSide(ax, ay))) || onSymbol(bx, by)) continue;
      const width = s.width;
      if (Math.hypot(bx - t.cx, by - t.cy) <= Math.hypot(ax - t.cx, ay - t.cy)) continue;
      let end: Pt = [bx, by];
      const path: Pt[] = [[ax, ay], end];
      const used = new Set<Segment>([s]);
      for (let k = 0; k < 6; k++) {
        const next = index
          .query(end[0] - 1, end[1] - 1, end[0] + 1, end[1] + 1)
          .map((i) => lines[i])
          .find((o) => !used.has(o) && !symbol.includes(o) && o.width === width && (near(o.x1, o.y1, end[0], end[1], 0.3) || near(o.x2, o.y2, end[0], end[1], 0.3)));
        if (!next) break;
        used.add(next);
        const far: Pt = near(next.x1, next.y1, end[0], end[1], 0.3) ? [next.x2, next.y2] : [next.x1, next.y1];
        if (Math.hypot(far[0] - end[0], far[1] - end[1]) < 0.3) break;
        end = far;
        path.push(end);
      }
      paths.push(path);
    }
  }
  return paths;
}

/** The connected loops among `segs` that enclose (x, y). */
function surrounding(segs: Segment[], x: number, y: number): Segment[] {
  const groups: Segment[][] = [];
  const left = new Set(segs);
  while (left.size) {
    const first = left.values().next().value!;
    left.delete(first);
    const group = [first];
    for (let k = 0; k < group.length; k++) {
      const g = group[k];
      for (const o of [...left]) {
        const touches = [
          [g.x1, g.y1],
          [g.x2, g.y2],
        ].some(([px, py]) => near(o.x1, o.y1, px, py, 0.3) || near(o.x2, o.y2, px, py, 0.3));
        if (touches) {
          left.delete(o);
          group.push(o);
        }
      }
    }
    groups.push(group);
  }
  return groups
    .filter((g) => {
      // A ray to the right crosses an enclosing loop an odd number of times. A symbol drawn
      // twice over itself crosses twice in one place: that counts once.
      const xs: number[] = [];
      for (const s of g) {
        if (s.y1 > y === s.y2 > y) continue;
        const cx = ((s.x2 - s.x1) * (y - s.y1)) / (s.y2 - s.y1) + s.x1;
        if (x < cx) xs.push(cx);
      }
      xs.sort((a, b) => a - b);
      const crossings = xs.filter((v, i) => i === 0 || v - xs[i - 1] > 0.3).length;
      return crossings % 2 === 1;
    })
    .flat();
}

export function distToSeg(x: number, y: number, s: Segment): number {
  const wx = s.x2 - s.x1;
  const wy = s.y2 - s.y1;
  const L2 = wx * wx + wy * wy;
  const t = L2 ? Math.max(0, Math.min(1, ((x - s.x1) * wx + (y - s.y1) * wy) / L2)) : 0;
  return Math.hypot(x - s.x1 - wx * t, y - s.y1 - wy * t);
}
