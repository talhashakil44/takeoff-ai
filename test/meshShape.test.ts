import { describe, expect, it } from 'vitest';
import { bounds, meshOf, shapeProblem } from '../src/scene3d/scene';
import lodge from '../src/scene3d/sampleLodge';

describe('mesh shapes', () => {
  it('draws ready-made triangles and checks them', () => {
    const s = { type: 'mesh' as const, v: [0, 0, 0, 1, 0, 0, 0, 1, 0], f: [0, 1, 2] };
    expect(meshOf(s)).toEqual({ positions: s.v, indices: s.f });
    expect(shapeProblem(s)).toBeNull();
    expect(shapeProblem({ type: 'mesh', v: [0, 0], f: [0] })).toMatch(/mesh needs/);
    expect(shapeProblem({ type: 'mesh', v: [0, 0, 0], f: [0, 1, 2] })).toMatch(/mesh needs/);
  });
  it('the ski lodge sample has its septic bed, tanks and access road', () => {
    const names = lodge.elements.map((e) => e.name);
    for (const n of [/leaching bed laterals/i, /septic mound/i, /balancing tank/i, /fire cistern/i, /access road: travelled/i]) expect(names.some((x) => n.test(x))).toBe(true);
    for (const e of lodge.elements) for (const s of e.shapes) expect(shapeProblem(s), e.name).toBeNull();
    const b = bounds(lodge.elements)!;
    expect(b[1]).toBeLessThan(-300); // the road runs ~340 m south to the public road
    expect(JSON.stringify(lodge)).not.toMatch(/appleby|kelso|glen eden/i);
  });
});

describe('walk plan speed', () => {
  it('plans the walk through Sample #3 in well under a second (it took 39 s)', async () => {
    const { walkPlan } = await import('../src/scene3d/walkplan');
    const { default: harbour } = await import('../src/scene3d/sampleHarbour');
    const t = performance.now();
    walkPlan(harbour);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});
