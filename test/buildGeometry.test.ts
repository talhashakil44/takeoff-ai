import { rejectUnsupportedCurtainWalls } from '../src/build/facades';
import type { BuildModel } from '../src/build/types';
import { wallFootprint } from '../src/build/footprint';
import { polygonArea } from '../src/build/building';
import { frameRectangles } from '../src/build/openingDetails';
import { imperialFeet } from '../src/build/datumEvidence';
import type { Project } from '../src/model';
import { gridAxes, registerSheets } from '../src/build/building';
import { describe, expect, it } from 'vitest';
import { geometryOf } from '../src/build/sceneGeometry';
import type { BuildElement } from '../src/build/types';
const element = (shape: BuildElement['shape']) => ({ shape }) as BuildElement;
describe('shared building geometry', () => {
  it('reads fractional imperial elevation datums without confusing dimensions or dates', () => {
    expect(imperialFeet(`111'-1 3/4"`)).toBeCloseTo(111 + 1.75 / 12);
    expect(imperialFeet(`89'-0"`)).toBe(89);
    expect(imperialFeet("Mar. 03 '25")).toBeNull();
    expect(imperialFeet(`1/8" = 1'-0"`)).toBeNull();
  });
  it('resolves duplicate plan grids near the takeoff, not the far copy', () => {
    const texts = [100, 600].flatMap((x) => ['A', 'B', 'C'].flatMap((str, i) => [10, 800].map((cy) => ({ str, cx: x + i * 50, cy }))));
    expect(gridAxes(texts, 1000, 900, [150, 400]).A.at).toBe(100);
    expect(gridAxes(texts, 1000, 900, [650, 400]).A.at).toBe(600);
  });
  it('registers a quarter-turned structural grid using matching spacing', () => {
    const ref = [100, 300, 500]
      .flatMap((cx, i) => [10, 900].map((cy) => ({ str: ['A', 'B', 'C'][i], cx, cy })))
      .concat([200, 400, 600].flatMap((cy, i) => [10, 900].map((cx) => ({ str: String(i + 1), cx, cy }))));
    const rotated = [100, 300, 500]
      .map((cy, i) => ({ str: ['A', 'B', 'C'][i], cx: 800, cy }))
      .concat([800, 600, 400].map((cx, i) => ({ str: String(i + 1), cx, cy: 700 })));
    const project = {
      sheets: ['ref', 'rot'].map((id) => ({ id, title: 'Floor plan', width: 1000, height: 1000, metersPerPoint: 0.1 })),
      measurements: [],
    } as unknown as Project;
    const reg = registerSheets(project, { ref, rot: rotated }).rot;
    expect(reg).toBeTruthy();
    expect(reg.rotation).toBeCloseTo((3 * Math.PI) / 2);
    expect(reg.x).toBeCloseTo(0);
    expect(reg.y).toBeCloseTo(-100);
  });
  it('keeps wall endpoints at their actual model coordinates', () => {
    const g = geometryOf(
      element({
        type: 'run',
        points: [
          [100, 200],
          [110, 200],
        ],
        z0: 4,
        height: 3,
        thickness: 0.2,
      }),
    )!;
    g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBeCloseTo(100);
    expect(g.boundingBox!.max.x).toBeCloseTo(110);
    expect(g.boundingBox!.min.z).toBeCloseTo(199.9, 3);
    expect(g.boundingBox!.min.y).toBeCloseTo(4);
    expect(g.boundingBox!.max.y).toBeCloseTo(7);
    g.dispose();
  });
  it('keeps rotated wall runs and hosted openings on the same coordinates', () => {
    const g = geometryOf(
      element({
        type: 'run',
        points: [
          [-20, 50],
          [-20, 60],
        ],
        z0: 0,
        height: 3,
        thickness: 0.2,
        openings: [{ elementId: 'door', segment: 0, offset: 5, width: 1, sill: 0, height: 2 }],
      }),
    )!;
    g.computeBoundingBox();
    expect(g.boundingBox!.min.z).toBeCloseTo(50);
    expect(g.boundingBox!.max.z).toBeCloseTo(60);
    expect(g.boundingBox!.min.x).toBeCloseTo(-20.1, 3);
    g.dispose();
  });
  it('fits exterior wall heads to the roof plane without moving their base', () => {
    const g = geometryOf(
      element({
        type: 'run',
        points: [
          [0, 0],
          [10, 0],
        ],
        z0: 4,
        height: 6,
        thickness: 0.2,
        topPlane: [0.2, 0, 8],
      }),
    )!;
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeLessThanOrEqual(8 + 0.2 * p.getX(i) + 0.00001);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(4);
    expect(g.boundingBox!.max.y).toBeCloseTo(10);
    g.dispose();
  });
  it('builds a sloped roof with the specified heights and vertical thickness', () => {
    const g = geometryOf(
      element({
        type: 'surface',
        ring: [
          [0, 0],
          [10, 0],
          [10, 20],
          [0, 20],
        ],
        holes: [],
        z: 8,
        slope: [0.2, 0],
        thickness: 0.25,
      }),
    )!;
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const relative = p.getY(i) - (0.2 * p.getX(i) + 8);
      expect(Math.min(Math.abs(relative), Math.abs(relative - 0.25))).toBeLessThan(0.00001);
    }
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeCloseTo(10.25);
    g.dispose();
  });
});

describe('drawing-derived boundaries', () => {
  const wall = (points: [number, number][]) => element({ type: 'run', points, z0: 0, height: 3, thickness: 0.2 });
  it('retains a deep wing recess while closing a doorway gap', () => {
    const ring = wallFootprint([
      wall([
        [0, 0],
        [20, 0],
        [20, 8],
        [8, 8],
        [8, 20],
        [0, 20],
        [0, 12],
      ]),
      wall([
        [0, 11],
        [0, 0],
      ]),
    ]);
    expect(ring).not.toBeNull();
    expect(polygonArea(ring!)).toBeCloseTo(256, -1);
    expect(polygonArea(ring!)).toBeLessThan(300);
  });
  it('does not invent a floor from an open U with a wide missing side', () => {
    expect(
      wallFootprint([
        wall([
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ]),
      ]),
    ).toBeNull();
  });
  it('requires four supported edges for a window frame', () => {
    const seg = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, width: 1, filled: false });
    const edges = [seg(10, 10, 40, 10), seg(10, 50, 40, 50), seg(10, 10, 10, 50), seg(40, 10, 40, 50)];
    const region = { x0: 0, y0: 0, x1: 100, y1: 100 };
    expect(frameRectangles(edges, region)).toHaveLength(1);
    expect(frameRectangles(edges.slice(0, 3), region)).toHaveLength(0);
  });
});

it('retains curtain-wall quantity without inventing assembly dimensions', () => {
  const e = {
    ...element({ type: 'point', at: [0, 0], z: 0, size: [0.95, 0.12, 2.1] }),
    origin: 'takeoff',
    trade: 'doors',
    name: 'CW1 – Window',
    typeName: 'CW1',
    id: 'cw',
    quantity: 2,
    issues: [],
    sources: [],
  } as BuildElement;
  const model = { elements: [e], issues: [] } as unknown as BuildModel;
  rejectUnsupportedCurtainWalls(model);
  expect(e.shape).toBeNull();
  expect(e.quantity).toBe(2);
  expect(model.issues[0].refs).toEqual(['cw']);
});
