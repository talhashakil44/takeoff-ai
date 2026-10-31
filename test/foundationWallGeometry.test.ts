import { expect, it } from 'vitest';
import { recoverFoundationWalls } from '../src/build/foundationWallGeometry';
import type { Project } from '../src/model';
import type { BuildElement, BuildModel } from '../src/build/types';
import type { DrawingTexts } from '../src/build/building';
const text = (str: string, cx: number, cy: number) => ({ str, cx, cy });
const line = (x1: number, y1: number, x2: number, y2: number, width = 0.6) => ({
  x1,
  y1,
  x2,
  y2,
  width,
  filled: false,
  color: '#000000',
});
function fixture() {
  const frame = { a: 0.01, b: 0, tx: 0, ty: 0, residual: 0 };
  const plan = {
    docId: 'revision',
    page: 21,
    sheetId: 'plan',
    frame,
    texts: [
      text('1', 0, 0),
      text('2', 110, 0),
      text('3', 220, 0),
      text('A', 0, 50),
      text('B', 0, 200),
      text('C', 0, 400),
      text('FW-4', 70, 200),
      text('6', 300, 213),
      text('S1.1', 300, 227),
    ],
    lines: [
      line(100, 100, 100, 360),
      line(145.8, 100, 145.8, 360),
      line(100, 100, 145.8, 100, 1.32),
      line(100, 360, 145.8, 360, 1.32),
      ...[110, 120, 130].map((x) => line(x, 100, x, 360, 0.24)),
      line(122.9, 200, 85, 200, 0.84),
      line(80, 220, 280, 220),
    ],
  };
  const texts: DrawingTexts = {
    'spec:revision:19': [
      text('FOUNDATION WALL SCHEDULE', 200, 100),
      text('FW-4', 100, 200),
      text('458', 130, 200),
      text('ICF (300 CONCRETE)', 190, 200),
    ],
    'spec:revision:22': [
      text(
        'SECTION - TYPICAL EXTERIOR SLAB ON GRADE AT FOUNDATION WALL',
        300,
        500,
      ),
      text('6', 100, 500),
      text('S1.1', 100, 515),
      text('2', 200, 100),
      text('DROP FOUNDATION WALL 250', 220, 200),
      text('AND POUR SLAB OVER', 220, 208),
      text('ICF FOUNDATION WALL,', 220, 300),
      text('FIN. GROUND FLOOR', 500, 250),
      text('0', 520, 260),
      text('T/O FOOTING', 500, 400),
      text('-1200', 520, 410),
    ],
  };
  const original = {
    id: 'accepted',
    measurementId: 'accepted',
    typeId: 'type',
    typeName: 'FW-4',
    sheetId: 'plan',
    issues: [],
    sources: [],
    quantity: 0.38,
    unit: 'm',
    shape: {
      type: 'axis',
      points: [
        [0.85, 2],
        [1.229, 2],
      ],
      z: -1.2,
    },
  } as unknown as BuildElement;
  const project = {
    measurements: [
      {
        id: 'accepted',
        points: [
          [85, 200],
          [122.9, 200],
        ],
      },
    ],
    sheets: [],
    types: [],
  } as unknown as Project;
  const model = {
    elements: [original],
    drawingGeometry: [],
  } as unknown as BuildModel;
  const pages = [
    { docId: 'revision', page: 19 },
    { docId: 'revision', page: 22 },
  ];
  const recover = (
    p = project,
    m = model,
    pl = plan,
    ts = texts,
    leaders: Parameters<typeof recoverFoundationWalls>[5] = [],
    crosses = () => false,
    acceptedFrame = frame,
  ) =>
    recoverFoundationWalls(
      p,
      m,
      pl,
      ts,
      pages,
      leaders,
      crosses,
      [0.6, 0.9],
      acceptedFrame,
    );
  return { project, model, plan, texts, recover, frame };
}
it('creates only an unaccepted concrete core from a closed panel, tag and explicit local cut', () => {
  const f = fixture(),
    out = f.recover();
  expect(out.drawingGeometry).toHaveLength(1);
  const wall = out.drawingGeometry![0];
  expect(wall).toMatchObject({
    origin: 'drawing',
    quantity: 0,
    unit: '',
    typeId: '',
    shape: { type: 'run', z0: -1.2, height: 0.95, thickness: 0.3 },
  });
  expect(wall.sources.map((s) => s.quote).join(' ')).toContain(
    '458 mm ICF assembly; 300 mm concrete core',
  );
  expect(out.elements[0].shape).toEqual(f.model.elements[0].shape);
  expect(out.elements[0].quantity).toBe(f.model.elements[0].quantity);
  expect(out.elements[0].issues.join(' ')).toContain('annotation/cut line');
  expect(f.recover(f.project, out)).toEqual(out);
  for (const str of [
    'DROP FOUNDATION WALL 250',
    '0',
    '-1200',
    'ICF FOUNDATION WALL,',
    'AND POUR SLAB OVER',
    '2',
  ]) {
    const ts = {
      ...f.texts,
      'spec:revision:22': f.texts['spec:revision:22'].filter(
        (t) => t.str !== str,
      ),
    };
    expect(f.recover(f.project, out, f.plan, ts).drawingGeometry).toHaveLength(
      0,
    );
  }
  for (const str of ['FW-4', '6', 'S1.1'])
    expect(
      f.recover(f.project, out, {
        ...f.plan,
        texts: f.plan.texts.filter((t) => t.str !== str),
      }).drawingGeometry,
    ).toHaveLength(0);
  for (const index of [0, 2, 7, 8])
    expect(
      f.recover(f.project, out, {
        ...f.plan,
        lines: f.plan.lines.filter((_, i) => i !== index),
      }).drawingGeometry,
    ).toHaveLength(0);
  expect(
    f.recover(f.project, out, {
      ...f.plan,
      texts: [...f.plan.texts, text('STEP', 123, 250)],
    }).drawingGeometry,
  ).toHaveLength(0);
  expect(
    f.recover(f.project, out, f.plan, f.texts, [], () => true).drawingGeometry,
  ).toHaveLength(0);
  const leader = {
    tip: [145.8, 250] as [number, number],
    top: -0.725,
    bottom: -1.025,
    source: {
      kind: 'spec' as const,
      id: 'revision',
      page: 21,
      label: 'Conflicting local footing datum',
    },
  };
  expect(
    f.recover(f.project, out, f.plan, f.texts, [leader]).drawingGeometry,
  ).toHaveLength(0);
  const conflict = {
    ...f.texts,
    'spec:revision:19': [
      ...f.texts['spec:revision:19'],
      text('FW-4', 100, 230),
      text('458', 130, 230),
      text('ICF (250 CONCRETE)', 190, 230),
    ],
  };
  expect(
    f.recover(f.project, out, f.plan, conflict).drawingGeometry,
  ).toHaveLength(0);
});
it('suppresses a source-only duplicate using the accepted measurement frame without changing accepted geometry', () => {
  const f = fixture();
  const corrected = {
    ...f.project,
    measurements: [
      {
        ...f.project.measurements[0],
        points: [
          [122.9, 100],
          [122.9, 360],
        ] as [number, number][],
      },
    ],
  };
  const out = f.recover(corrected);
  expect(out.drawingGeometry).toHaveLength(0);
  expect(out.elements).toEqual(f.model.elements);
  // Accepted sheet coordinates are translated relative to the revision page.
  const moved = {
    ...f.project,
    measurements: [
      {
        ...f.project.measurements[0],
        points: [
          [22.9, 100],
          [22.9, 360],
        ] as [number, number][],
      },
    ],
  };
  const translated = { ...f.frame, tx: 1 };
  expect(
    f.recover(moved, f.model, f.plan, f.texts, [], () => false, translated)
      .drawingGeometry,
  ).toHaveLength(0);
  expect(f.recover(moved).drawingGeometry).toHaveLength(1);
});
