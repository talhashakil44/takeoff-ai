import type { Project, Pt, Sheet } from "../model";
import type { BuildModel } from "./types";
export interface SheetFrame {
  a: number;
  b: number;
  tx: number;
  ty: number;
  residual: number;
}
export const worldPoint = (p: Pt, f: SheetFrame): Pt => [
  f.a * p[0] - f.b * p[1] + f.tx,
  f.b * p[0] + f.a * p[1] + f.ty,
];
export const sheetPoint = (p: Pt, f: SheetFrame): Pt => {
  const x = p[0] - f.tx,
    y = p[1] - f.ty,
    k = f.a * f.a + f.b * f.b;
  return [(f.a * x + f.b * y) / k, (-f.b * x + f.a * y) / k];
};
/** Recover the existing model transform, never a second geometry/quantity calculation. */
export function sheetFrame(
  project: Project,
  model: BuildModel,
  sheet: Sheet,
): SheetFrame | null {
  const pairs: { p: Pt; q: Pt }[] = [];
  for (const m of project.measurements.filter((m) => m.sheetId === sheet.id)) {
    const s = model.elements.find((e) => e.measurementId === m.id)?.shape;
    const ps =
      (s?.type === "run" || s?.type === "axis") ? s.points : s?.type === "surface" ? s.ring : [];
    if (ps.length === m.points.length)
      m.points.forEach((p, i) => pairs.push({ p, q: ps[i] }));
  }
  if (pairs.length < 3 || !sheet.metersPerPoint) return null;
  const first = pairs[0],
    last = [...pairs].sort(
      (a, b) =>
        Math.hypot(...sub(b.p, first.p)) - Math.hypot(...sub(a.p, first.p)),
    )[0];
  const [dx, dy] = sub(last.p, first.p),
    [wx, wy] = sub(last.q, first.q),
    d = dx * dx + dy * dy;
  if (d < 100) return null;
  const a = (wx * dx + wy * dy) / d,
    b = (wy * dx - wx * dy) / d;
  const f = {
    a,
    b,
    tx: first.q[0] - a * first.p[0] + b * first.p[1],
    ty: first.q[1] - b * first.p[0] - a * first.p[1],
    residual: 0,
  };
  f.residual = Math.max(
    ...pairs.map((v) => Math.hypot(...sub(worldPoint(v.p, f), v.q))),
  );
  return f.residual < 0.025 &&
    Math.abs(Math.hypot(a, b) / sheet.metersPerPoint - 1) < 0.001
    ? f
    : null;
}
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
