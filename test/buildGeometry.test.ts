import { rejectUnsupportedCurtainWalls } from '../src/build/facades';
import type { BuildModel } from '../src/build/types';
import { wallFootprint } from '../src/build/footprint';
import { polygonArea, sealWallCorners } from '../src/build/building';
import { frameRectangles } from '../src/build/openingDetails';
import { imperialFeet } from '../src/build/datumEvidence';
import type { Project } from '../src/model';
import { gridAxes, registerSheets } from '../src/build/building';
import { describe, expect, it } from 'vitest';
import { geometryOf } from '../src/build/sceneGeometry';
import { runSolids } from '../src/build/solids';
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
  it('fills an orthogonal wall corner in shared viewer and IFC solids', () => {
    const parts = runSolids({
      type: 'run', points: [[0, 0], [10, 0], [10, 10]], z0: 0, height: 3, thickness: 0.2,
    });
    const contains = (x: number, y: number) => parts.some((p) => {
      const along = (x - p.x) * p.dx + (y - p.y) * p.dy;
      const across = -(x - p.x) * p.dy + (y - p.y) * p.dx;
      return along >= 0 && along <= p.length && Math.abs(across) <= p.thickness / 2;
    });
    expect(parts).toHaveLength(3);
    expect(contains(10.05, -0.05)).toBe(true);
    expect(contains(10.2, -0.2)).toBe(false);
  });
  it('fills a square corner across two separate measured wall runs', () => {
    const wall = (id: string, points: [number, number][]) => ({
      id, origin: 'takeoff', trade: 'partitions', level: 'L1', status: 'new',
      shape: { type: 'run', points, z0: 0, height: 3, thickness: 0.2 },
    }) as BuildElement;
    const a = wall('a', [[0, 0], [10, 0]]);
    const b = wall('b', [[10, 0], [10, 10]]);
    const model = { elements: [a, b] } as BuildModel;
    sealWallCorners(model);
    expect(a.shape?.type === 'run' && a.shape.cornerFills).toHaveLength(1);
    expect(b.shape?.type === 'run' && b.shape.cornerFills).toBeFalsy();
    expect(a.shape?.type === 'run' && runSolids(a.shape)).toHaveLength(2);
  });
  it('does not fill an ambiguous T junction or a corner occupied by an opening', () => {
    const wall = (id: string, points: [number, number][]) => ({
      id, origin: 'takeoff', trade: 'partitions', level: 'L1', status: 'new',
      shape: { type: 'run', points, z0: 0, height: 3, thickness: 0.2 },
    }) as BuildElement;
    const a = wall('a', [[0, 0], [10, 0]]);
    const b = wall('b', [[10, 0], [10, 10]]);
    const c = wall('c', [[10, 0], [10, -10]]);
    sealWallCorners({ elements: [a, b, c] } as BuildModel);
    expect(a.shape?.type === 'run' && a.shape.cornerFills).toBeFalsy();
    if (a.shape?.type !== 'run') throw Error('run missing');
    a.shape.openings = [{ elementId: 'door', segment: 0, offset: 9.95, width: 0.1, sill: 0, height: 2 }];
    sealWallCorners({ elements: [a, b] } as BuildModel);
    expect(a.shape.cornerFills).toBeFalsy();
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

it('keeps both ends of a sloped beam at constant section depth, without wall-like taper',()=>{
  const shape={type:'run' as const,points:[[0,0],[8,0]] as [number,number][],z0:8,height:.6,thickness:.265,topPlane:[.125,0,8.6] as [number,number,number],bottomPlane:[.125,0,8] as [number,number,number]};
  const solids=runSolids(shape);expect(solids).toHaveLength(1);expect(solids[0]).toMatchObject({z:8,endZ:9});expect(solids[0].height).toBeCloseTo(.6);expect(solids[0].endHeight).toBeCloseTo(.6);
  const geo=geometryOf(element(shape))!;const pos=geo.getAttribute('position');
  for(let i=0;i<pos.count;i++){const y=pos.getY(i)-.125*pos.getX(i);expect(Math.min(Math.abs(y-8),Math.abs(y-8.6))).toBeLessThan(1e-5);}
  geo.dispose();
});

it('extrudes the source I-profile rather than filling its web voids with a bounding box',()=>{
  const profile:[number,number][]=[[-.1,0],[.1,0],[.1,.02],[.01,.02],[.01,.28],[.1,.28],[.1,.3],[-.1,.3],[-.1,.28],[-.01,.28],[-.01,.02],[-.1,.02]];
  const shape={type:'run' as const,points:[[2,3],[2,7]] as [number,number][],z0:6,height:.3,thickness:.2,profile};
  const g=geometryOf(element(shape))!;g.computeBoundingBox();
  expect(g.boundingBox!.min.toArray()).toEqual(expect.arrayContaining([expect.closeTo(1.9,5),expect.closeTo(6,5),expect.closeTo(3,5)]));
  const p=g.getAttribute('position');let volume=0;
  for(let i=0;i<p.count;i+=3){const a=[p.getX(i),p.getY(i),p.getZ(i)],b=[p.getX(i+1),p.getY(i+1),p.getZ(i+1)],c=[p.getX(i+2),p.getY(i+2),p.getZ(i+2)];volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}
  expect(Math.abs(volume)).toBeCloseTo((2*.2*.02+.02*.26)*4,5);g.dispose();
});

it('exports a continuous sloping beam without coincident internal caps at source trace breaks', () => {
  const shape: Extract<BuildElement['shape'], {type:'run'}> = {
    type:'run',points:[[0,0],[2,0],[5,0]],z0:3,height:.6,thickness:.2,
    bottomPlane:[.125,0,3],topPlane:[.125,0,3.6],
  };
  const before=JSON.stringify(shape);
  expect(runSolids(shape)).toHaveLength(1);
  const indexed=geometryOf(element(shape))!;
  const g=indexed.index?indexed.toNonIndexed():indexed;
  const p=g.getAttribute('position'),edges=new Map<string,number>();
  const key=(i:number)=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(',');
  for(let i=0;i<p.count;i+=3)for(const [a,b] of [[i,i+1],[i+1,i+2],[i+2,i]]){
    const edge=[key(a),key(b)].sort().join('|');edges.set(edge,(edges.get(edge)??0)+1);
  }
  expect(p.count/3).toBe(12);
  expect([...edges.values()].every(n=>n===2)).toBe(true);
  expect(JSON.stringify(shape)).toBe(before);
  g.dispose();if(g!==indexed)indexed.dispose();
});
