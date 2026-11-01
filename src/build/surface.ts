import type { Pt } from '../model';
const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) => cross(a, b, c) * cross(a, b, d) < -1e-10 && cross(c, d, a) * cross(c, d, b) < -1e-10;
/** Reject self-crossing takeoff outlines rather than inventing a different measured shape. */
export function simpleRing(points: Pt[]): boolean {
  const r =
    points.length > 1 && Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]) < 1e-8
      ? points.slice(0, -1)
      : points;
  if (r.length < 3 || r.some((p) => !p.every(Number.isFinite))) return false;
  const area = Math.abs(r.reduce((n, p, i) => n + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0));
  if (area < 1e-8) return false;
  for (let i = 0; i < r.length; i++)
    for (let j = i + 2; j < r.length; j++) {
      if (i === 0 && j === r.length - 1) continue;
      if (crosses(r[i], r[(i + 1) % r.length], r[j], r[(j + 1) % r.length])) return false;
    }
  return true;
}
