import { describe, expect, it } from 'vitest';
import {
  beginPhysicalGeometry,
  endPhysicalGeometry,
} from '../src/build/physicalGeometryLifecycle';
import type { BuildElement, BuildModel } from '../src/build/types';
import type { Project } from '../src/model';
const e: BuildElement = {
  id: 'beam',
  measurementId: 'm',
  sheetId: 's',
  typeId: 'b',
  typeName: 'B1 Beam',
  name: 'B1',
  trade: 'structure',
  level: 'L1',
  quantity: 7,
  unit: 'm',
  division: '06',
  origin: 'takeoff',
  placement: 'inferred',
  shape: {
    type: 'axis',
    points: [
      [0, 0],
      [7, 0],
    ],
    z: 0,
  },
  sources: [{ kind: 'sheet', id: 's', page: 1, label: 'S1' }],
  issues: ['Plan axis only'],
  specs: [],
};
const model = { elements: [e], levels: [] } as unknown as BuildModel;
const project = {
  measurements: [
    {
      id: 'm',
      sheetId: 's',
      typeId: 'b',
      points: [
        [0, 0],
        [70, 0],
      ],
    },
  ],
  types: [{ id: 'b', kind: 'linear', name: 'B1 Beam' }],
  sheets: [{ id: 's', metersPerPoint: 0.1 }],
} as unknown as Project;
const enrich = (m: BuildModel): BuildModel => ({
  ...m,
  elements: m.elements.map((e) => ({
    ...e,
    shape: {
      type: 'run',
      points: [
        [0, 0],
        [7, 0],
      ],
      z0: 3,
      height: 0.6,
      thickness: 0.2,
    },
    issues: [...e.issues, 'Physical floor beam: fresh section evidence'],
    sources: [
      ...e.sources,
      {
        kind: 'sheet',
        id: 'section',
        page: 2,
        label: 'S2',
        quote: 'Current section',
      },
    ],
  })),
});
describe('physical geometry lifecycle', () => {
  it('returns to the measured axis when formerly available source evidence disappears', () => {
    const snapshot = JSON.stringify({ project, model });
    const built = endPhysicalGeometry(
      enrich(beginPhysicalGeometry(project, model)),
    );
    expect(built.elements[0].shape?.type).toBe('run');
    const withoutEvidence = endPhysicalGeometry(
      beginPhysicalGeometry(project, built),
    );
    expect(withoutEvidence.elements[0].shape).toEqual(e.shape);
    expect(withoutEvidence.elements[0].sources).toEqual(e.sources);
    expect(
      withoutEvidence.elements[0].issues.some((i) =>
        i.startsWith('Physical floor beam:'),
      ),
    ).toBe(false);
    expect(withoutEvidence.elements[0].quantity).toBe(7);
    expect(JSON.stringify({ project, model })).toBe(snapshot);
    expect(
      endPhysicalGeometry(enrich(beginPhysicalGeometry(project, built))),
    ).toEqual(built);
    expect(
      endPhysicalGeometry(beginPhysicalGeometry(project, withoutEvidence)),
    ).toEqual(withoutEvidence);
  });
  it('downgrades legacy enriched runs without a baseline before missing evidence can retain them', () => {
    const legacy = enrich(model);
    const start = beginPhysicalGeometry(project, legacy);
    expect(start.elements[0].shape?.type).toBe('axis');
    const result = endPhysicalGeometry(start);
    expect(result.elements[0].shape?.type).toBe('axis');
    expect(
      result.elements[0].issues.some((i) =>
        i.startsWith('Physical floor beam:'),
      ),
    ).toBe(false);
    expect(result.elements[0].sources).toEqual(e.sources);
  });
  it('retains foundation plan seeds for the resolver but does not expose an unproven strip or slab solid', () => {
    const strip = {
      ...e,
      measurementSource: 'foundations',
      typeName: 'SF1 Strip footing',
      shape: {
        type: 'run',
        points: [
          [0, 0],
          [7, 0],
        ],
        z0: -1.5,
        height: 0.3,
        thickness: 0.6,
      },
      issues: ['Footing section taken from S0.2'],
    } as BuildElement;
    const slab = {
      ...e,
      id: 'slab',
      measurementSource: 'foundations',
      typeName: 'Slab on grade',
      shape: {
        type: 'surface',
        ring: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        holes: [],
        z: -0.15,
        thickness: 0.15,
      },
      issues: [
        'Interior slab concrete depth 0.15 m from source construction note',
      ],
    } as BuildElement;
    const seeded = beginPhysicalGeometry(project, {
      ...model,
      elements: [strip, slab],
    });
    expect(seeded.elements.map((e) => e.shape?.type)).toEqual([
      'run',
      'surface',
    ]);
    const finished = endPhysicalGeometry(seeded);
    expect(finished.elements.map((e) => e.shape?.type ?? null)).toEqual([
      'axis',
      null,
    ]);
    expect(
      beginPhysicalGeometry(project, finished).elements.map(
        (e) => e.shape?.type,
      ),
    ).toEqual(['run', 'surface']);
  });
  it('does not accumulate unresolved resolver warnings on repeated passes', () => {
    const failed = (m: BuildModel) => ({
      ...m,
      elements: m.elements.map((e) => ({
        ...e,
        shape: null,
        issues: [
          ...e.issues,
          'Roof beam bearings could not be matched to drawn supports and bay labels.',
        ],
      })),
    });
    const first = endPhysicalGeometry(
      failed(beginPhysicalGeometry(project, model)),
    );
    const second = endPhysicalGeometry(
      failed(beginPhysicalGeometry(project, first)),
    );
    expect(second).toEqual(first);
  });
  it('invalidates cached baseline coordinates when the measured source changes', () => {
    const built = endPhysicalGeometry(
      enrich(beginPhysicalGeometry(project, model)),
    );
    const changed = {
      ...project,
      measurements: project.measurements.map((m) => ({
        ...m,
        points: [
          [10, 10],
          [80, 10],
        ] as [number, number][],
      })),
    };
    const result = endPhysicalGeometry(beginPhysicalGeometry(changed, built));
    expect(result.elements[0].shape).toBeNull();
    expect(result.elements[0].placement).toBe('unknown');
    expect(
      result.elements[0].issues.some((i) =>
        i.startsWith('Physical geometry baseline invalidated:'),
      ),
    ).toBe(true);
  });
});

