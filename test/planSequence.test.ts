import { describe, expect, it } from 'vitest';
import { planSequence, progressOn } from '../src/scene3d/sequence';
import type { Scene3D } from '../src/scene3d/scene';
import harbour from '../src/scene3d/sampleHarbour';

const box = { type: 'box' as const, min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
const scene: Scene3D = {
  version: 1, title: 't', origin: '', builtBy: '', updated: '',
  elements: [
    { id: 'wall', name: 'Existing wall', category: 'envelope', level: '', material: 'stucco', source: '', basis: '', shapes: [box] },
    { id: 'paint', name: 'Repaint', category: 'envelope', level: '', material: 'stucco', source: '', basis: '', shapes: [box], activity: 'paint' },
    { id: 'scaf', name: 'Scaffold', category: 'context', level: '', material: 'steel_grey', source: '', basis: '', shapes: [box], activity: 'up', until: 'down' },
  ],
  schedule: {
    start: '2027-05-03',
    activities: [
      { id: 'up', name: 'Erect scaffold', phase: 'mobilize', s: 0, e: 4 },
      { id: 'paint', name: 'Paint', phase: 'finishes', s: 5, e: 15 },
      { id: 'down', name: 'Strike scaffold', phase: 'mobilize', s: 16, e: 20 },
      { id: 'done', name: 'Complete', phase: 'closeout', s: 20, e: 20, milestone: true },
    ],
  },
};

describe('a model’s own 4D plan', () => {
  it('keeps existing work throughout, applies new work on its activity and takes temporary works down', () => {
    const seq = planSequence(scene)!;
    expect(seq.source).toBe('plan');
    expect(seq.days).toBe(20);
    const [wall, paint, scaf] = scene.elements;
    expect(progressOn(seq, wall, 0)).toBe(1);
    expect(progressOn(seq, paint, 2)).toBeLessThan(0);
    expect(progressOn(seq, paint, 16)).toBe(1);
    expect(progressOn(seq, scaf, 10)).toBe(1);
    expect(progressOn(seq, scaf, 18)).toBeGreaterThan(0);
    expect(progressOn(seq, scaf, 18)).toBeLessThan(1);
    expect(progressOn(seq, scaf, 20)).toBeLessThan(0);
  });

  it('is absent without a plan, and the repaint sample carries a three-month one', () => {
    expect(planSequence({ ...scene, schedule: undefined })).toBeNull();
    const seq = planSequence(harbour)!;
    expect(seq.days).toBeGreaterThanOrEqual(85);
    expect(seq.days).toBeLessThanOrEqual(95);
    const scaffold = harbour.elements.filter((e) => /scaffold/i.test(e.name));
    expect(scaffold.length).toBeGreaterThan(0);
    expect(scaffold.every((e) => progressOn(seq, e, seq.days) < 0)).toBe(true);
  });
});
