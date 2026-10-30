import type { ElementShape } from './types';
/** Shared wall solids keep the viewer and IFC geometry identical, including rectangular voids. */
export function runSolids(run: Extract<ElementShape, { type: 'run' }>) {
  const parts: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    length: number;
    z: number;
    height: number;
    endHeight: number;
    thickness: number;
  }[] = [];
  for (let i = 1; i < run.points.length; i++) {
    const [x, y] = run.points[i - 1],
      [endX, endY] = run.points[i];
    const length = Math.hypot(endX - x, endY - y);
    if (length < 0.02) continue;
    const dx = (endX - x) / length,
      dy = (endY - y) / length;
    const openings = (run.openings ?? []).filter((o) => o.segment === i - 1);
    const xs = [
      ...new Set([0, length, ...openings.flatMap((o) => [Math.max(0, o.offset - o.width / 2), Math.min(length, o.offset + o.width / 2)])]),
    ].sort((a, b) => a - b);
    const zs = [
      ...new Set([0, run.height, ...openings.flatMap((o) => [Math.max(0, o.sill), Math.min(run.height, o.sill + o.height)])]),
    ].sort((a, b) => a - b);
    const topAt = (offset: number) =>
      run.topPlane ? run.topPlane[0] * (x + dx * offset) + run.topPlane[1] * (y + dy * offset) + run.topPlane[2] - run.z0 : run.height;
    // Split at each plane/band crossing so a tapered jamb or head never extends
    // through the roof, including a triangular end at a zero-height intersection.
    if (run.topPlane) {
      const delta = topAt(length) - topAt(0);
      if (Math.abs(delta) > 1e-9)
        for (const z of zs) {
          const at = ((z - topAt(0)) * length) / delta;
          if (at > 0 && at < length) xs.push(at);
        }
      xs.sort((a, b) => a - b);
    }
    for (let a = 1; a < xs.length; a++)
      for (let b = 1; b < zs.length; b++) {
        const mid = (xs[a] + xs[a - 1]) / 2,
          zmid = (zs[b] + zs[b - 1]) / 2;
        if (openings.some((o) => mid > o.offset - o.width / 2 && mid < o.offset + o.width / 2 && zmid > o.sill && zmid < o.sill + o.height))
          continue;
        if (xs[a] - xs[a - 1] < 0.001 || zs[b] - zs[b - 1] < 0.001) continue;
        const height = Math.max(0, Math.min(zs[b], topAt(xs[a - 1])) - zs[b - 1]);
        const endHeight = Math.max(0, Math.min(zs[b], topAt(xs[a])) - zs[b - 1]);
        if (Math.max(height, endHeight) < 0.001) continue;
        parts.push({
          x: x + dx * xs[a - 1],
          y: y + dy * xs[a - 1],
          dx,
          dy,
          length: xs[a] - xs[a - 1],
          z: run.z0 + zs[b - 1],
          height,
          endHeight,
          thickness: run.thickness,
        });
      }
  }
  return parts;
}
