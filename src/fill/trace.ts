import type { Pt } from '../model';
import type { Segment } from './vectors';

const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

function distToSeg([px, py]: Pt, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / L2));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

/**
 * Follows the drawn line under a click: from the nearest stroke, along strokes of the
 * same pen joined end to end (gaps up to `gap` points, as dashed lines have), as long
 * as the way on is clear: at a fork it carries on only straight ahead, and it stops
 * where the line turns back on itself. Returns the polyline, or null when nothing is
 * near the click.
 */
export function traceLine(segs: Segment[], at: Pt, reach: number, gap = 4): Pt[] | null {
  const strokes = segs.filter((s) => !s.filled && len(s) > 0.2);
  let start: Segment | null = null;
  let best = reach;
  for (const s of strokes) {
    const d = distToSeg(at, s);
    if (d < best) {
      best = d;
      start = s;
    }
  }
  if (!start) return null;
  const pen = start.width;
  const same = strokes.filter((s) => Math.abs(s.width - pen) <= 0.01 + pen * 0.03);
  // Ends indexed on a grid for quick lookups.
  const cell = Math.max(4, gap * 2);
  const grid = new Map<string, { s: Segment; end: 0 | 1 }[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const s of same) {
    for (const end of [0, 1] as const) {
      const [x, y] = end ? [s.x2, s.y2] : [s.x1, s.y1];
      const k = key(x, y);
      const list = grid.get(k);
      if (list) list.push({ s, end });
      else grid.set(k, [{ s, end }]);
    }
  }
  const near = (x: number, y: number) => {
    const out: { s: Segment; end: 0 | 1; d: number }[] = [];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const e of grid.get(`${cx + i},${cy + j}`) ?? []) {
          const [ex, ey] = e.end ? [e.s.x2, e.s.y2] : [e.s.x1, e.s.y1];
          const d = Math.hypot(ex - x, ey - y);
          if (d <= gap) out.push({ ...e, d });
        }
      }
    }
    return out;
  };

  const used = new Set<Segment>([start]);
  /** Walks on from (x, y), arriving in direction (ux, uy); returns the points passed. */
  const walk = (x: number, y: number, ux: number, uy: number): Pt[] => {
    const pts: Pt[] = [];
    for (let guard = 0; guard < 20000; guard++) {
      let pick: { s: Segment; end: 0 | 1; turn: number } | null = null;
      let ways = 0;
      for (const c of near(x, y)) {
        if (used.has(c.s)) continue;
        const [fx, fy, tx, ty] = c.end ? [c.s.x2, c.s.y2, c.s.x1, c.s.y1] : [c.s.x1, c.s.y1, c.s.x2, c.s.y2];
        const L = Math.hypot(tx - fx, ty - fy);
        const turn = ((tx - fx) * ux + (ty - fy) * uy) / L;
        // Never turn back sharply onto the way we came.
        if (turn < -0.2) continue;
        ways++;
        if (!pick || turn > pick.turn) pick = { s: c.s, end: c.end, turn };
      }
      // At a fork, only straight on is clear; a turn there could be any of the lines.
      if (!pick || (ways > 1 && pick.turn < 0.995)) break;
      used.add(pick.s);
      const [fx, fy, tx, ty] = pick.end ? [pick.s.x2, pick.s.y2, pick.s.x1, pick.s.y1] : [pick.s.x1, pick.s.y1, pick.s.x2, pick.s.y2];
      const L = Math.hypot(tx - fx, ty - fy);
      pts.push([fx, fy], [tx, ty]);
      [x, y, ux, uy] = [tx, ty, (tx - fx) / L, (ty - fy) / L];
    }
    return pts;
  };
  const L = len(start);
  const ux = (start.x2 - start.x1) / L;
  const uy = (start.y2 - start.y1) / L;
  const forward = walk(start.x2, start.y2, ux, uy);
  const backward = walk(start.x1, start.y1, -ux, -uy);
  const raw: Pt[] = [...backward.reverse(), [start.x1, start.y1], [start.x2, start.y2], ...forward];
  // Drop repeated points where strokes join, and points along straight stretches.
  const out: Pt[] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.01) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const cross = (last[0] - a[0]) * (p[1] - a[1]) - (last[1] - a[1]) * (p[0] - a[0]);
      const span = Math.hypot(p[0] - a[0], p[1] - a[1]);
      const along = (last[0] - a[0]) * (p[0] - a[0]) + (last[1] - a[1]) * (p[1] - a[1]);
      if (span > 0 && Math.abs(cross) / span < 0.05 && along > 0) out[out.length - 1] = p;
      else out.push(p);
    } else out.push(p);
  }
  return out.length >= 2 ? out : null;
}

