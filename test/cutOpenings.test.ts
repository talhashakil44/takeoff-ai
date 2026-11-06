import { describe, expect, it } from 'vitest';
import { cutOpenings, type Element3D } from '../src/scene3d/scene';
import shop from '../src/scene3d/sample';

const wall = (id: string, from: [number, number], to: [number, number], category = 'interior'): Element3D =>
  ({ id, name: id, category, material: 'drywall', shapes: [{ type: 'wall', from, to, thickness: 0.15, z0: 0, z1: 3 }] }) as Element3D;

describe('door and window openings', () => {
  it('cuts a door through the wall it sits in, not the wall it meets end on', () => {
    const els = [
      wall('A', [0, 0], [10, 0]),
      wall('B', [4, 0], [4, 5]),
      { id: 'D', name: 'Door', category: 'doors', material: 'door', shapes: [{ type: 'wall', from: [3, 0], to: [3.9, 0], thickness: 0.05, z0: 0, z1: 2.1 }] } as Element3D,
    ];
    const cut = cutOpenings(els);
    expect(cut.has('B')).toBe(false);
    const s = cut.get('A')![0] as { openings: { start: number; end: number; sill: number; head: number }[] };
    expect(s.openings[0].start).toBeCloseTo(2.975, 2);
    expect(s.openings[0].end).toBeCloseTo(3.925, 2);
    expect(s.openings[0].sill).toBe(0);
    expect(s.openings[0].head).toBeCloseTo(2.1);
  });
  it('opens the maintenance shop rooms (their walls ran through the doors)', () => {
    const cut = cutOpenings(shop.elements);
    const opened = [...cut.keys()].map((id) => shop.elements.find((e) => e.id === id)!.name);
    expect(opened).toEqual(expect.arrayContaining([expect.stringMatching(/washroom corridor/), expect.stringMatching(/mechanical room 104/), expect.stringMatching(/East wall above the office/)]));
  });
});
