import { expect, it, vi } from 'vitest';
import type { Project } from '../src/model';
import {
  flatRoofBeamDatum,
  connectFlatRoofMembers,
} from '../src/build/flatRoofBeamGeometry';
function fixture() {
  const project = {
    sheets: [{ id: 's', name: 'S4.0', title: 'SECTIONS', page: 1 }],
  } as unknown as Project;
  const texts: any = { s: [] },
    lines: any = { s: [] };
  for (const x of [100, 1100]) {
    for (const [str, y] of [
      ['T/O HIGH BEAM', 100],
      ['10428', 108],
      ['T/O LOW BEAM', 200],
      ['8568', 208],
      ['ROOF', 230],
      ['8000', 238],
      ['T.O FLAT ROOF BEAM', 232],
      ['7940', 240],
    ] as const)
      texts.s.push({ str, cx: x, cy: y });
    for (const y of [234, 236])
      for (let i = 0; i < 4; i++)
        lines.s.push({
          x1: x - 40 + i * 20,
          x2: x - 30 + i * 20,
          y1: y,
          y2: y,
        });
  }
  return { project, texts, lines };
}
it('disambiguates overlapping roof and flat beam datums using learned baseline and leaders', () => {
  const f = fixture();
  const d = flatRoofBeamDatum(f.project, f.texts, f.lines)!;
  expect(d.elevation).toBe(7.94);
  expect(d.sources).toHaveLength(2);
});
it('requires corroboration and the correct datum leader', () => {
  const f = fixture();
  f.lines.s = f.lines.s.filter((l: any) => l.x1 < 500);
  expect(flatRoofBeamDatum(f.project, f.texts, f.lines)).toBeNull();
  const g = fixture();
  g.lines.s = g.lines.s.filter((l: any) => l.y1 !== 236);
  expect(flatRoofBeamDatum(g.project, g.texts, g.lines)).toBeNull();
});
it('rejects conflicting section datums', () => {
  const f = fixture();
  f.texts.s.find((t: any) => t.cx === 1100 && t.str === '7940').str = '7950';
  expect(flatRoofBeamDatum(f.project, f.texts, f.lines)).toBeNull();
});

const mocks = vi.hoisted(() => ({
  regs: {} as any,
  sections: {} as any,
  recover: true,
}));
vi.mock('../src/build/roofRegistration', () => ({
  roofViewportRegistrations: () => mocks.regs,
}));
vi.mock('../src/build/roofSpanEvidence', () => ({
  recoverRoofBeamSpan: (points: any) => (mocks.recover ? points : null),
}));
vi.mock('../src/build/structural', () => ({
  structuralSections: () => mocks.sections,
}));
it('places only measured low roof spans and preserves source quantities and other geometry', () => {
  const f = fixture();
  const source = { kind: 'sheet', id: 's', label: 'S4' };
  mocks.regs = {
    m: {
      title: 'LOW ROOF FRAMING PLAN',
      frame: { a: 0.1, b: 0, tx: 1, ty: 2 },
      source,
    },
    c: {
      title: 'CANOPY FRAMING PLAN',
      frame: { a: 0.1, b: 0, tx: 1, ty: 2 },
      source,
    },
  };
  mocks.sections = { B1: { width: 0.215, depth: 0.608, source } };
  const p: any = {
    ...f.project,
    types: [{ id: 'b', kind: 'linear' }],
    measurements: [
      {
        id: 'm',
        points: [
          [0, 0],
          [40, 0],
        ],
      },
      {
        id: 'c',
        points: [
          [0, 0],
          [40, 0],
        ],
      },
    ],
  };
  const e = {
    measurementId: 'm',
    typeId: 'b',
    typeName: 'B1 Beam',
    quantity: 17.3,
    shape: null,
    sources: [],
    issues: [],
  };
  const canopy = { ...e, measurementId: 'c' };
  const model: any = { elements: [e, canopy] };
  const out = connectFlatRoofMembers(p, model, f.texts, f.lines);
  expect(out.elements[0].shape).toMatchObject({
    type: 'run',
    points: [
      [1, 2],
      [5, 2],
    ],
    height: 0.608,
    thickness: 0.215,
  });
  expect((out.elements[0] as any).quantity).toBe(17.3);
  expect(out.elements[1]).toBe(canopy);
  expect(model.elements[0].shape).toBeNull();
  const twice = connectFlatRoofMembers(p, out, f.texts, f.lines);
  expect(twice.elements[0].sources).toEqual(out.elements[0].sources);
  expect(twice.elements[0].issues).toEqual(out.elements[0].issues);
  mocks.recover = false;
  const refused = connectFlatRoofMembers(p, out, f.texts, f.lines);
  expect(refused.elements[0].shape).toBeNull();
  expect((refused.elements[0] as any).quantity).toBe(17.3);
  mocks.recover = true;
});

it('reads the schedule size despite unrelated text earlier on the same row', async () => {
  const { structuralSections } = await vi.importActual<
    typeof import('../src/build/structural')
  >('../src/build/structural');
  const p = {
    sheets: [{ id: 's', name: 'S0.2', page: 1 }],
  } as unknown as Project;
  const ts: any = {
    s: [
      { str: 'BEAM SCHEDULE', cx: 290, cy: 100 },
      { str: 'SIZE', cx: 192, cy: 123 },
      { str: 'MARK', cx: 158, cy: 123 },
      { str: 'UNRELATED NOTES', cx: 240, cy: 134 },
      { str: 'B1', cx: 152, cy: 134 },
      { str: '215 x 608 GLULAM', cx: 215, cy: 134 },
    ],
  };
  expect(structuralSections(p, ts).B1).toMatchObject({
    width: 0.215,
    depth: 0.608,
  });
});
