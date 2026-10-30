import { it, expect } from 'vitest';
import { connectFloorBeams } from '../src/build/floorBeamGeometry';
import type { Project } from '../src/model';
import type { BuildModel } from '../src/build/types';
const t = (str: string, cx: number, cy: number) => ({ str, cx, cy });
const project = {
  measurements: [
    {
      id: 'm',
      sheetId: 'p',
      points: [
        [0, 0],
        [80, 0],
      ],
    },
  ],
  sheets: [
    {
      id: 'p',
      name: 'S2',
      title: 'MAIN FLOOR FRAMING PLAN',
      page: 1,
      metersPerPoint: 0.1,
      width: 600,
      height: 600,
    },
    { id: 's', name: 'S4', title: 'SECTIONS', page: 2 },
    { id: 'sizes', name: 'S0', title: 'SCHEDULES', page: 3 },
  ],
} as Project;
const model = {
  levels: [
    { id: 'L1', elevation: 0 },
    { id: 'L2', elevation: 4 },
  ],
  elements: [
    {
      id: 'b',
      measurementId: 'm',
      trade: 'structure',
      sheetId: 'p',
      level: 'L1',
      typeName: 'B3 Beam',
      quantity: 8,
      sources: [],
      issues: ['Beam span is positioned in plan only.'],
      shape: {
        type: 'axis',
        points: [
          [0, 0],
          [8, 0],
        ],
        z: 0,
      },
    },
  ],
} as unknown as BuildModel;
const texts = {
  p: [
    t('PANELS: 175 E1 CLT', 100, 500),
    t('DENOTES SPAN OF CLT WOOD PANELS w/ 50mm CONCRETE TOPPING,', 120, 480),
    t('C1', 5, 5),
    t('C1', 75, 5),
    t('B3', 40, 2),
  ],
  s: [
    t('FIN. SECOND FLOOR', 500, 56),
    t('4000', 500, 64),
    t('FIN. GROUND FLOOR', 500, 96),
    t('0', 500, 104),
  ],
  sizes: [
    t('BEAM SCHEDULE', 100, 10),
    t('MARK', 50, 30),
    t('SIZE', 130, 30),
    t('B3', 50, 50),
    t('265 x 608 GLULAM', 130, 50),
    t('COLUMN SCHEDULE', 100, 100),
    t('MARK', 50, 120),
    t('SIZE', 130, 120),
    t('C1', 50, 140),
    t('200 x 200 GLULAM', 130, 140),
  ],
};
const line = (x1: number, y1: number, x2: number, y2: number) => ({
  x1,
  y1,
  x2,
  y2,
  width: 0.3,
  filled: false,
});
const lines = {
  p: [0, 80].flatMap((x) => [
    line(x - 1, -1, x + 1, -1),
    line(x + 1, -1, x + 1, 1),
    line(x + 1, 1, x - 1, 1),
    line(x - 1, 1, x - 1, -1),
  ]),
  s: [
    line(480, 60, 520, 60),
    line(480, 100, 520, 100),
    line(100, 62.25, 100, 68.33),
    line(180, 62.25, 180, 68.33),
    line(100, 62.25, 180, 62.25),
  ],
};
it('uses schedule section, documented assembly and matching drawn section depth', () => {
  const out = connectFloorBeams(project, model, texts, lines).elements[0];
  expect(out.shape).toMatchObject({
    type: 'run',
    z0: 3.167,
    height: 0.608,
    thickness: 0.265,
  });
  expect(out.quantity).toBe(8);
  expect(out.sources.some((s) => s.id === 's')).toBe(true);
  expect(model.elements[0].shape?.type).toBe('axis');
});
it('refuses physical extrusion without confirming section edges or with wrong depth', () => {
  expect(
    connectFloorBeams(project, model, texts, {}).elements[0].shape?.type,
  ).toBe('axis');
  const wrong = {
    p: lines.p,
    s: lines.s.map((l) => ({ ...l, y2: l.y2 === 68.33 ? 70 : l.y2 })),
  };
  expect(
    connectFloorBeams(project, model, texts, wrong).elements[0].shape?.type,
  ).toBe('axis');
});

it('recovers a callout-interrupted span from scheduled bearings without changing its accepted quantity', () => {
  const fragmentedProject = {
    ...project,
    measurements: [
      {
        ...project.measurements[0],
        points: [
          [8, 0],
          [72, 0],
        ] as [number, number][],
      },
    ],
  };
  const fragmentedModel = {
    ...model,
    elements: model.elements.map((e) => ({
      ...e,
      shape: {
        type: 'axis' as const,
        points: [
          [0.8, 0],
          [7.2, 0],
        ] as [number, number][],
        z: 0,
      },
    })),
  };
  const out = connectFloorBeams(
    fragmentedProject,
    fragmentedModel,
    texts,
    lines,
  ).elements[0];
  expect(out.shape).toMatchObject({
    type: 'run',
    points: [
      [0, 0],
      [8, 0],
    ],
  });
  expect(out.quantity).toBe(8);
});
it('withholds physical extrusion when plan bearings, bay marks, or current sheet applicability are absent', () => {
  expect(
    connectFloorBeams(project, model, texts, { s: lines.s }).elements[0].shape
      ?.type,
  ).toBe('axis');
  const noMark = { ...texts, p: texts.p.filter((t) => t.str !== 'B3') };
  expect(
    connectFloorBeams(project, model, noMark, lines).elements[0].shape?.type,
  ).toBe('axis');
  const superseded = {
    ...project,
    sheets: project.sheets.map((s) =>
      s.id === 'p' ? { ...s, superseded: true } : s,
    ),
  };
  expect(
    connectFloorBeams(superseded, model, texts, lines).elements[0].shape?.type,
  ).toBe('axis');
});

it('joins touching column outline strokes but refuses to bridge missing ink', () => {
  const fragmented = lines.p.flatMap((l) =>
    Math.abs(l.x1 - l.x2) < 0.01
      ? [
          { ...l, y2: 0 },
          { ...l, y1: 0 },
        ]
      : [l],
  );
  expect(
    connectFloorBeams(project, model, texts, { ...lines, p: fragmented })
      .elements[0].shape?.type,
  ).toBe('run');
  const gaps = fragmented.map((l) =>
    Math.abs(l.x1 - l.x2) < 0.01 && l.y2 === 0
      ? { ...l, y2: l.y1 < 0 ? -0.2 : 0.2 }
      : l,
  );
  expect(
    connectFloorBeams(project, model, texts, { ...lines, p: gaps }).elements[0]
      .shape?.type,
  ).toBe('axis');
});
it('does not fall back to original floor geometry when known structural replacement evidence is missing', () => {
  const revised = {
    ...project,
    specs: [
      {
        id: 'revision',
        name: 'Addendum',
        book: {
          addendum: 5,
          pages: 2,
          changes: [
            {
              page: 1,
              text: 'Structural Addendum: MAIN FRAMING PLAN replacement',
            },
          ],
        },
      },
    ],
  } as unknown as Project;
  const out = connectFloorBeams(revised, model, texts, lines).elements[0];
  expect(out.shape?.type).toBe('axis');
  expect(
    out.issues.some((i) => i.startsWith('Floor revision evidence pending:')),
  ).toBe(true);
});
