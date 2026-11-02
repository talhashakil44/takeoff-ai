import type { Pt, Sheet } from '../model';
import type { Segment } from '../fill/vectors';
import { buildWallModel } from '../fill/roomFill';
import { wallTakeoff } from '../walls/wallTakeoff';
import type { WallRun } from '../walls/bands';

/**
 * The walls drawn on each level's floor plan, read from its linework (paired wall faces), so the
 * model shows the whole building and not only what has been measured. They go in the model's
 * drawing geometry: shown in 3D and lifted in Explore, never counted in the takeoff or the plan.
 */

/** An architectural floor plan: the plan a level's walls are read from (not its ceiling, removals or finishes plan). */
export const isFloorPlan = (s: Pick<Sheet, 'name' | 'title'>) =>
  /^A/i.test(s.name ?? '') &&
  /\bPLAN\b/i.test(s.title ?? '') &&
  !/REFLECTED|CEILING|\bRCP\b|REMOVAL|DEMOLITION|FINISH|FIRE SEP|LIFE SAFETY|EGRESS|CODE|FURNITURE|ENLARGED|ENLARGEMENT|PART(?:IAL)? PLAN|DETAIL|SITE|ROOF|KEY PLAN|SEQUENC|PHASING|FOUNDATION|STAIR|MECH|ELEC|PLUMB/i.test(s.title ?? '');

const len = (r: WallRun) => Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);

/**
 * The walls of the one floor plan drawn on a sheet, in sheet points. A sheet can carry more than
 * one view (two halves, a key plan, a legend in wall pens): the walls are grouped by how close
 * they lie, and the group the sheet's takeoffs sit in is the plan (the longest group when the
 * sheet has none).
 */
export function planWalls(lines: Segment[], metersPerPoint: number, focus: Pt[] = []): WallRun[] {
  if (!lines.length || !metersPerPoint) return [];
  const model = buildWallModel(lines, metersPerPoint);
  if (!model.lines.length) return [];
  const runs = wallTakeoff(model.lines, lines, [], metersPerPoint, { doors: model.openings, throughDoors: false }).runs.filter(
    (r) => len(r) * metersPerPoint >= 0.3,
  );
  if (!runs.length) return [];
  // Groups of walls whose boxes come within 2 m of each other.
  const gap = 2 / metersPerPoint;
  const box = (r: WallRun) => [Math.min(r.a[0], r.b[0]), Math.min(r.a[1], r.b[1]), Math.max(r.a[0], r.b[0]), Math.max(r.a[1], r.b[1])];
  const boxes = runs.map(box);
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const order = runs.map((_, i) => i).sort((i, j) => boxes[i][0] - boxes[j][0]);
  for (let x = 0; x < order.length; x++) {
    const i = order[x];
    for (let y = x + 1; y < order.length; y++) {
      const j = order[y];
      if (boxes[j][0] > boxes[i][2] + gap) break;
      if (boxes[j][1] <= boxes[i][3] + gap && boxes[i][1] <= boxes[j][3] + gap) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  runs.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  const extent = (ids: number[]) => ids.reduce((b, i) => [Math.min(b[0], boxes[i][0]), Math.min(b[1], boxes[i][1]), Math.max(b[2], boxes[i][2]), Math.max(b[3], boxes[i][3])], [Infinity, Infinity, -Infinity, -Infinity]);
  const scored = [...groups.values()].map((ids) => {
    const b = extent(ids);
    return { ids, b, inside: focus.filter((p) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]).length, length: ids.reduce((n, i) => n + len(runs[i]), 0) };
  });
  scored.sort((a, b) => b.inside - a.inside || b.length - a.length);
  const main = scored[0];
  // A plan is a building's worth of wall: a group under 10 m of wall is a symbol or a legend.
  if (main.length * metersPerPoint < 10) return [];
  // Other groups within the plan's extent (a stair or core drawn apart from the walls round it).
  const keep = scored.filter((g) => g === main || (g.b[0] >= main.b[0] && g.b[2] <= main.b[2] && g.b[1] >= main.b[1] && g.b[3] <= main.b[3]));
  return keep.flatMap((g) => g.ids.map((i) => runs[i]));
}

/** Does a measured wall already stand where this drawn wall is (parallel, on it, over most of its length)? */
export function measuredOver(a: Pt, b: Pt, thickness: number, measured: { points: Pt[]; thickness: number }[]): boolean {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!L) return true;
  const [ux, uy] = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  let covered = 0;
  const spans: [number, number][] = [];
  for (const m of measured)
    for (let i = 1; i < m.points.length; i++) {
      const p = m.points[i - 1],
        q = m.points[i];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l < 0.05) continue;
      // Parallel within about 5°.
      if (Math.abs(((q[0] - p[0]) / l) * -uy + ((q[1] - p[1]) / l) * ux) > 0.09) continue;
      const off = (pt: Pt) => Math.abs((pt[0] - a[0]) * -uy + (pt[1] - a[1]) * ux);
      if (Math.max(off(p), off(q)) > (thickness + m.thickness) / 2 + 0.1) continue;
      const t0 = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy,
        t1 = (q[0] - a[0]) * ux + (q[1] - a[1]) * uy;
      const s0 = Math.max(0, Math.min(t0, t1)),
        s1 = Math.min(L, Math.max(t0, t1));
      if (s1 > s0) spans.push([s0, s1]);
    }
  spans.sort((x, y) => x[0] - y[0]);
  let end = 0;
  for (const [s0, s1] of spans) {
    if (s1 <= end) continue;
    covered += s1 - Math.max(s0, end);
    end = s1;
  }
  return covered >= 0.8 * L;
}
