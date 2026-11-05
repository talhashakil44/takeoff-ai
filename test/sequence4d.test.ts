import { describe, expect, it } from 'vitest';
import lodge from '../src/scene3d/sampleLodge';
import shop from '../src/scene3d/sample';
import { dayOf, isoDay, modelSequence, nextStart, phaseOf, progressOn, scheduleSequence, type Activity4D } from '../src/scene3d/sequence';
import type { Element3D } from '../src/scene3d/scene';

const el = (id: string, category: string, material: string, z0: number, level = 'Ground floor', name = id): Element3D => ({
  id, name, category, level, material, source: '', basis: '', shapes: [{ type: 'box', min: [0, 0, z0], max: [1, 1, z0 + 1] }],
});

describe('4D sequence from the model', () => {
  for (const scene of [lodge, shop]) {
    it(`builds ${scene.title} in order, ending with everything in place`, () => {
      const seq = modelSequence(scene, '2027-04-05');
      const act = (id: string) => seq.activities.find((a) => a.id === id);
      expect(act('foundations')!.s).toBeLessThan(seq.activities.find((a) => a.phase === 'structure')!.s);
      expect(act('roof')!.s).toBeGreaterThan(act('foundations')!.e - 1);
      expect(act('landscape')!.e).toBe(seq.days);
      // Every element the job builds has days inside the schedule; at the end all are in place.
      for (const e of scene.elements) {
        const t = seq.install.get(e.id);
        if (!phaseOf(e)) expect(t).toBeUndefined();
        else {
          expect(t!.s).toBeGreaterThanOrEqual(0);
          expect(t!.e).toBeLessThanOrEqual(seq.days);
        }
        expect(progressOn(seq, e, seq.days)).toBe(1);
      }
      // Before the work starts only existing things stand.
      expect(scene.elements.filter((e) => progressOn(seq, e, 0) >= 0).every((e) => !phaseOf(e) || seq.install.get(e.id)!.s === 0)).toBe(true);
      expect(seq.activities.some((a) => a.milestone && a.name === 'Substantial completion' && a.s === seq.days)).toBe(true);
    });
  }

  it('goes up from the bottom within an activity', () => {
    const scene = { version: 1 as const, title: 't', origin: '', builtBy: '', updated: '', elements: [el('b', 'structure', 'steel', 4), el('a', 'structure', 'steel', 0)] };
    const seq = modelSequence(scene, '2027-01-04');
    expect(seq.install.get('a')!.s).toBeLessThan(seq.install.get('b')!.s);
    expect(progressOn(seq, scene.elements[1], seq.install.get('a')!.s)).toBe(0);
  });

  it('keeps existing things standing', () => {
    expect(phaseOf(el('x', 'context', 'gravel', 0, 'Site', 'Railway corridor (existing)'))).toBeNull();
    expect(phaseOf(el('y', 'context', 'tree', 0, 'Site', 'New trees'))).toBe('landscape');
  });
});

describe('4D sequence on a schedule', () => {
  it('puts elements on their activity and fits the rest in', () => {
    const scene = { version: 1 as const, title: 't', origin: '', builtBy: '', updated: '', elements: [el('f', 'foundation', 'concrete', -1), el('w', 'envelope', 'brick', 0), el('p', 'paving', 'asphalt', 0)] };
    const acts: Activity4D[] = [
      { id: 'A', name: 'Footings', phase: 'foundations', s: 10, e: 20, count: 0 },
      { id: 'B', name: 'Walls', phase: 'envelope', s: 30, e: 60, count: 0 },
      { id: 'M', name: 'Done', phase: 'closeout', s: 90, e: 90, milestone: true, count: 0 },
    ];
    const seq = scheduleSequence(scene, { start: '2027-01-04', activities: acts, activityOf: (e) => (e.category === 'foundation' ? 'A' : e.category === 'envelope' ? 'B' : null), source: 'generated' });
    expect(seq.days).toBe(90);
    expect(seq.install.get('f')).toMatchObject({ s: 10, e: 20, act: 'A' });
    expect(seq.install.get('w')!.s).toBe(30);
    expect(seq.install.get('p')!.e).toBeLessThanOrEqual(90);
    expect(seq.activities.find((a) => a.id === 'B')!.count).toBe(1);
  });

  it('counts calendar days', () => {
    expect(isoDay('2027-04-01', 30)).toBe('2027-05-01');
    expect(dayOf('2027-04-01', '2028-08-30')).toBe(517);
    expect(new Date(`${nextStart(new Date('2026-11-04T10:00:00Z'))}T12:00:00Z`).getUTCDay()).toBe(1);
  });
});
