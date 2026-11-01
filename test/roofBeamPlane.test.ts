import { expect, it } from 'vitest';
import { roofBeamPlane } from '../src/build/roofBeamPlane';
import type { Project } from '../src/model';
import type { BuildModel } from '../src/build/types';
const scale = 0.025;
function fixture() {
  const project = {
    sheets: [
      {
        id: 'a',
        name: 'A1',
        title: 'FLOOR PLAN',
        width: 1000,
        height: 1000,
        metersPerPoint: scale,
      },
      {
        id: 's',
        name: 'S4',
        title: 'SECTIONS',
        width: 2600,
        height: 1000,
        page: 1,
      },
    ],
    measurements: [
      {
        id: 'm',
        sheetId: 'a',
        points: [
          [200, 200],
          [600, 200],
          [600, 600],
          [200, 600],
        ],
      },
    ],
  } as unknown as Project;
  const model = {
    elements: [
      {
        measurementId: 'm',
        shape: {
          type: 'surface',
          ring: [
            [200, 200],
            [600, 200],
            [600, 600],
            [200, 600],
          ].map(([x, y]) => [x * scale, y * scale]),
        },
      },
    ],
  } as unknown as BuildModel;
  const texts: any = {
    a: [
      ...['A', 'B', 'E'].map((str, i) => ({ str, cx: 200 + i * 200, cy: 100 })),
      ...['1', '2', '3'].map((str, i) => ({ str, cx: 100, cy: 200 + i * 200 })),
    ],
    s: [],
  };
  const lines: any = { s: [] };
  for (const offset of [0, 1100]) {
    texts.s.push(
      ...['A', 'B', 'E'].map((str, i) => ({
        str,
        cx: offset + 200 + i * 200,
        cy: 100,
      })),
      { str: 'T/O HIGH BEAM', cx: offset + 700, cy: 196 },
      { str: '10000', cx: offset + 710, cy: 204 },
      { str: 'T/O LOW BEAM', cx: offset + 700, cy: 296 },
      { str: '8000', cx: offset + 710, cy: 304 },
    );
    for (const y of [200, 300])
      for (let i = 0; i < 4; i++)
        lines.s.push({
          x1: offset + 650 + i * 20,
          x2: offset + 660 + i * 20,
          y1: y,
          y2: y,
          color: '#595959',
        });
    // Grey datum dashes through another grid are not beam cross-sections.
    for (const y of [200, 300])
      lines.s.push({
        x1: offset + 393.375,
        x2: offset + 406.625,
        y1: y,
        y2: y,
        color: '#595959',
      });
    // Drawn primary-beam section top edges, physically265mm wide.
    for (const [x, y] of [
      [600, 200],
      [200, 300],
    ])
      lines.s.push({
        x1: offset + x - 6.625,
        x2: offset + x + 6.625,
        y1: y,
        y2: y,
        color: '#000000',
      });
  }
  return { project, model, texts, lines };
}
it('uses explicit primary-beam datums at verified section/grid intercepts', () => {
  const f = fixture(),
    p = roofBeamPlane(f.project, f.model, f.texts, f.lines)!;
  expect(p).not.toBeNull();
  expect(p.grids).toEqual(['E', 'A']);
  expect(p.topPlane[0]).toBeCloseTo(0.2);
  expect(p.topPlane[1]).toBeCloseTo(0);
  expect(p.topPlane[2]).toBeCloseTo(7);
  expect(p.sources).toHaveLength(2);
});
it('rejects roof skin and one uncorroborated section', () => {
  const f = fixture();
  f.lines.s = f.lines.s.filter((l: any) => l.color !== '#000000');
  expect(roofBeamPlane(f.project, f.model, f.texts, f.lines)).toBeNull();
  const g = fixture();
  g.lines.s = g.lines.s.filter((l: any) => l.x1 < 1000);
  expect(roofBeamPlane(g.project, g.model, g.texts, g.lines)).toBeNull();
});
