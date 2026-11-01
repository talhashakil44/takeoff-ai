import { it, expect } from 'vitest';
import type { BuildElement, BuildModel } from '../src/build/types';
import { suppressCoincidentStructure } from '../src/build/coincidentStructure';
function element(id: string): BuildElement {
  return {
    id,
    name: 'Lintel',
    typeId: 'type',
    division: '06',
    measurementId: id,
    sheetId: 'plan',
    specs: [],
    placement: 'inferred',
    trade: 'structure',
    level: 'floor1',
    status: 'new',
    quantity: 1,
    unit: 'ea',
    typeName: 'L1 legacy',
    shape: {
      type: 'run',
      points: [
        [0, 0],
        [2, 0],
      ],
      z0: 2.74,
      height: 0.184,
      thickness: 0.076,
    },
    sources: [
      {
        kind: 'sheet',
        id: 'elevation',
        page: 2,
        label: 'A3.1',
        box: [10, 10, 40, 40],
        quote:
          'W17: opening matched to lintel by drawing grids, position and span',
      },
    ],
    issues: [],
  };
}
const model = (elements: BuildElement[]) => ({ elements }) as BuildModel;
it('keeps one display solid, every record/quantity, and stable canonical evidence', () => {
  const a = element('a'),
    b = { ...element('b'), typeName: 'L1 new', quantity: 3 };
  const input = model([b, a]),
    out = suppressCoincidentStructure(input);
  expect(out.elements).toHaveLength(2);
  expect(out.elements[0].shape).toBeNull();
  expect(out.elements[1].shape).toEqual(a.shape);
  expect(out.elements.map((e) => e.quantity)).toEqual([3, 1]);
  expect(out.elements[0].issues[0]).toContain('canonical record a');
  expect(out.elements[0].issues[0]).toContain('unreconciled');
  expect(input.elements[0].shape).not.toBeNull();
  expect(suppressCoincidentStructure(out)).toEqual(out);
});
it('does not suppress a shared window type without identical placed-opening source', () => {
  const a = element('a'),
    b = element('b');
  b.sources[0] = { ...b.sources[0], box: [60, 10, 90, 40] };
  const input = model([a, b]);
  expect(suppressCoincidentStructure(input)).toBe(input);
  b.sources[0] = {
    ...b.sources[0],
    quote: 'W17: dimensions from calibrated frame outline and floor datum',
  };
  expect(suppressCoincidentStructure(input)).toBe(input);
});
it('preserves different levels, dimensions, elevations and ambiguous opening matches', () => {
  for (const change of [
    (b: BuildElement) => (b.level = 'floor2'),
    (b: BuildElement) => {
      if (b.shape?.type === 'run') b.shape.z0 += 0.01;
    },
    (b: BuildElement) => {
      if (b.shape?.type === 'run') b.shape.thickness += 0.01;
    },
    (b: BuildElement) =>
      b.sources.push({ ...b.sources[0], box: [100, 100, 130, 130] }),
  ]) {
    const a = element('a'),
      b = element('b');
    change(b);
    const input = model([a, b]);
    expect(suppressCoincidentStructure(input)).toBe(input);
  }
});
it('handles reversed endpoint order as the same exact run', () => {
  const a = element('a'),
    b = element('b');
  if (b.shape?.type === 'run') b.shape.points.reverse();
  expect(
    suppressCoincidentStructure(model([b, a])).elements[0].shape,
  ).toBeNull();
});
