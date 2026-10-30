import { expect, it } from 'vitest';
import { cutOpenings } from '../src/build/building';
import { doorHostHints, doorSwings } from '../src/build/doorSwings';
import type { BuildElement, BuildModel } from '../src/build/types';
import type { Segment } from '../src/fill/vectors';

it('uses a quarter-circle swing to move a door from its saved tag to a wall opening', () => {
  const radius = 25, scale = 0.03;
  const arc: Segment[] = Array.from({ length: 4 }, (_, i) => ({
    x1: radius * Math.cos(i * Math.PI / 8), y1: radius * Math.sin(i * Math.PI / 8),
    x2: radius * Math.cos((i + 1) * Math.PI / 8), y2: radius * Math.sin((i + 1) * Math.PI / 8),
    curve: true, filled: false, width: 1,
  }));
  const circle: Segment[] = Array.from({ length: 16 }, (_, i) => ({
    x1: 50 + 8 * Math.cos(i * Math.PI / 8), y1: 50 + 8 * Math.sin(i * Math.PI / 8),
    x2: 50 + 8 * Math.cos((i + 1) * Math.PI / 8), y2: 50 + 8 * Math.sin((i + 1) * Math.PI / 8),
    curve: true, filled: false, width: 1,
  }));
  const swings = doorSwings([...arc, ...circle], scale);
  expect(swings).toHaveLength(1);
  const tag: [number, number] = [5, 50];
  const door = {
    id: 'door-1', trade: 'doors', typeName: 'Doors', level: 'L1', sheetId: 'A1',
    shape: { type: 'point', at: [tag[0] * scale, tag[1] * scale], z: 0, size: [0.9, 0.15, 2.1] },
    sources: [{ kind: 'sheet', id: 'A1', page: 1, label: 'A1', box: [5, 50, 5, 50] }], issues: [],
  } as BuildElement;
  const wall = {
    id: 'wall-1', trade: 'partitions', level: 'L1', sheetId: 'A1',
    shape: { type: 'run', points: [[-2, 0], [2, 0]], z0: 0, height: 3, thickness: 0.15 },
  } as BuildElement;
  const model = { elements: [door, wall], issues: [] } as unknown as BuildModel;
  cutOpenings(model, new Map([['door-1', doorHostHints(swings, tag, scale)]]), new Set(['A1']));
  expect(wall.shape?.type === 'run' && wall.shape.openings?.map((o) => o.elementId)).toEqual(['door-1']);
  expect(door.shape?.type === 'point' && door.shape.at[1]).toBe(0);
  expect(door.sources[0].box).toEqual([5, 50, 5, 50]);
  expect(door.sources[1].box).toEqual(swings[0].box);
  expect(door.issues.some((s) => s.startsWith('Door swing located'))).toBe(true);
});

it('flags an unmatched tag without inventing a wall host', () => {
  const door = {
    id: 'door-2', trade: 'doors', typeName: 'Doors', level: 'L1', sheetId: 'A1',
    shape: { type: 'point', at: [5, 5], z: 0, size: [0.9, 0.15, 2.1] },
    sources: [{ kind: 'sheet', id: 'A1', page: 1, label: 'A1', box: [1, 2, 1, 2] }], issues: [],
  } as BuildElement;
  const model = { elements: [door], issues: [] } as unknown as BuildModel;
  cutOpenings(model, new Map(), new Set(['A1']));
  expect(model.issues.some((issue) => issue.id === 'door-opening-evidence-missing')).toBe(true);
  expect(door.issues).toContain('No wall within 600 mm of opening tag; host unknown.');
});