it('retains revision conflict references when withholding a formerly physical member', () => {
  const built = endPhysicalGeometry(
    enrich(beginPhysicalGeometry(project, model)),
  );
  const next = beginPhysicalGeometry(project, built);
  next.elements[0].sources.push({
    kind: 'spec',
    id: 'addendum',
    page: 21,
    label: 'Revised foundation plan',
  });
  next.elements[0].issues.push(
    'Foundation revision unresolved: local datum conflicts with original sheet.',
  );
  const held = endPhysicalGeometry(next).elements[0];
  expect(held.shape?.type).toBe('axis');
  expect(held.sources.some((s) => s.id === 'addendum')).toBe(true);
  expect(held.sources.some((s) => s.id === 'section')).toBe(false);
  expect(held.quantity).toBe(e.quantity);
});

it('replaces obsolete locator warnings only while current physical evidence qualifies', () => {
  const warning = 'Symbolic 3D location inferred at structural grid 8/D; member section and height are not inferred.';
  const source = { ...model, elements: [{ ...e, issues: [warning, 'Accepted quantity needs review'] }] };
  const qualified = endPhysicalGeometry(enrich(beginPhysicalGeometry(project, source)));
  expect(qualified.elements[0].issues).not.toContain(warning);
  expect(qualified.elements[0].issues).toContain('Accepted quantity needs review');
  const withdrawn = endPhysicalGeometry(beginPhysicalGeometry(project, qualified));
  expect(withdrawn.elements[0].issues).toContain(warning);
  expect(withdrawn.elements[0].shape).toEqual(e.shape);
});
