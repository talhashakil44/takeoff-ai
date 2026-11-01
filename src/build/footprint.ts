import type { Pt } from '../model';
import type { BuildElement } from './types';
import { makeGrid, drawSegments, floodFill, traceBoundary, simplify, toSheet } from '../fill/raster';
import { simpleRing } from './surface';
function boxFilter(data: Uint8Array, w: number, h: number, r: number, erode: boolean): Uint8Array {
  const sum = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Uint8Array(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r),
        x1 = Math.min(w, x + r + 1),
        y0 = Math.max(0, y - r),
        y1 = Math.min(h, y + r + 1);
      const count = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
      out[y * w + x] = erode ? Number(count === (x1 - x0) * (y1 - y0)) : Number(count > 0);
    }
  return out;
}
/** Close bounded window/door gaps, flood from outside, then remove the closure buffer.
 * Unlike a convex hull this retains deep recesses between wings. All work is on derived masks. */
export function wallFootprint(elements: BuildElement[]): Pt[] | null {
  const runs = elements.flatMap((e) => (e.shape?.type === 'run' ? [e.shape] : []));
  const points = runs.flatMap((r) => r.points);
  if (points.length < 4) return null;
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]),
    x0 = Math.min(...xs),
    y0 = Math.min(...ys),
    x1 = Math.max(...xs),
    y1 = Math.max(...ys);
  if ((x1 - x0) * (y1 - y0) > 50000) return null;
  const res = 10,
    pad = 4;
  const segments = runs.flatMap((run) =>
    run.points.slice(1).map((b, i) => ({ x1: run.points[i][0], y1: run.points[i][1], x2: b[0], y2: b[1], width: 0.1, filled: false })),
  );
  let best: Pt[] | null = null,
    bestArea = 0;
  for (const closure of [0.25, 0.6, 1, 1.5]) {
    const g = makeGrid(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2, res);
    drawSegments(g, segments);
    const radius = Math.round(closure * res);
    g.data = boxFilter(g.data, g.w, g.h, radius, false);
    const exterior = floodFill(g, 0, 0).region;
    const filled = exterior.map((v) => (v ? 0 : 1));
    const inside = boxFilter(filled, g.w, g.h, radius, true);
    // Remove isolated strips: an occupied floor must enclose substantial area.
    const visited = new Uint8Array(inside.length);
    const queue = new Int32Array(inside.length);
    let largest: Uint8Array | null = null,
      count = 0;
    for (let index = 0; index < inside.length; index++) {
      if (!inside[index] || visited[index]) continue;
      let head = 0,
        tail = 1;
      queue[0] = index;
      visited[index] = 1;
      while (head < tail) {
        const i = queue[head++],
          x = i % g.w;
        for (const next of [x > 0 ? i - 1 : -1, x + 1 < g.w ? i + 1 : -1, i - g.w, i + g.w]) {
          if (next < 0 || next >= inside.length || !inside[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      if (tail > count) {
        count = tail;
        largest = new Uint8Array(inside.length);
        for (let i = 0; i < tail; i++) largest[queue[i]] = 1;
      }
    }
    const boxArea = (x1 - x0) * (y1 - y0);
    if (!largest || count / res ** 2 < Math.max(30, boxArea * 0.25)) continue;
    const traced = toSheet(g, simplify(traceBoundary(largest, g.w, g.h), 2));
    // Raster wall strokes extend beyond their centreline. Offset the traced polygon
    // instead of eroding the mask: erosion can sever narrow wing connections.
    const signed = traced.reduce(
      (sum, p, i) => sum + p[0] * traced[(i + 1) % traced.length][1] - p[1] * traced[(i + 1) % traced.length][0],
      0,
    );
    const inset: Pt[] = traced.map((p, i) => {
      const a = traced[(i + traced.length - 1) % traced.length],
        b = traced[(i + 1) % traced.length];
      const d1 = Math.hypot(p[0] - a[0], p[1] - a[1]),
        d2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
      if (!d1 || !d2) return p;
      const sign = Math.sign(signed),
        n1 = [(-sign * (p[1] - a[1])) / d1, (sign * (p[0] - a[0])) / d1],
        n2 = [(-sign * (b[1] - p[1])) / d2, (sign * (b[0] - p[0])) / d2];
      const denom = 1 + n1[0] * n2[0] + n1[1] * n2[1];
      if (denom < 0.1) return p;
      return [p[0] + (0.1 * (n1[0] + n2[0])) / denom, p[1] + (0.1 * (n1[1] + n2[1])) / denom];
    });
    const ring = simpleRing(inset) ? inset : traced;
    const area =
      Math.abs(ring.reduce((sum, p, i) => sum + p[0] * ring[(i + 1) % ring.length][1] - p[1] * ring[(i + 1) % ring.length][0], 0)) / 2;
    if (ring.length >= 4 && simpleRing(ring) && area > bestArea) {
      best = ring;
      bestArea = area;
    }
  }
  return best;
}
