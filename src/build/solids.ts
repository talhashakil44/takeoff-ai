import type { ElementShape } from './types';
import type { Pt } from '../model';
/** Drawing interruptions can introduce redundant vertices along one member.
 * Remove only forward collinear joins so one solid has no internal end caps. */
export function continuousRunPoints(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    if (out.length && Math.hypot(p[0] - out.at(-1)![0], p[1] - out.at(-1)![1]) < 1e-8) continue;
    while (out.length >= 2) {
      const a = out.at(-2)!, b = out.at(-1)!;
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = p[0] - b[0], vy = p[1] - b[1];
      if (ux * vx + uy * vy <= 0 || Math.abs(ux * vy - uy * vx) > 1e-8 * Math.hypot(ux, uy) * Math.hypot(vx, vy)) break;
      out.pop();
    }
    out.push(p);
  }
  return out;
}
/** Shared wall solids keep the viewer and IFC geometry identical, including rectangular voids. */
export function runSolids(run: Extract<ElementShape, { type: 'run' }>) {
  // Opening offsets and explicit corner fills are tied to original segments.
  if (!run.openings?.length && !run.cornerFills?.length)
    run = { ...run, points: continuousRunPoints(run.points) };
  const parts: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    length: number;
    z: number;
    height: number;
    endHeight: number;
    endZ?: number;
    thickness: number;
  }[] = [];
  // A sloping member has parallel top and bottom planes; never taper it down
  // to a flat storey datum as a roof-following wall would.
  if (run.bottomPlane && run.topPlane && !run.openings?.length) {
    const at = (plane: [number,number,number], p: [number,number]) => plane[0]*p[0]+plane[1]*p[1]+plane[2];
    for(let i=1;i<run.points.length;i++) {
      const a=run.points[i-1],b=run.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const z=at(run.bottomPlane,a),endZ=at(run.bottomPlane,b),height=at(run.topPlane,a)-z,endHeight=at(run.topPlane,b)-endZ;
      if(length<.02||Math.min(height,endHeight)<=0)continue;
      parts.push({x:a[0],y:a[1],dx:(b[0]-a[0])/length,dy:(b[1]-a[1])/length,length,z,endZ,height,endHeight,thickness:run.thickness});
    }
    return parts;
  }
  const addCornerFill = (at: [number, number], dx: number, dy: number, turn: number, size: number) => {
    const outwardX = Math.sign(turn) * dy;
    const outwardY = -Math.sign(turn) * dx;
    const x = at[0] + outwardX * size / 4;
    const y = at[1] + outwardY * size / 4;
    const fillLength = size / 2;
    const head = (px: number, py: number) => run.topPlane
      ? Math.max(0, run.topPlane[0] * px + run.topPlane[1] * py + run.topPlane[2] - run.z0)
      : run.height;
    const height = head(x, y);
    const endHeight = head(x + dx * fillLength, y + dy * fillLength);
    if (Math.max(height, endHeight) < 0.001) return;
    parts.push({ x, y, dx, dy, length: fillLength, z: run.z0, height, endHeight, thickness: fillLength });
  };
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
  // Butt-ended segment boxes leave a quarter-width void outside a square turn.
  // A small shared solid closes it in both the viewer and the IFC export.
  const closed = run.points.length > 3 && Math.hypot(
    run.points[0][0] - run.points.at(-1)![0],
    run.points[0][1] - run.points.at(-1)![1],
  ) < 0.001;
  const joints = Array.from({ length: run.points.length - 2 }, (_, i) => i + 1);
  if (closed) joints.push(0);
  for (const i of joints) {
    const prev = run.points[i === 0 ? run.points.length - 2 : i - 1];
    const at = run.points[i];
    const next = run.points[i + 1];
    const beforeLength = Math.hypot(at[0] - prev[0], at[1] - prev[1]);
    const afterLength = Math.hypot(next[0] - at[0], next[1] - at[1]);
    if (beforeLength < 0.02 || afterLength < 0.02 || run.thickness <= 0) continue;
    const dx = (at[0] - prev[0]) / beforeLength;
    const dy = (at[1] - prev[1]) / beforeLength;
    const nextDx = (next[0] - at[0]) / afterLength;
    const nextDy = (next[1] - at[1]) / afterLength;
    const turn = dx * nextDy - dy * nextDx;
    // The quarter-width fill below is exact for a square turn. Other angles
    // need a proper mitre profile and should keep their source geometry.
    if (Math.abs(dx * nextDx + dy * nextDy) > 0.1) continue;
    const beforeSegment = i === 0 ? run.points.length - 2 : i - 1;
    const afterSegment = i;
    if ((run.openings ?? []).some((o) =>
      (o.segment === beforeSegment && o.offset + o.width / 2 > beforeLength - run.thickness / 2) ||
      (o.segment === afterSegment && o.offset - o.width / 2 < run.thickness / 2)
    )) continue;
    addCornerFill(at, dx, dy, turn, run.thickness);
  }
  for (const fill of run.cornerFills ?? [])
    addCornerFill(fill.at, fill.incoming[0], fill.incoming[1], fill.turn, fill.size);
  return parts;
}
