import { it, expect, vi } from 'vitest';
import { connectRoofMembers } from '../src/build/roofMemberGeometry';
import type { Project } from '../src/model';
import type { BuildModel } from '../src/build/types';
vi.mock('../src/build/roofRegistration', () => ({
  roofViewportRegistrations: (p: Project) =>
    Object.fromEntries(
      p.measurements.map((m) => [
        m.id,
        {
          title: 'HIGH ROOF',
          frame: { a: 1, b: 0, tx: 0, ty: 0 },
          metersPerPoint: 1,
          grids: ['A', 'B', 'C', '1', '2', '3'],
          source: { kind: 'sheet', id: 's' },
        },
      ]),
    ),
}));
vi.mock('../src/build/roofSpanEvidence', () => ({
  recoverRoofBeamSpan: (points: number[][]) => points,
}));
vi.mock('../src/build/roofBeamPlane', () => ({
  roofBeamPlane: () => ({
    topPlane: [0.125, 0, 8.568],
    heights: [8.568, 10.428],
    sources: [],
  }),
}));
vi.mock('../src/build/structural', () => ({
  structuralSections: () =>
    Object.fromEntries(
      ['B2', 'B3'].map((code) => [
        code,
        {
          width: 0.265,
          depth: 0.608,
          source: { kind: 'sheet', id: 'schedule' },
        },
      ]),
    ),
}));
function fixture(conflict = false) {
  const measurements = [
    {
      id: 'one',
      sheetId: 's',
      typeId: 'b2',
      points: [
        [0, 0],
        [5, 0],
      ],
    },
    ...(conflict
      ? [
          {
            id: 'two',
            sheetId: 's',
            typeId: 'b3',
            points: [
              [5, 0],
              [0, 0],
            ],
          },
        ]
      : []),
  ];
  const project = {
    measurements,
    types: [
      { id: 'b2', name: 'B2', kind: 'linear' },
      { id: 'b3', name: 'B3', kind: 'linear' },
    ],
  } as unknown as Project;
  const model = {
    elements: measurements.map((m) => ({
      id: m.id,
      measurementId: m.id,
      typeId: m.typeId,
      typeName: m.typeId.toUpperCase(),
      shape: null,
      quantity: 5,
      issues: [],
      sources: [],
    })),
  } as unknown as BuildModel;
  return { project, model };
}
it('does not extrude contradictory marks over the same measured span', () => {
  const f = fixture(true),
    r = connectRoofMembers(f.project, f.model, {}, {});
  expect(r.elements.every((e) => !e.shape)).toBe(true);
  expect(r.elements[0].issues.join(' ')).toContain('Conflicting beam marks');
  expect(r.elements.map((e) => e.quantity)).toEqual([5, 5]);
});
it('keeps inclined member depth and evidence stable on repeated connection', () => {
  const f = fixture(),
    r = connectRoofMembers(f.project, f.model, {}, {}),
    s = r.elements[0].shape!;
  expect(s.type).toBe('run');
  if (s.type !== 'run') throw Error('run required');
  expect(s.height).toBeCloseTo(0.608 * Math.sqrt(1 + 0.125 ** 2));
  expect(s.topPlane![2] - s.bottomPlane![2]).toBeCloseTo(s.height);
  const again = connectRoofMembers(f.project, r, {}, {});
  expect(again).toEqual(r);
});
