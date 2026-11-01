import { it, expect, vi, beforeEach } from 'vitest';
import {
  structuralRevisionPages,
  structuralRevisionContext,
  withRevisedRoofSources,
} from '../src/build/structuralRevisions';
const mock = vi.hoisted(() => ({ regs: {} as any }));
vi.mock('../src/build/roofRegistration', () => ({
  roofViewportRegistrations: () => mock.regs,
}));
beforeEach(() => {
  mock.regs = {};
});
function fixture() {
  const grid = [
    ...['A', 'B', 'C'].map((str, i) => ({ str, cx: 100 + i * 150, cy: 50 })),
    ...['1', '2', '3'].map((str, i) => ({ str, cx: 50, cy: 100 + i * 150 })),
  ];
  const project: any = {
    sheets: [
      {
        id: 's',
        name: 'S2.1',
        title: 'ROOF FRAMING PLAN',
        width: 1000,
        height: 1000,
        page: 1,
      },
    ],
    specs: [
      {
        id: 'rev',
        name: 'Revision',
        book: {
          addendum: 2,
          pages: 2,
          changes: [
            { page: 1, text: 'Relocated structural schedules to S0.3' },
            { page: 2, text: 'Structural Addendum HIGH ROOF FRAMING PLAN' },
          ],
        },
      },
    ],
    measurements: [
      {
        id: 'm',
        sheetId: 's',
        points: [
          [110, 100],
          [190, 100],
        ],
      },
    ],
    types: [{ id: 'type', kind: 'linear' }],
  };
  const texts: any = {
      s: grid,
      'spec:rev:2': [
        ...grid,
        { str: 'ROOF FRAMING PLAN', cx: 400, cy: 600 },
        { str: 'S2.1', cx: 950, cy: 950 },
        { str: 'B3', cx: 150, cy: 100 },
      ],
    },
    lines: any = { 'spec:rev:2': [] };
  return { project, texts, lines };
}
it('handles absent optional books and no known structural revision', () => {
  expect(structuralRevisionPages({ specs: [{ id: 'none' }] } as any)).toEqual(
    [],
  );
});
it('does not require narrative page vectors or text, but requires actual replacement evidence', () => {
  const f = fixture();
  expect(structuralRevisionContext(f.project, f.texts, f.lines).pending).toBe(
    false,
  );
  delete f.texts['spec:rev:2'];
  expect(structuralRevisionContext(f.project, f.texts, f.lines).pending).toBe(
    true,
  );
});
it('rejects shifted plan coordinates rather than reusing old takeoff positions', () => {
  const f = fixture();
  f.texts['spec:rev:2'] = f.texts['spec:rev:2'].map((t: any) =>
    /^[ABC]$/.test(t.str) ? { ...t, cx: t.cx + 10 } : t,
  );
  const c = structuralRevisionContext(f.project, f.texts, f.lines);
  expect(c.pending).toBe(true);
  expect(c.unresolved).toContain('S2.1');
  expect(c.texts.s).toBe(f.texts.s);
});
it('maps derived source boxes to the replacement PDF while retaining coordinates', () => {
  const f = fixture(),
    c = structuralRevisionContext(f.project, f.texts, f.lines);
  expect(
    c.source({
      kind: 'sheet',
      id: 's',
      page: 1,
      label: 'S2.1',
      box: [10, 20, 30, 40],
    }),
  ).toMatchObject({ kind: 'spec', id: 'rev', page: 2, box: [10, 20, 30, 40] });
});
it('uses revised designation for geometry while preserving original type, quantities, and takeoff source', () => {
  const f = fixture();
  mock.regs = { m: { metersPerPoint: 0.025 } };
  const source: any = {
      kind: 'sheet',
      id: 's',
      page: 1,
      label: 'S2.1',
      box: [110, 100, 190, 100],
    },
    e: any = {
      id: 'm',
      measurementId: 'm',
      sheetId: 's',
      typeId: 'type',
      typeName: 'B1 old takeoff',
      name: 'Original',
      quantity: 42,
      unit: 'm',
      shape: null,
      sources: [source],
      issues: [],
    };
  const model: any = { elements: [e] };
  const resolve = vi.fn((_p: any, m: any) => ({
    ...m,
    elements: m.elements.map((v: any) => ({
      ...v,
      shape: {
        type: 'run',
        points: [
          [0, 0],
          [2, 0],
        ],
        z0: 7.332,
        height: 0.608,
        thickness: 0.265,
      },
      sources: [
        ...v.sources,
        {
          kind: 'sheet',
          id: 's',
          page: 1,
          label: 'S2.1',
          quote: 'Revised B3 drawing mark',
        },
      ],
    })),
  }));
  const out = withRevisedRoofSources(
    f.project,
    model,
    f.texts,
    f.lines,
    resolve,
  );
  expect(resolve.mock.calls[0][1].elements[0].typeName).toBe('B3 old takeoff');
  expect(out.elements[0]).toMatchObject({
    typeName: 'B1 old takeoff',
    name: 'Original',
    quantity: 42,
    unit: 'm',
  });
  expect(out.elements[0].sources[0]).toBe(source);
  expect(out.elements[0].sources[1]).toMatchObject({
    kind: 'spec',
    id: 'rev',
    page: 2,
  });
  expect(out.elements[0].issues[0]).toContain(
    'replacing takeoff designation B1',
  );
  delete f.texts['spec:rev:2'];
  expect(
    withRevisedRoofSources(f.project, out, f.texts, f.lines, resolve)
      .elements[0].shape,
  ).toBeNull();
});
