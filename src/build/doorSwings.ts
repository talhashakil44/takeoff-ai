import type { Segment } from '../fill/vectors';

type Point = [number, number];
export interface DoorSwing {
  /** The PDF curve's bounding box, retained alongside the tag point as evidence. */
  box: [number, number, number, number];
  /** Either radial half-span could be the closed door leaf; the wall decides. */
  openingMidpoints: [Point, Point];
}
export interface DoorHostHint {
  /** Vector from the saved tag to a possible opening midpoint, in model metres. */
  delta: Point;
  box: DoorSwing['box'];
  tagDistanceM: number;
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const endpointKey = (p: Point) => `${Math.round(p[0] * 10)}:${Math.round(p[1] * 10)}`;

/** Reconnect curved PDF chords after the drawing-source cache has removed subpath IDs. */
export function doorSwings(lines: Segment[], metersPerPoint: number): DoorSwing[] {
  if (!Number.isFinite(metersPerPoint) || metersPerPoint <= 0) return [];
  const curves = lines.filter((l) => l.curve && !l.filled && !l.dashed &&
    Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 0.4);
  const ends = new Map<string, number[]>();
  const point = (l: Segment, last: boolean): Point => last ? [l.x2, l.y2] : [l.x1, l.y1];
  curves.forEach((l, i) => {
    for (const p of [point(l, false), point(l, true)]) {
      const key = endpointKey(p);
      ends.set(key, [...(ends.get(key) ?? []), i]);
    }
  });
  const seen = new Uint8Array(curves.length);
  const out: DoorSwing[] = [];
  for (let i = 0; i < curves.length; i++) {
    if (seen[i]) continue;
    seen[i] = 1;
    const group: number[] = [];
    const queue = [i];
    for (let q = 0; q < queue.length; q++) {
      const id = queue[q];
      group.push(id);
      for (const p of [point(curves[id], false), point(curves[id], true)])
        for (const next of ends.get(endpointKey(p)) ?? []) if (!seen[next]) {
          seen[next] = 1;
          queue.push(next);
        }
    }
    if (group.length < 3 || group.length > 10) continue;
    const pts = group.flatMap((id) => [point(curves[id], false), point(curves[id], true)]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const box: DoorSwing['box'] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const w = box[2] - box[0], h = box[3] - box[1];
    if (w / h < 0.72 || w / h > 1.28 || Math.min(w, h) * metersPerPoint < 0.45 ||
        Math.max(w, h) * metersPerPoint > 1.6) continue;
    const centers: Point[] = [[box[0], box[1]], [box[0], box[3]], [box[2], box[1]], [box[2], box[3]]];
    const fit = centers.map((c) => {
      const rs = pts.map((p) => distance(c, p));
      const radius = rs.reduce((a, b) => a + b, 0) / rs.length;
      const error = Math.sqrt(rs.reduce((sum, r) => sum + (r - radius) ** 2, 0) / rs.length) / radius;
      return { center: c, error };
    }).sort((a, b) => a.error - b.error)[0];
    if (!fit || fit.error > 0.08) continue;
    let far: [Point, Point] = [pts[0], pts[1]], farDistance = 0;
    for (const a of pts) for (const b of pts) {
      const d = distance(a, b);
      if (d > farDistance) { far = [a, b]; farDistance = d; }
    }
    if (farDistance < Math.max(w, h) * 1.2) continue;
    const midpoint = (p: Point): Point => [(p[0] + fit.center[0]) / 2, (p[1] + fit.center[1]) / 2];
    out.push({ box, openingMidpoints: [midpoint(far[0]), midpoint(far[1])] });
  }
  return out;
}

export function nearbyDoorSwings(swings: DoorSwing[], tag: Point, metersPerPoint: number, maxDistanceM = 2): DoorSwing[] {
  const gap = (s: DoorSwing) => Math.hypot(
    Math.max(s.box[0] - tag[0], 0, tag[0] - s.box[2]),
    Math.max(s.box[1] - tag[1], 0, tag[1] - s.box[3]),
  ) * metersPerPoint;
  return swings.filter((s) => gap(s) <= maxDistanceM).sort((a, b) => gap(a) - gap(b)).slice(0, 8);
}

/** Candidate points relative to the tag survive building centering and sheet registration. */
export function doorHostHints(swings: DoorSwing[], tag: Point, metersPerPoint: number, rotation = 0): DoorHostHint[] {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return nearbyDoorSwings(swings, tag, metersPerPoint).flatMap((arc) => {
    return arc.openingMidpoints.flatMap((p) => {
      const tagDistanceM = distance(tag, p) * metersPerPoint;
      if (tagDistanceM > 2) return [];
      const dx = p[0] - tag[0], dy = p[1] - tag[1];
      return [{ delta: [(dx * c - dy * s) * metersPerPoint, (dx * s + dy * c) * metersPerPoint] as Point, box: arc.box, tagDistanceM }];
    });
  });
}
