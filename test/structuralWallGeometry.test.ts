import { describe, expect, it } from 'vitest';
import { connectStructuralWalls } from '../src/build/structuralWallGeometry';
import type { Project } from '../src/model';
import type { BuildElement, BuildModel } from '../src/build/types';
const wall = {
  id: 'w',
  measurementId: 'm',
  sheetId: 's',
  origin: 'takeoff',
  trade: 'structure',
  typeName: 'WT-1 – Structural wall 38 x 140 (2x6) @ 400 O.C.',
  level: 'L1',
  quantity: 29.468,
  unit: 'm',
  placement: 'inferred',
  shape: {
    type: 'run',
    points: [
      [0, 0],
      [29.468, 0],
    ],
    z0: 0,
    height: 4,
    thickness: 0.15,
  },
  sources: [{ kind: 'sheet', id: 's', page: 7, label: 'S2.0' }],
  issues: ['Member or assembly dimensions need a source-linked review.'],
} as BuildElement;
const project = {
  measurements: [
    {
      id: 'm',
      sheetId: 's',
      points: [
        [0, 0],
        [294.68, 0],
      ],
    },
  ],
  sheets: [{ id: 's', name: 'S2.0', page: 7, width: 600, height: 600 }],
  specs: [],
} as unknown as Project;
const model = {
  elements: [wall],
  levels: [{ id: 'L1', elevation: 0 }],
} as BuildModel;
describe('structural wall source gate', () => {
  it('does not turn a long measurement crossing opening bays into a default full-storey wall', () => {
    const snapshot = JSON.stringify(model);
    const result = connectStructuralWalls(project, model, {}, {}).elements[0];
    expect(result.shape).toEqual({
      type: 'axis',
      points: [
        [0, 0],
        [29.468, 0],
      ],
      z: 0,
    });
    expect([result.id, result.quantity, result.unit]).toEqual([
      'w',
      29.468,
      'm',
    ]);
    expect(
      result.issues.some((i) => i.includes('window/door/lintel cuts')),
    ).toBe(true);
    expect(JSON.stringify(model)).toBe(snapshot);
  });
  it('a wall schedule alone cannot establish a member-specific elevation or opening geometry', () => {
    const texts = {
      s: [
        { str: 'STRUCTURAL WALL SCHEDULE', cx: 100, cy: 10 },
        { str: 'WT-1', cx: 50, cy: 30 },
        { str: '38 x 140 (2x6) @ 400 O.C.', cx: 130, cy: 30 },
        { str: '11 OSB', cx: 200, cy: 30 },
      ],
    };
    const first = connectStructuralWalls(project, model, texts, {});
    expect(first.elements[0].shape?.type).toBe('axis');
    expect(connectStructuralWalls(project, first, texts, {})).toEqual(first);
  });
  it('leaves source-built architectural walls and unrelated structural beams alone', () => {
    const building = { ...wall, id: 'a', origin: 'building' as const };
    const beam = { ...wall, id: 'b', typeName: 'B3 Beam' };
    const result = connectStructuralWalls(
      project,
      { ...model, elements: [wall, building, beam] },
      {},
      {},
    );
    expect(result.elements[0].shape?.type).toBe('axis');
    expect(result.elements[1]).toBe(building);
    expect(result.elements[2]).toBe(beam);
  });
});