type Box = [number, number, number, number];

/**
 * Every line drawn in the same pen and ink as the stroke under a click: a sprinkler pipe
 * network, a fence, a duct run. Symbols drawn in that pen (small closed shapes: heads, valves)
 * are left out, and so are the sheet's frame and whatever lies in `avoid` (the title block).
 * Returned as runs: lines joined end to end between forks. Null when nothing is near the click.
 */
export function linesLike(segs: Segment[], at: Pt, reach: number, sheet: { width: number; height: number }, avoid: Box[] = []): Pt[][] | null {
  const strokes = segs.filter((s) => !s.filled && s.width > 0 && len(s) > 0.2);
  let start: Segment | null = null;
  let best = reach;
  for (const s of strokes) {
    const d = distToSeg(at, s);
    if (d < best) {
      best = d;
      start = s;
    }
  }
  if (!start) return null;
  const pen = start.width;
  const ink = start.color;
  const same = strokes.filter((s) => Math.abs(s.width - pen) <= 0.01 + pen * 0.03 && s.color === ink && !!s.curve === !!start.curve);

  // Small closed shapes are symbols drawn in the pipe's pen, not pipe.
  const shapes = new Map<number, Segment[]>();
  for (const s of same) if (s.sub !== undefined) (shapes.get(s.sub) ?? shapes.set(s.sub, []).get(s.sub)!).push(s);
  const symbol = new Set<Segment>();
  const small = Math.max(16, pen * 20);
  for (const g of shapes.values()) {
    if (g.length < 3) continue;
    const xs = g.flatMap((s) => [s.x1, s.x2]);
    const ys = g.flatMap((s) => [s.y1, s.y2]);
    const closed = Math.hypot(g[0].x1 - g[g.length - 1].x2, g[0].y1 - g[g.length - 1].y2) < 0.5;
    if (closed && Math.max(...xs) - Math.min(...xs) <= small && Math.max(...ys) - Math.min(...ys) <= small) for (const s of g) symbol.add(s);
  }
  const { width, height } = sheet;
  const edge = Math.min(width, height) * 0.03;
  const onFrame = (s: Segment) =>
    (Math.max(s.x1, s.x2) < edge || Math.min(s.x1, s.x2) > width - edge || Math.max(s.y1, s.y2) < edge || Math.min(s.y1, s.y2) > height - edge) && len(s) > width * 0.2;
  const inside = (x: number, y: number) => avoid.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  const kept = same.filter((s) => !symbol.has(s) && !onFrame(s) && !inside(s.x1, s.y1) && !inside(s.x2, s.y2));

  // Runs: lines joined end to end, broken at forks and gaps.
  const tol = 0.5;
  const cell = 4;
  const grid = new Map<string, { s: Segment; end: 0 | 1 }[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const s of kept)
    for (const end of [0, 1] as const) {
      const k = key(end ? s.x2 : s.x1, end ? s.y2 : s.y1);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push({ s, end });
    }
  const at2 = (x: number, y: number) => {
    const out: { s: Segment; end: 0 | 1 }[] = [];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const e of grid.get(`${cx + i},${cy + j}`) ?? []) if (Math.hypot((e.end ? e.s.x2 : e.s.x1) - x, (e.end ? e.s.y2 : e.s.y1) - y) <= tol) out.push(e);
    return out;
  };
  const used = new Set<Segment>();
  const runs: Pt[][] = [];
  for (const s of kept) {
    if (used.has(s)) continue;
    used.add(s);
    const grow = (x: number, y: number): Pt[] => {
      const pts: Pt[] = [];
      for (let guard = 0; guard < 100000; guard++) {
        const here = at2(x, y);
        // A fork (three or more lines meet) ends the run.
        if (here.length !== 2) break;
        const next = here.find((e) => !used.has(e.s));
        if (!next) break;
        used.add(next.s);
        [x, y] = next.end ? [next.s.x1, next.s.y1] : [next.s.x2, next.s.y2];
        pts.push([x, y]);
      }
      return pts;
    };
    const fwd = grow(s.x2, s.y2);
    const back = grow(s.x1, s.y1);
    runs.push([...back.reverse(), [s.x1, s.y1], [s.x2, s.y2], ...fwd]);
  }
  return runs;
}

/** A run's length, in sheet points. */
export const runLength = (pts: Pt[]) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
