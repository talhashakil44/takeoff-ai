import { describe, expect, it } from 'vitest';
import type { Element3D, Scene3D, Shape3D } from '../src/scene3d/scene';
import { clearAt, findPath, floorLevels, levelGrid, roomsOf, solidsOf, walkPlan } from '../src/scene3d/walkplan';
import SHOP from '../src/scene3d/sample';
import LODGE from '../src/scene3d/sampleLodge';

const el = (id: string, category: string, shapes: Shape3D[], extra: Partial<Element3D> = {}): Element3D => ({ id, name: id, category, level: 'Ground', material: 'block', source: '', basis: '', shapes, ...extra });
const wall = (from: [number, number], to: [number, number], openings?: { start: number; end: number; sill: number; head: number }[]): Shape3D => ({ type: 'wall', from, to, thickness: 0.2, z0: 0, z1: 3, openings });

/** Two 6 × 5 m rooms side by side, a door between them and a front door to the south, a street to the south. */
const twoRooms: Scene3D = {
  version: 1, title: 'Two rooms', origin: '', builtBy: 'test', updated: '',
  elements: [
    el('slab', 'floor', [{ type: 'slab', polygon: [[0, 0], [12, 0], [12, 5], [0, 5]], z0: -0.2, z1: 0 }]),
    el('Floor finish: Office 101', 'floor', [{ type: 'slab', polygon: [[0, 0], [6, 0], [6, 5], [0, 5]], z0: 0, z1: 0.01 }]),
    el('south', 'envelope', [wall([0, 0], [12, 0], [{ start: 2.5, end: 3.5, sill: 0, head: 2.1 }])]),
    el('north', 'envelope', [wall([0, 5], [12, 5])]),
    el('west', 'envelope', [wall([0, 0], [0, 5])]),
    el('east', 'envelope', [wall([12, 0], [12, 5])]),
    el('middle', 'interior', [wall([6, 0], [6, 5], [{ start: 2, end: 3, sill: 0, head: 2.1 }])]),
    el('Front door', 'doors', [{ type: 'wall', from: [2.5, 0], to: [3.5, 0], thickness: 0.05, z0: 0, z1: 2.1 }]),
    el('road', 'paving', [{ type: 'slab', polygon: [[-10, -20], [20, -20], [20, -12], [-10, -12]], z0: -0.1, z1: 0 }], { material: 'asphalt' }),
  ],
};

describe('walk plan', () => {
  it('reads levels from the floor slabs', () => {
    expect(floorLevels(twoRooms).map((l) => l.z)).toEqual([0]);
    expect(floorLevels(SHOP).map((l) => l.name)).toEqual(['Ground floor', 'Mezzanine']);
    expect(floorLevels(SHOP)[1].z).toBeCloseTo(2.85);
    expect(floorLevels(LODGE).map((l) => Math.round(l.z))).toEqual([0, 4]);
  });

  it('splits a wall at its openings', () => {
    const s = solidsOf(wall([0, 0], [10, 0], [{ start: 2, end: 3, sill: 0.9, head: 2.1 }]));
    expect(s.length).toBe(4);
    expect(s.some((p) => p.z0 === 0 && p.z1 === 0.9)).toBe(true);
  });

  it('finds the rooms, the door between them and a route through it', () => {
    const [level] = floorLevels(twoRooms);
    const g = levelGrid(twoRooms, level)!;
    expect(clearAt(g, [3, 2.5])).toBeGreaterThan(1.5);
    expect(clearAt(g, [6, 4])).toBe(0);
    expect(clearAt(g, [6, 2.5])).toBeGreaterThan(0);
    const rooms = roomsOf(twoRooms, g);
    expect(rooms.length).toBe(2);
    expect(rooms.map((r) => r.name)).toContain('Office 101');
    const path = findPath(g, [3, 2.5], [9, 2.5])!;
    expect(path.length).toBeGreaterThanOrEqual(2);
    // Every step of the route stays off the walls.
    for (let i = 0; i < path.length - 1; i++)
      for (let t = 0; t <= 1; t += 0.05) expect(clearAt(g, [path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t])).toBeGreaterThan(0);
  });

  it('starts outside the front door, facing it, on the street side', () => {
    const p = walkPlan(twoRooms);
    expect(p.entrance?.name).toBe('Front door');
    expect(p.entrance?.out[1]).toBeCloseTo(-1);
    expect(p.street[1]).toBeLessThan(-0.9);
    expect(p.start.at[1]).toBeLessThan(0);
    expect(p.start.at[2]).toBeCloseTo(1.6);
    expect(p.start.look[1]).toBeGreaterThan(p.start.at[1]);
    expect(p.stops[0].title).toBe('Front entrance');
    expect(p.stops.length).toBe(3);
    // The first room is reached through the front door.
    expect(p.stops[1].route?.some((q) => Math.abs(q[1]) < 0.3 && q[0] > 2.4 && q[0] < 3.6)).toBe(true);
  });

  it('plans both samples', () => {
    for (const [scene, door] of [[SHOP, /entrance/i], [LODGE, /door/i]] as const) {
      const p = walkPlan(scene);
      expect(p.entrance?.name).toMatch(door);
      expect(p.levels.length).toBe(2);
      expect(p.stops.length).toBeGreaterThan(4);
      expect(p.stops.some((s) => s.level === 1)).toBe(true);
      for (const s of p.stops) expect([...s.at, ...s.look].every(Number.isFinite)).toBe(true);
    }
  });
});
