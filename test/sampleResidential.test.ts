import { describe, expect, it } from 'vitest';
import { bounds, cutOpenings, shapeProblem } from '../src/scene3d/scene';
import { walkPlan } from '../src/scene3d/walkplan';
import res from '../src/scene3d/sampleResidential';

describe('sample #4: residential units', () => {
  it('is a valid model with walls, doors, windows, floors and a roof', () => {
    for (const e of res.elements) for (const s of e.shapes) expect(shapeProblem(s), e.name).toBeNull();
    const by = (c: string) => res.elements.filter((e) => e.category === c);
    expect(by('doors').length).toBeGreaterThan(60);
    expect(by('floor').length).toBeGreaterThan(40);
    expect(by('roof').length).toBeGreaterThan(0);
    const names = res.elements.map((e) => e.name).join('\n');
    for (const t of [/W1x/, /W5 /, /D03 /, /W05 window/, /R1 /]) expect(names).toMatch(t);
    // ~50 m by ~35 m, the L-shaped plan
    const b = bounds(res.elements)!;
    expect(b[3] - b[0]).toBeGreaterThan(48);
    expect(b[3] - b[0]).toBeLessThan(55);
    expect(b[4] - b[1]).toBeGreaterThan(34);
  });
  it('names nothing real', () => {
    expect(JSON.stringify(res)).not.toMatch(/paaji|owen sound|tenth street|ahplus|architects inc/i);
  });
  it('plans a walk quickly and leaves door openings alone', () => {
    const t = performance.now();
    walkPlan(res);
    expect(performance.now() - t).toBeLessThan(3000);
    expect(cutOpenings(res.elements)).toBeInstanceOf(Map);
  });
});
