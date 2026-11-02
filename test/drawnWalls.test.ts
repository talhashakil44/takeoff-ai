import { describe, expect, it } from 'vitest';
import { isFloorPlan, measuredOver, planWalls } from '../src/build/drawnWalls';
import type { Segment } from '../src/fill/vectors';

// 1:100 on the sheet: a point is 0.3528 mm on paper, 35.28 mm on site.
const mpp = 0.0254 / 72 * 100;
const pt = (m: number) => m / mpp;
const line = (x1: number, y1: number, x2: number, y2: number): Segment => ({ x1, y1, x2, y2, width: 0.7, filled: false });

/** A rectangular building of walls drawn as pairs of faces (outer box and inner box, 200 mm apart). */
function building(x0: number, y0: number, w: number, h: number, t = pt(0.2)): Segment[] {
  const box = (a: number, b: number, c: number, d: number) => [line(a, b, c, b), line(c, b, c, d), line(c, d, a, d), line(a, d, a, b)];
  // One partition across the middle, its two faces.
  const mid = x0 + w / 2;
  return [...box(x0, y0, x0 + w, y0 + h), ...box(x0 + t, y0 + t, x0 + w - t, y0 + h - t), line(mid - t / 2, y0 + t, mid - t / 2, y0 + h - t), line(mid + t / 2, y0 + t, mid + t / 2, y0 + h - t)];
}

describe('walls read from the floor plan', () => {
  it('knows a floor plan from the other plans of a level', () => {
    expect(isFloorPlan({ name: 'A2.1', title: 'GROUND FLOOR PLAN' })).toBe(true);
    expect(isFloorPlan({ name: 'A213', title: 'Second Floor Plan' })).toBe(true);
    for (const title of ['REFLECTED CEILING PLAN - GROUND FLOOR', 'Ground Floor Removals Plan', 'Ground Floor Finishes Plan', 'ROOF PLAN', 'SECOND FLOOR PLAN - FIRE SEPARATION', 'ENLARGED PLAN'])
      expect(isFloorPlan({ name: 'A2.1', title })).toBe(false);
    expect(isFloorPlan({ name: 'M302', title: 'Ground Floor HVAC Plan' })).toBe(false);
  });

  it('reads every wall of the plan the takeoffs sit on, not a second view on the sheet', () => {
    const plan = building(pt(5), pt(5), pt(30), pt(15));
    const copy = building(pt(60), pt(5), pt(30), pt(15));
    const walls = planWalls([...plan, ...copy], mpp, [[pt(20), pt(12)]]);
    expect(walls.length).toBeGreaterThanOrEqual(5);
    // All on the first view, about 200 mm thick.
    for (const w of walls) {
      expect(Math.max(w.a[0], w.b[0])).toBeLessThan(pt(36));
      expect(w.thickness * mpp).toBeCloseTo(0.2, 1);
    }
    const length = walls.reduce((n, w) => n + Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) * mpp, 0);
    // The perimeter (about 89 m on the centreline) and the partition (about 15 m).
    expect(length).toBeGreaterThan(95);
    expect(length).toBeLessThan(115);
  });

  it('leaves a wall the takeoff already measured to the takeoff', () => {
    const measured = [{ points: [[0, 0], [10, 0]] as [number, number][], thickness: 0.2 }];
    expect(measuredOver([1, 0.05], [9, 0.05], 0.2, measured)).toBe(true);
    expect(measuredOver([1, 3], [9, 3], 0.2, measured)).toBe(false);
    expect(measuredOver([5, 0], [20, 0], 0.2, measured)).toBe(false);
  });
});
