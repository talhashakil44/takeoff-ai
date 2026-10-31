import { expect, it } from 'vitest';
import {
  footingTopDatum,
  hasFootingCrossbar,
  padJunctionPerimeter,
  padMassTopDatum,
  recoverFoundationGeometry,
} from '../src/build/foundationGeometry';
import type { Project } from '../src/model';
import type { BuildElement, BuildModel } from '../src/build/types';
import type { DrawingTexts } from '../src/build/building';
const text = (str: string, cx: number, cy: number) => ({
  str,
  cx,
  cy,
  w: 20,
  h: 5,
});
const texts: DrawingTexts = {
  schedule: [
    text('CONCRETE FOOTING SCHEDULE', 160, 20),
    text('MARK', 30, 40),
    text('TYPE', 90, 40),
    text('DEPTH', 150, 40),
    text('SIZE', 240, 40),
    text('SF-1', 30, 60),
    text('S', 90, 60),
    text('300', 150, 60),
    text('600', 240, 60),
    text('F1', 30, 80),
    text('P', 90, 80),
    text('300', 150, 80),
    text('1500 x 1500', 240, 80),
    text('F2', 30, 100),
    text('P', 90, 100),
    text('300', 150, 100),
    text('1500 x 1800', 240, 100),
  ],
  section: [
    text('FIN. GROUND FLOOR', 400, 400),
    text('0', 420, 408),
    text('T/O FOOTING', 400, 450),
    text('-1200', 420, 458),
  ],
};
const project = {
  units: 'metric',
  sheets: [
    { id: 'schedule', name: 'S0.2', page: 3 },
    { id: 'section', name: 'S4.0', page: 14 },
    { id: 'plan', name: 'S1.0', page: 4, metersPerPoint: 0.01 },
  ],
  measurements: [
    {
      id: 'run',
      sheetId: 'plan',
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
    },
  ],
  types: [],
} as unknown as Project;
const strip = {
  id: 'run',
  measurementId: 'run',
  measurementSource: 'foundations',
  typeName: 'SF-1 – Strip footing',
  shape: {
    type: 'run',
    points: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    z0: -1.2,
    height: 1.2,
    thickness: 0.15,
  },
  sheetId: 'plan',
  quantity: 2,
  unit: 'm',
  sources: [],
  issues: [],
  placement: 'inferred',
} as unknown as BuildElement;
const pad = {
  ...strip,
  id: 'pad',
  measurementId: 'pad',
  typeName: 'F1 – Pad footing',
  shape: { type: 'locator', at: [2, 3], z: -1.2 },
  quantity: 1,
  unit: 'ea',
} as BuildElement;
const model = { elements: [strip, pad], levels: [] } as unknown as BuildModel;
it('extrudes schedule-sized footings DOWN from top datum, preserving source quantities and grid placement', () => {
  const before = JSON.stringify({ project, model });
  const out = recoverFoundationGeometry(project, model, texts);
  expect(out.elements[0].shape).toEqual({
    type: 'run',
    points: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    z0: -1.5,
    height: 0.3,
    thickness: 0.6,
  });
  expect(out.elements[1].shape).toEqual(pad.shape);
  expect(out.elements.map((e) => e.quantity)).toEqual([2, 1]);
  expect(out.elements[0].sources.map((s) => s.id)).toEqual(
    expect.arrayContaining(['schedule', 'section']),
  );
  expect(out.elements[1].placement).toBe('inferred');
  expect(JSON.stringify({ project, model })).toBe(before);
});
it('does not choose a global footing elevation when section datums conflict', () => {
  const conflicting = {
    ...texts,
    section: [
      ...texts.section,
      text('T/O FOOTING', 400, 500),
      text('-1800', 420, 508),
    ],
  };
  expect(footingTopDatum(project, conflicting)).toBeNull();
  expect(recoverFoundationGeometry(project, model, conflicting)).toBe(model);
});
it('does not manufacture rectangular pad orientation or pier height', () => {
  const unresolved = {
    ...model,
    elements: [
      { ...pad, typeName: 'F2 – Pad footing' },
      { ...pad, typeName: 'P1 – Pier' },
    ],
  };
  expect(
    recoverFoundationGeometry(project, unresolved, texts).elements.map(
      (e) => e.shape,
    ),
  ).toEqual(unresolved.elements.map((e) => e.shape));
});
it('requires datum grounding and refuses missing schedule thickness', () => {
  expect(
    footingTopDatum(project, { ...texts, section: texts.section.slice(2) }),
  ).toBeNull();
  const missing = {
    ...texts,
    schedule: texts.schedule.filter((t) => t.str !== '300'),
  };
  expect(
    recoverFoundationGeometry(project, model, missing).elements.map(
      (e) => e.shape,
    ),
  ).toEqual(model.elements.map((e) => e.shape));
});

it('refuses contradictory footing schedules and ignores superseded tables', () => {
  const p = {
    ...project,
    sheets: [
      ...project.sheets,
      { ...project.sheets[0], id: 'revised', name: 'S0.3' },
    ],
  };
  const competing = {
    ...texts,
    revised: texts.schedule.map((t) => ({
      ...t,
      str: t.str === '300' ? '450' : t.str,
    })),
  };
  expect(
    recoverFoundationGeometry(p, model, competing).elements.map((e) => e.shape),
  ).toEqual(model.elements.map((e) => e.shape));
  p.sheets[p.sheets.length - 1] = {
    ...p.sheets[p.sheets.length - 1],
    superseded: true,
  };
  expect(
    recoverFoundationGeometry(p, model, competing).elements[0].shape,
  ).toMatchObject({ type: 'run', height: 0.3, z0: -1.5 });
});

it('uses an interior pad detail only inside slab and away from walls, and repairs previously extruded pads', () => {
  const wall = {
    ...strip,
    id: 'wall',
    typeName: 'FW1 – Foundation wall',
    shape: {
      ...strip.shape,
      type: 'run',
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    },
  } as BuildElement;
  const slab = {
    ...strip,
    id: 'slab',
    typeName: 'Slab on grade',
    shape: {
      type: 'surface',
      ring: [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 5],
      ],
      holes: [],
      z: -1.2,
      thickness: 0.2,
    },
  } as BuildElement;
  const detail = {
    ...texts,
    section: [
      ...texts.section,
      text('DROP T/O FOOTING 200', 400, 420),
      text('SECTION - TYPICAL INTERIOR PAD FOOTING', 400, 600),
    ],
  };
  const m = { ...model, elements: [strip, pad, wall, slab] };
  const out = recoverFoundationGeometry(project, m, detail);
  expect(out.elements[1].shape).toMatchObject({
    type: 'point',
    z: -0.5,
    size: [1.5, 1.5, 0.3],
  });
  const again = recoverFoundationGeometry(project, out, detail);
  expect(again.elements[1].shape).toEqual(out.elements[1].shape);
  const old = {
    ...m,
    elements: m.elements.map((e) =>
      e.id === pad.id
        ? {
            ...e,
            shape: {
              type: 'point',
              at: [2, 3],
              z: -1.5,
              size: [1.5, 1.5, 0.3],
            },
          }
        : e,
    ),
  } as BuildModel;
  expect(
    recoverFoundationGeometry(project, old, detail).elements[1].shape,
  ).toEqual(out.elements[1].shape);
  const coincidentPier = { ...pad, id: 'pier', typeName: 'P1 – Pier' };
  expect(
    recoverFoundationGeometry(
      project,
      { ...m, elements: [...m.elements, coincidentPier] },
      detail,
    ).elements[1].shape?.type,
  ).toBe('locator');
});

it('reads coordinate-only production text without inventing text dimensions', () => {
  const slim = Object.fromEntries(
    Object.entries(texts).map(([id, ts]) => [
      id,
      ts.map(({ str, cx, cy }) => ({ str, cx, cy })),
    ]),
  );
  expect(
    recoverFoundationGeometry(project, model, slim).elements.map(
      (e) => e.shape,
    ),
  ).toEqual(
    recoverFoundationGeometry(project, model, texts).elements.map(
      (e) => e.shape,
    ),
  );
});

it('recovers a rectangular exterior pier from its actual eccentric source outline and local section', () => {
  const p = {
    ...project,
    sheets: [
      ...project.sheets,
      { ...project.sheets[0], id: 'piers', name: 'S0.3', page: 3 },
    ],
  };
  const source = {
    ...texts,
    piers: [
      text('PIER SCHEDULE', 160, 20),
      text('MARK', 30, 40),
      text('SIZE', 90, 40),
      text('P2', 30, 60),
      text('480 x 800', 90, 60),
    ],
    section: [
      ...texts.section,
      text('DROP T/O FOOTING 200', 400, 420),
      text('SECTION - TYPICAL LOW PIER AT EXTERIOR', 400, 600),
    ],
  };
  const pier = {
    ...pad,
    id: 'pier',
    measurementId: 'pier',
    typeName: 'P2 – Concrete pier 480 x 800',
  };
  const wall = {
    ...strip,
    id: 'wall',
    typeName: 'FW-3 – ICF foundation wall',
    shape: {
      type: 'run',
      points: [
        [1.8, 2],
        [1.8, 4],
      ],
      z0: -1.2,
      height: 1.2,
      thickness: 0.3,
    },
  } as BuildElement;
  const m = { ...model, elements: [strip, pad, pier, wall] };
  const points = [
    [180, 260],
    [228, 260],
    [228, 340],
    [180, 340],
    [180, 260],
  ];
  const outline = points.slice(1).map((b, i) => ({
    x1: points[i][0],
    y1: points[i][1],
    x2: b[0],
    y2: b[1],
    filled: true,
    width: 0,
    sub: 1,
  }));
  const lines = {
    plan: [
      ...outline,
      ...outline
        .slice(0, 2)
        .map((l) => ({ ...l, filled: false, width: 1, sub: 2 })),
    ],
  };
  const out = recoverFoundationGeometry(p, m, source, lines);
  expect(out.elements[1].shape).toMatchObject({ type: 'point', z: -1.5 });
  expect(out.elements[2].shape).toEqual({
    type: 'point',
    at: [2.04, 3],
    z: -1.2,
    size: [0.48, 0.8, 1],
    rotation: 0,
  });
  expect(out.elements[2].quantity).toBe(pier.quantity);
  expect(recoverFoundationGeometry(p, out, source, lines)).toEqual(out);
  expect(
    recoverFoundationGeometry(p, m, source, { plan: outline }).elements[2].shape
      ?.type,
  ).toBe('locator');
});

it('places interior slab concrete below finished ground using its own construction note', () => {
  const slab = {
    ...strip,
    id: 'slab',
    typeName: 'Slab on grade',
    shape: {
      type: 'surface',
      ring: [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 5],
      ],
      holes: [],
      z: -1.18,
      thickness: 0.2,
    },
  } as BuildElement;
  const source = {
    ...texts,
    plan: [
      text('TYPICAL INTERIOR SLAB CONSTRUCTION:', 400, 400),
      text('100, 25 MPa CLASS N-CF CONRETE r/w', 408, 400),
      text('TYPICAL EXTERIOR SLAB CONSTRUCTION', 800, 400),
      text('200, 35 MPa CONCRETE', 808, 400),
    ],
  };
  const m = { ...model, elements: [...model.elements, slab] };
  const out = recoverFoundationGeometry(project, m, source);
  expect(out.elements[2].shape).toEqual({
    ...slab.shape,
    z: -0.1,
    thickness: 0.1,
  });
  expect(out.elements[2].quantity).toBe(slab.quantity);
  expect(recoverFoundationGeometry(project, out, source)).toEqual(out);
  expect(
    recoverFoundationGeometry(project, m, {
      ...source,
      plan: source.plan.slice(2),
    }).elements[2].shape,
  ).toEqual(slab.shape);
});

it('recovers a square corner pier only with an associated exterior pad and drawn outline', () => {
  const p = {
    ...project,
    sheets: [
      ...project.sheets,
      { ...project.sheets[0], id: 'piers', name: 'S0.3' },
    ],
  };
  const source = {
    ...texts,
    piers: [
      text('PIER SCHEDULE', 160, 20),
      text('MARK', 30, 40),
      text('SIZE', 90, 40),
      text('P3', 30, 60),
      text('670 x 670', 90, 60),
    ],
    section: [
      ...texts.section,
      text('DROP T/O FOOTING 200', 400, 420),
      text('SECTION - TYPICAL LOW PIER AT EXTERIOR', 400, 600),
    ],
  };
  const pier = {
    ...pad,
    id: 'pier',
    measurementId: 'pier',
    typeName: 'P3 – Concrete pier 670 x 670',
  };
  const wall = {
    ...strip,
    id: 'wall',
    typeName: 'FW-3 – ICF foundation wall',
    shape: {
      type: 'run',
      points: [
        [1.8, 2],
        [1.8, 4],
      ],
      z0: -1.2,
      height: 1.2,
      thickness: 0.3,
    },
  } as BuildElement;
  const m = { ...model, elements: [strip, pad, pier, wall] };
  const points = [
    [180, 280],
    [247, 280],
    [247, 347],
    [180, 347],
    [180, 280],
  ];
  const outline = points
    .slice(1)
    .map((b, i) => ({
      x1: points[i][0],
      y1: points[i][1],
      x2: b[0],
      y2: b[1],
      filled: true,
      width: 0,
      sub: 1,
    }));
  const lines = {
    plan: [
      ...outline,
      ...outline
        .slice(0, 2)
        .map((l) => ({ ...l, filled: false, width: 1, sub: 2 })),
    ],
  };
  const out = recoverFoundationGeometry(p, m, source, lines);
  expect(out.elements[2].shape).toMatchObject({
    type: 'point',
    z: -1.2,
    size: [0.67, 0.67, 1],
    rotation: 0,
  });
  const shape = out.elements[2].shape;
  if (shape?.type !== 'point')
    throw new Error('Expected recovered corner pier');
  expect(shape.at[0]).toBeCloseTo(2.135, 8);
  expect(shape.at[1]).toBeCloseTo(3.135, 8);
  expect(recoverFoundationGeometry(p, out, source, lines)).toEqual(out);
  const noPad = { ...m, elements: [strip, pier, wall] };
  expect(
    recoverFoundationGeometry(p, noPad, source, lines).elements[1].shape?.type,
  ).toBe('locator');
  const interiorP1 = {
    ...m,
    elements: [
      strip,
      { ...pad, typeName: 'F1 – Pad footing' },
      { ...pier, typeName: 'P1 – Concrete pier 600 x 600' },
    ],
  };
  const p1Source = {
    ...source,
    piers: source.piers.map((t) => ({
      ...t,
      str: t.str === 'P3' ? 'P1' : t.str === '670 x 670' ? '600 x 600' : t.str,
    })),
  };
  expect(
    recoverFoundationGeometry(p, interiorP1, p1Source, lines).elements[2].shape
      ?.type,
  ).toBe('locator');
});

it('withholds stale physical foundations when a newer addendum has unresolved local elevations', () => {
  const p = {
    ...project,
    specs: [
      {
        id: 'revision',
        name: 'Addendum 5',
        book: {
          addendum: 5,
          changes: [
            { page: 21, text: 'FOUNDATION PLAN T/O FTG: -1500 U/S FTG: -1800' },
          ],
        },
      },
    ],
  } as unknown as Project;
  const solid = {
    ...pad,
    shape: { type: 'point', at: [2, 3], z: -1.5, size: [1.5, 1.5, 0.3] },
  } as BuildElement;
  const m = { ...model, elements: [strip, solid] };
  const out = recoverFoundationGeometry(p, m, texts);
  expect(out.elements[0].shape?.type).toBe('axis');
  expect(out.elements[1].shape?.type).toBe('locator');
  expect(out.elements[1].sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'spec', id: 'revision', page: 21 }),
    ]),
  );
  expect(out.elements[1].issues.join(' ')).toContain(
    'Foundation revision unresolved',
  );
  expect(out.elements.map((e) => e.quantity)).toEqual(
    m.elements.map((e) => e.quantity),
  );
  expect(recoverFoundationGeometry(p, out, texts)).toEqual(out);
});

it('uses a revised grid, drawn pad perimeter and actual arrowhead before applying a local datum', () => {
  const scale = (100 * 0.0254) / 72;
  const grids = [
    text('1', 0, -40),
    text('2', 100, -40),
    text('3', 200, -40),
    text('A', -40, 0),
    text('B', -40, 100),
    text('C', -40, 200),
  ];
  const p = {
    ...project,
    sheets: project.sheets.map((s) =>
      s.id === 'plan'
        ? { ...s, width: 500, height: 500, metersPerPoint: scale }
        : s,
    ),
    specs: [
      {
        id: 'revision',
        name: 'Addendum 5',
        book: {
          addendum: 5,
          changes: [
            { page: 19, text: 'FOOTING SCHEDULE' },
            { page: 21, text: 'FOUNDATION PLAN T/O FTG: -1500 U/S FTG: -1800' },
          ],
        },
      },
    ],
  } as unknown as Project;
  const run = {
    ...strip,
    shape: {
      type: 'run',
      points: [
        [0, 0],
        [100 * scale, 0],
        [100 * scale, 100 * scale],
      ],
      z0: -1.2,
      height: 1.2,
      thickness: 0.6,
    },
  } as BuildElement;
  const located = {
    ...pad,
    shape: { type: 'locator', at: [100 * scale, 100 * scale], z: -1.2 },
  } as BuildElement;
  const m = { ...model, elements: [run, located] };
  const source = {
    ...texts,
    plan: grids,
    'spec:revision:19': texts.schedule,
    'spec:revision:21': [
      ...grids,
      text('FOUNDATION PLAN', 300, 600),
      text('1 : 100', 300, 620),
      text('T/O FTG: -1500', 50, 40),
      text('U/S FTG: -1800', 50, 50),
    ],
  };
  const lo = 100 - 0.75 / scale,
    hi = 100 + 0.75 / scale;
  const corners = [
    [lo, lo],
    [hi, lo],
    [hi, hi],
    [lo, hi],
    [lo, lo],
  ];
  const outline = corners
    .slice(1)
    .map((b, i) => ({
      x1: corners[i][0],
      y1: corners[i][1],
      x2: b[0],
      y2: b[1],
      width: 0.6,
      filled: false,
      sub: i,
    }));
  const arrow = [
    [lo, lo],
    [lo - 7, lo - 5],
    [lo - 5, lo - 7],
    [lo, lo],
  ];
  const triangles = arrow
    .slice(1)
    .map((b, i) => ({
      x1: arrow[i][0],
      y1: arrow[i][1],
      x2: b[0],
      y2: b[1],
      width: 0,
      filled: true,
      sub: 20,
    }));
  const leader = {
    x1: lo,
    y1: lo,
    x2: 60,
    y2: 55,
    width: 0.24,
    filled: false,
    sub: 21,
  };
  const lines = { 'spec:revision:21': [...outline, ...triangles, leader] };
  const out = recoverFoundationGeometry(p, m, source, lines);
  expect(out.elements[1].shape).toMatchObject({
    type: 'point',
    z: -1.8,
    size: [1.5, 1.5, 0.3],
  });
  expect(out.elements[1].sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'spec', id: 'revision', page: 21 }),
    ]),
  );
  expect(recoverFoundationGeometry(p, out, source, lines)).toEqual(out);
  expect(
    recoverFoundationGeometry(p, m, source, {
      'spec:revision:21': [...outline, leader],
    }).elements[1].shape?.type,
  ).toBe('locator');
  const alternate = {
    ...source,
    'spec:revision:21': source['spec:revision:21'].filter(
      (t) => !t.str.startsWith('T/O') && !t.str.startsWith('U/S'),
    ),
  };
  expect(
    recoverFoundationGeometry(p, m, alternate, lines).elements[1].shape?.type,
  ).toBe('locator');
  // The latest named low-pier detail, not the old 200 mm note, controls its top.
  p.types=[{id:'pier-type',height:1.2,items:[{id:'volume',name:'Concrete',unit:'m³',formula:'N * W * D * H * 1.05'}]} as Project['types'][number]];
  p.specs![0].book!.changes!.push({
    page: 22,
    text: 'FOUNDATION SECTIONS',
    label: 'revision',
    y: 0,
    sections: [],
    sheets: [],
    action: 'clarified',
  });
  const pier = {
    ...located,
    id: 'p3',
    typeId: 'pier-type',
    measurementId: 'p3',
    typeName: 'P3 – Concrete pier 670 x 670',
  };
  const wall = {
    ...run,
    id: 'wall',
    measurementId: 'wall',
    typeName: 'FW-3 ICF',
    shape: {
      type: 'run',
      points: [
        [100 * scale - 0.3, 2],
        [100 * scale - 0.3, 5],
      ],
      z0: -1.2,
      height: 1.2,
      thickness: 0.3,
    },
  } as BuildElement;
  const pierSource = {
    ...source,
    'spec:revision:19': [
      ...texts.schedule,
      text('PIER SCHEDULE', 660, 20),
      text('MARK', 530, 40),
      text('SIZE', 590, 40),
      text('P3', 530, 60),
      text('670 x 670', 590, 60),
    ],
    'spec:revision:21': source['spec:revision:21'].map((t) => ({
      ...t,
      str:
        t.str === 'T/O FTG: -1500'
          ? 'T/O FTG: -1200'
          : t.str === 'U/S FTG: -1800'
            ? 'U/S FTG: -1500'
            : t.str,
    })),
    'spec:revision:22': [
      ...texts.section,
      text('DROP T/O FOOTING 250', 400, 420),
      text('SECTION - TYPICAL LOW PIER AT EXTERIOR', 400, 600),
    ],
  };
  const ph = 0.335 / scale,
    pp = [
      [100 - ph, 100 - ph],
      [100 + ph, 100 - ph],
      [100 + ph, 100 + ph],
      [100 - ph, 100 + ph],
      [100 - ph, 100 - ph],
    ];
  const filled = pp
    .slice(1)
    .map((b, i) => ({
      x1: pp[i][0],
      y1: pp[i][1],
      x2: b[0],
      y2: b[1],
      width: 0,
      filled: true,
      sub: 100,
    }));
  const pierLines = {
    'spec:revision:21': [
      ...lines['spec:revision:21'],
      ...filled,
      ...filled
        .slice(0, 2)
        .map((l) => ({ ...l, filled: false, width: 1, sub: 101 })),
    ],
  };
  const recovered = recoverFoundationGeometry(
    p,
    { ...m, elements: [run, located, pier, wall] },
    pierSource,
    pierLines,
  );
  expect(recovered.elements[2].shape).toMatchObject({
    type: 'point',
    z: -1.2,
    size: [0.67, 0.67, 0.95],
  });
  expect(recovered.elements[2].issues.join(' ')).toContain(
    'Foundation revision applied:',
  );
  expect(
    recoverFoundationGeometry(p, recovered, pierSource, pierLines),
  ).toEqual(recovered);

  const pierWithoutLocalPad={'spec:revision:21':[...filled,...filled.slice(0,2).map(l=>({...l,filled:false,width:1,sub:101}))]};
  const unsupportedPier=recoverFoundationGeometry(p,{...m,elements:[run,located,pier,wall]},pierSource,pierWithoutLocalPad).elements[2];
  expect(unsupportedPier.shape?.type).toBe('locator');
  expect(unsupportedPier.issues.join(' ')).toContain('local supporting footing top is not proven');

  expect(recovered.elements[2].issues.join(' ')).toContain('Foundation revision discrepancy: accepted takeoff type H=1.200 m');
  expect(recovered.elements[2].issues.join(' ')).toContain('geometry height is 0.950 m');
  expect(recovered.elements[2].quantity).toBe(pier.quantity);
  const noHeightFormula={...p,types:p.types.map(t=>({...t,items:t.items.map(i=>({...i,formula:'N'}))}))};
  expect(recoverFoundationGeometry(noHeightFormula,{...m,elements:[run,located,pier,wall]},pierSource,pierLines).elements[2].issues.join(' ')).not.toContain('Foundation revision discrepancy:');
  const shifted = {
    'spec:revision:21': lines['spec:revision:21'].map((l) => ({
      ...l,
      x1: l.x1 + 2,
      x2: l.x2 + 2,
    })),
  };
  const eccentric = recoverFoundationGeometry(p, m, source, shifted).elements[1]
    .shape;
  expect(eccentric?.type).toBe('point');
  if (eccentric?.type === 'point')
    expect(eccentric.at[0]).toBeCloseTo(102 * scale, 6);

  const mass = {
    ...located,
    id: 'mass',
    measurementId: 'mass',
    typeName: 'MF2 – Mass footing 5000 x 1800 x 400',
  };
  const mp = {
    ...p,
    measurements: [
      ...p.measurements,
      { id: 'mass', sheetId: 'plan', points: [[180, 90]] },
    ],
  } as Project;
  const ms = {
    ...source,
    'spec:revision:19': [
      ...texts.schedule,
      text('MASS FOOTING SCHEDULE', 660, 200),
      text('MARK', 530, 220),
      text('SIZE', 590, 220),
      text('THICKNESS', 680, 220),
      text('MF2', 530, 250),
      text('5000 x 1800', 590, 250),
      text('400', 680, 250),
    ],
    'spec:revision:21': [
      ...source['spec:revision:21'].map((t) => ({
        ...t,
        str:
          t.str === 'T/O FTG: -1500'
            ? 'T/O FTG: -725'
            : t.str === 'U/S FTG: -1800'
              ? 'U/S FTG: -1125'
              : t.str,
      })),
      text('MF2', 180, 90),
    ],
  };
  const mx = 100 - 2.5 / scale,
    my = 100 - 0.9 / scale,
    mx1 = 100 + 2.5 / scale,
    my1 = 100 + 0.9 / scale;
  const mc = [
    [mx, my],
    [mx1, my],
    [mx1, my1],
    [mx, my1],
    [mx, my],
  ];
  const mf = mc
    .slice(1)
    .map((b, i) => ({
      x1: mc[i][0],
      y1: mc[i][1],
      x2: b[0],
      y2: b[1],
      filled: true,
      width: 0,
      sub: 300,
    }));
  const ma = [
    [mx, my],
    [mx + 7, my - 5],
    [mx + 5, my - 7],
    [mx, my],
  ];
  const mt = ma
    .slice(1)
    .map((b, i) => ({
      x1: ma[i][0],
      y1: ma[i][1],
      x2: b[0],
      y2: b[1],
      filled: true,
      width: 0,
      sub: 301,
    }));
  const ml = {
    'spec:revision:21': [
      ...mf,
      ...mt,
      { x1: mx, y1: my, x2: 60, y2: 55, filled: false, width: 0.24, sub: 302 },
    ],
  };
  const mm = { ...m, elements: [run, mass] };
  const massOut = recoverFoundationGeometry(mp, mm, ms, ml);
  expect(massOut.elements[1].shape).toMatchObject({
    type: 'point',
    z: -1.125,
    size: [5, 1.8, 0.4],
  });
  expect(recoverFoundationGeometry(mp, massOut, ms, ml)).toEqual(massOut);
  // A fully direct mass datum needs no unrelated adjoining strip or accepted record.
  const directDrawingModel = { ...m, elements: [run] };
  const directDrawing = recoverFoundationGeometry(p, directDrawingModel, ms, ml);
  expect(directDrawing.elements).toHaveLength(1);
  expect(directDrawing.drawingGeometry).toHaveLength(1);
  expect(directDrawing.drawingGeometry![0]).toMatchObject({
    origin: 'drawing', quantity: 0, typeId: '',
    shape: { type: 'point', z: -1.125, size: [5, 1.8, .4] },
  });
  expect(directDrawing.drawingGeometry![0].issues.join(' ')).toContain('direct local top/underside leader');
  expect(recoverFoundationGeometry(p, directDrawing, ms, ml)).toEqual(directDrawing);
  expect(recoverFoundationGeometry(p, directDrawing, ms, {
    'spec:revision:21': mf,
  }).drawingGeometry).toEqual([]);
  const stripDepth = {
    ...ms,
    'spec:revision:21': ms['spec:revision:21'].map((t) => ({
      ...t,
      str: t.str === 'U/S FTG: -1125' ? 'U/S FTG: -1025' : t.str,
    })),
  };
  expect(
    recoverFoundationGeometry(mp, mm, stripDepth, ml).elements[1].shape?.type,
  ).toBe('locator');

  const strip2 = {
    ...run,
    id: 'strip2',
    measurementId: 'strip2',
    shape: {
      type: 'run',
      points: [
        [120 * scale, 101.4 * scale],
        [200 * scale, 101.4 * scale],
      ],
      z0: -1.5,
      height: 0.3,
      thickness: 0.6,
    },
  } as BuildElement;
  const sp = {
    ...p,
    measurements: [
      ...p.measurements,
      {
        id: 'strip2',
        sheetId: 'plan',
        points: [
          [120, 101.4],
          [200, 101.4],
        ],
      },
    ],
  } as Project;
  const span = { ...m, elements: [run, located, strip2] };
  const halfStrip = 0.3 / scale;
  const boundaries = [
    {
      x1: hi,
      y1: 100 - halfStrip,
      x2: 200,
      y2: 100 - halfStrip,
      width: 0.6,
      filled: false,
      sub: 400,
    },
    {
      x1: hi,
      y1: 100 + halfStrip,
      x2: 200,
      y2: 100 + halfStrip,
      width: 0.6,
      filled: false,
      sub: 401,
    },
  ];
  const sl = {
    'spec:revision:21': [...lines['spec:revision:21'], ...boundaries],
  };
  const stripOut = recoverFoundationGeometry(sp, span, source, sl);
  expect(stripOut.elements[2].shape).toMatchObject({
    type: 'run',
    z0: -1.8,
    height: 0.3,
    thickness: 0.6,
  });
  const recoveredStrip = stripOut.elements[2].shape;
  if (recoveredStrip?.type !== 'run')
    throw new Error('Expected revised continuous strip');
  expect(recoveredStrip.points[0][1]).toBeCloseTo(100 * scale, 6);
  expect(recoverFoundationGeometry(sp, stripOut, source, sl)).toEqual(stripOut);
  const stepped = {
    ...source,
    'spec:revision:21': [...source['spec:revision:21'], text('SF', 160, 100)],
  };
  expect(
    recoverFoundationGeometry(sp, span, stepped, sl).elements[2].shape?.type,
  ).toBe('axis');
  const splitStep = (x: number) => [
    {x1:x,y1:100-halfStrip,x2:x,y2:100-halfStrip+.2/scale,width:.6,filled:false,sub:990},
    {x1:x,y1:100+halfStrip-.2/scale,x2:x,y2:100+halfStrip,width:.6,filled:false,sub:991},
  ];
  const unlabelledStep = {'spec:revision:21':[...sl['spec:revision:21'],...splitStep(160)]};
  expect(recoverFoundationGeometry(sp,stripOut,source,unlabelledStep).elements[2].shape?.type).toBe('axis');
  const broken={'spec:revision:21':[...lines['spec:revision:21'],{...boundaries[0],x2:155},{...boundaries[0],x1:175},boundaries[1]]};
  const stopped=recoverFoundationGeometry(sp,span,source,broken).elements[2].shape;
  expect(stopped?.type).toBe('run');
  if(stopped?.type==='run')expect(stopped.points[1][0]).toBeCloseTo(155*scale,6);
  const junctionEnd=155+.6/scale;
  const junction={'spec:revision:21':[...lines['spec:revision:21'],{...boundaries[0],x2:155},{...boundaries[0],x1:junctionEnd},boundaries[1],{x1:155,y1:100-halfStrip,x2:155,y2:80,width:.6,filled:false,sub:500},{x1:junctionEnd,y1:100-halfStrip,x2:junctionEnd,y2:80,width:.6,filled:false,sub:501}]};
  const joined=recoverFoundationGeometry(sp,span,source,junction).elements[2].shape;
  expect(joined?.type).toBe('run');
  if(joined?.type==='run')expect(joined.points[1][0]).toBeCloseTo(200*scale,6);

  // A direct leader may resolve a later bounded region after an unsupported gap.
  // No connected pad or nearest-text fallback is available for this interval.
  const directSource={...source,'spec:revision:21':[...grids,text('FOUNDATION PLAN',300,600),text('1 : 100',300,620),text('T/O FTG: -250',220,40),text('U/S FTG: -550',220,50)]};
  const tipY=100-halfStrip,ar=[[185,tipY],[188,tipY-8],[190,tipY-6],[185,tipY]];
  const directArrow=ar.slice(1).map((q,i)=>({x1:ar[i][0],y1:ar[i][1],x2:q[0],y2:q[1],width:0,filled:true,sub:600}));
  const directLines={'spec:revision:21':[{...boundaries[0],x2:145},{...boundaries[0],x1:165},boundaries[1],...directArrow,{x1:185,y1:tipY,x2:205,y2:55,width:.24,filled:false,sub:601}]};
  const directModel={...m,elements:[run,strip2]};
  const directOut=recoverFoundationGeometry(sp,directModel,directSource,directLines);
  expect(directOut.elements[1].shape).toMatchObject({type:'run',z0:-.55,height:.3,thickness:.6});
  const directShape=directOut.elements[1].shape;
  if(directShape?.type!=='run')throw new Error('Expected directly leader-dimensioned strip');
  expect(directShape.points[0][0]).toBeCloseTo(165*scale,6);
  expect(directShape.points[1][0]).toBeCloseTo(200*scale,6);
  expect(directOut.elements[1].quantity).toBe(strip2.quantity);
  expect(recoverFoundationGeometry(sp,directOut,directSource,directLines)).toEqual(directOut);
  expect(recoverFoundationGeometry(sp,directModel,directSource,{'spec:revision:21':directLines['spec:revision:21'].filter(l=>!l.filled)}).elements[1].shape?.type).toBe('axis');

  // A separately scheduled mass meeting the bounded strip inherits only its top.
  const massRight=200+5/scale, massLow=100-.9/scale, massHigh=100+.9/scale;
  const ring=[[200,massLow],[massRight,massLow],[massRight,massHigh],[200,massHigh],[200,massLow]];
  const massEdges=ring.slice(1).map((q,i)=>({x1:ring[i][0],y1:ring[i][1],x2:q[0],y2:q[1],filled:true,width:0,sub:800}));
  const joinedProject={...sp,measurements:[...sp.measurements,{id:'mass',sheetId:'plan',points:[[220,90]]}]} as Project;
  const joinedSource={...directSource,'spec:revision:19':ms['spec:revision:19'],'spec:revision:21':[...directSource['spec:revision:21'],text('MF2',220,90)]};
  const joinedLines={'spec:revision:21':[...directLines['spec:revision:21'],...massEdges]};
  const joinedModel={...directModel,elements:[...directModel.elements,mass]};
  const massJoined=recoverFoundationGeometry(joinedProject,joinedModel,joinedSource,joinedLines);
  expect(massJoined.elements[2].shape).toMatchObject({type:'point',size:[5,1.8,.4]});
  if(massJoined.elements[2].shape?.type==='point')expect(massJoined.elements[2].shape.z).toBeCloseTo(-.65,8);
  expect(massJoined.elements[2].issues.join(' ')).toContain('top inferred from directly dimensioned adjoining strip');
  expect(massJoined.elements[2].quantity).toBe(mass.quantity);
  expect(recoverFoundationGeometry(joinedProject,massJoined,joinedSource,joinedLines)).toEqual(massJoined);
  const massWithUnlabelledStep={'spec:revision:21':[...joinedLines['spec:revision:21'],...splitStep(205)]};
  const guardedMass=recoverFoundationGeometry(joinedProject,massJoined,joinedSource,massWithUnlabelledStep);
  expect(guardedMass.elements[2].shape?.type).toBe('locator');
  expect(guardedMass.elements[1].shape).toEqual(massJoined.elements[1].shape);
  expect(guardedMass.elements.map(e=>e.quantity)).toEqual(massJoined.elements.map(e=>e.quantity));
  const drawingOnly=recoverFoundationGeometry(sp,directModel,joinedSource,joinedLines);
  expect(drawingOnly.elements).toEqual(recoverFoundationGeometry(sp,directModel,joinedSource,directLines).elements);
  expect(drawingOnly.drawingGeometry).toHaveLength(1);
  expect(drawingOnly.drawingGeometry![0]).toMatchObject({origin:'drawing',quantity:0,unit:'',typeId:'',planningExcluded:'Drawing-derived geometry; no accepted takeoff quantity'});
  expect(drawingOnly.drawingGeometry![0].id).toMatch(/^drawing:foundation:/);
  expect(drawingOnly.drawingGeometry![0].production).toBeUndefined();
  expect(recoverFoundationGeometry(sp,drawingOnly,joinedSource,joinedLines)).toEqual(drawingOnly);
  expect(recoverFoundationGeometry(sp,drawingOnly,joinedSource,directLines).drawingGeometry).toEqual([]);
  const steppedSource={...joinedSource,'spec:revision:21':[...joinedSource['spec:revision:21'],text('S.F.',210,125)]};
  expect(recoverFoundationGeometry(joinedProject,joinedModel,steppedSource,joinedLines).elements[2].shape?.type).toBe('locator');
  const separatedLines={'spec:revision:21':[...directLines['spec:revision:21'],...massEdges.map(l=>({...l,x1:l.x1+2,x2:l.x2+2}))]};
  expect(recoverFoundationGeometry(joinedProject,joinedModel,joinedSource,separatedLines).elements[2].shape?.type).toBe('locator');

  const padEdge=100+.75/scale,nearTip:[number,number]=[padEdge+10,100-halfStrip];
  const na=[nearTip,[nearTip[0]-8,nearTip[1]-1.5],[nearTip[0]-8,nearTip[1]+1.5],nearTip];
  const nearArrow=na.slice(1).map((q,i)=>({x1:na[i][0],y1:na[i][1],x2:q[0],y2:q[1],filled:true,width:0,sub:850}));
  const bridge=boundaries.map(l=>({...l,x1:padEdge,x2:nearTip[0]+2}));
  const padBandLines={'spec:revision:21':[...lines['spec:revision:21'].filter(l=>!l.filled),...bridge,...nearArrow,{x1:nearTip[0],y1:nearTip[1],x2:205,y2:55,width:.24,filled:false,sub:851}]};
  const bandModel={...m,elements:[run,located]};
  const padThroughBand=recoverFoundationGeometry(p,bandModel,directSource,padBandLines);
  expect(padThroughBand.elements[1].shape).toMatchObject({type:'point',z:-.55});
  expect(padThroughBand.elements[1].issues.join(' ')).toContain('source-bounded adjoining strip datum');
  expect(recoverFoundationGeometry(p,padThroughBand,directSource,padBandLines)).toEqual(padThroughBand);
  const mixedWeight={'spec:revision:21':padBandLines['spec:revision:21'].map(l=>l===bridge[1]?{...l,width:1.32}:l)};
  expect(recoverFoundationGeometry(p,bandModel,directSource,mixedWeight).elements[1].shape?.type).toBe('locator');
  const stepBetween={...directSource,'spec:revision:21':[...directSource['spec:revision:21'],text('S.F.',padEdge+5,100)]};
  expect(recoverFoundationGeometry(p,bandModel,stepBetween,padBandLines).elements[1].shape?.type).toBe('locator');
  const displacedStep={...directSource,'spec:revision:21':[...directSource['spec:revision:21'],text('S.F.',nearTip[0]+10,100)]};
  const stepStroke={x1:padEdge+5,y1:100-halfStrip,x2:padEdge+5,y2:100+halfStrip,width:.6,filled:false,sub:852};
  expect(recoverFoundationGeometry(p,bandModel,displacedStep,{'spec:revision:21':[...padBandLines['spec:revision:21'],stepStroke]}).elements[1].shape?.type).toBe('locator');
  expect(recoverFoundationGeometry(p,bandModel,directSource,{'spec:revision:21':[...bridge,...nearArrow,padBandLines['spec:revision:21'].at(-1)!]}).elements[1].shape?.type).toBe('locator');

  const branchTip = padEdge + 40, branchStart = padEdge + 10, branchEnd = branchStart + .6 / scale;
  const branchArrowPoints = [[branchTip,100-halfStrip],[branchTip-8,100-halfStrip-1.5],[branchTip-8,100-halfStrip+1.5],[branchTip,100-halfStrip]];
  const branchArrow = branchArrowPoints.slice(1).map((q,i) => ({x1:branchArrowPoints[i][0],y1:branchArrowPoints[i][1],x2:q[0],y2:q[1],width:0,filled:true,sub:860}));
  const returnEdges = [branchStart,branchEnd].map((x,i) => ({x1:x,y1:100-halfStrip,x2:x,y2:100-halfStrip-10,width:.6,filled:false,sub:861+i}));
  const branchLines = {'spec:revision:21':[
    ...lines['spec:revision:21'].filter(l => !l.filled),
    {...boundaries[0],x1:padEdge,x2:branchStart}, {...boundaries[0],x1:branchEnd,x2:branchTip+2},
    {...boundaries[1],x1:padEdge,x2:branchTip+2}, ...returnEdges,{x1:branchStart,y1:100-halfStrip-10,x2:branchEnd,y2:100-halfStrip-10,width:.6,filled:false,sub:863},...branchArrow,
    {x1:branchTip,y1:100-halfStrip,x2:205,y2:55,width:.24,filled:false,sub:863},
  ]};
  const branchPad = recoverFoundationGeometry(p,bandModel,directSource,branchLines);
  expect(branchPad.elements[1].shape).toMatchObject({type:'point',z:-.55});
  expect(recoverFoundationGeometry(p,branchPad,directSource,branchLines)).toEqual(branchPad);
  expect(recoverFoundationGeometry(p,branchPad,directSource,{'spec:revision:21':branchLines['spec:revision:21'].filter(l => l.sub !== 861)}).elements[1].shape?.type).toBe('locator');
  expect(recoverFoundationGeometry(p,branchPad,directSource,{'spec:revision:21':branchLines['spec:revision:21'].map(l => l.sub === 862 ? {...l,x1:l.x1+5,x2:l.x2+5}:l)}).elements[1].shape?.type).toBe('locator');
  const branchStep = {...directSource,'spec:revision:21':[...directSource['spec:revision:21'],text('S.F.',branchStart+2,100)]};
  expect(recoverFoundationGeometry(p,branchPad,branchStep,branchLines).elements[1].shape?.type).toBe('locator');

  const embeddedPad = {
    ...located, id: 'embedded-pad', measurementId: 'embedded-pad',
    shape: { type: 'locator' as const, at: [160 * scale, 100 * scale] as [number, number], z: -1.2 },
  };
  const embeddedModel = { ...span, elements: [...span.elements, embeddedPad] };
  const embeddedOutline = outline.map(l => ({ ...l, x1: l.x1 + 60, x2: l.x2 + 60, sub: l.sub + 950 }));
  const embeddedLines = { 'spec:revision:21': [...sl['spec:revision:21'], ...embeddedOutline] };
  const embeddedOut = recoverFoundationGeometry(sp, embeddedModel, source, embeddedLines);
  expect(embeddedOut.elements[3].shape).toMatchObject({ type: 'point', z: -1.8, size: [1.5, 1.5, .3] });
  expect(embeddedOut.elements[3].issues.join(' ')).toContain('closed pad junction on source-resolved strip (top continuity inferred)');
  expect(embeddedOut.elements.map(e => e.quantity)).toEqual(embeddedModel.elements.map(e => e.quantity));
  expect(recoverFoundationGeometry(sp, embeddedOut, source, embeddedLines)).toEqual(embeddedOut);
  const junctionStep = { ...source, 'spec:revision:21': [...source['spec:revision:21'], text('S.F.', 160, 100)] };
  expect(recoverFoundationGeometry(sp, embeddedOut, junctionStep, embeddedLines).elements[3].shape?.type).toBe('locator');
  const disconnected = { 'spec:revision:21': [...lines['spec:revision:21'], boundaries[0], { ...boundaries[1], x2: 124 }, { ...boundaries[1], x1: lo + 60 }, ...embeddedOutline] };
  expect(recoverFoundationGeometry(sp, embeddedOut, source, disconnected).elements[3].shape?.type).toBe('locator');
  expect(recoverFoundationGeometry(sp, embeddedOut, source, sl).elements[3].shape?.type).toBe('locator');
  const noSeedDatum = { ...source, 'spec:revision:21': source['spec:revision:21'].filter(t => !/^T\/O FTG:/.test(t.str)) };
  expect(recoverFoundationGeometry(sp, embeddedOut, noSeedDatum, embeddedLines).elements[3].shape?.type).toBe('locator');

  const cutSource = {
    ...source,
    'spec:revision:19': [...source['spec:revision:19'], text('BASE PLATE SCHEDULE', 650, 200), text('MARK', 530, 220), text('ANCHORS', 700, 220), text('BP3', 530, 250), text('(4) - 16Ø SIMPSON TITEN HD', 700, 250), text('(MIN. 150 EMBEDMENT)', 700, 260), text('BP4', 530, 280)],
    'spec:revision:21': [...source['spec:revision:21'], text('7', 100, 50), text('S1.1', 100, 63), text('F1', 127, 72), text('BP3', 133, 80)],
    'spec:revision:22': [
      text('SECTION - TYPICAL INTERIOR PAD FOOTING', 500, 500),
      text('7', 350, 500), text('S1.1', 350, 514),
      text('B', 500, 100), text('ALTERNATE DETAIL', 350, 100),
      text('DROP T/O FOOTING 250', 600, 250), text('AND POUR SLAB OVER', 600, 260),
      text('FIN. GROUND FLOOR', 700, 300), text('0', 740, 310),
      text('MIN. 75mm CONCRETE', 600, 350), text('COVER TO ALL STEEL', 600, 360),
    ],
  };
  const cutStroke = { x1: 100, y1: 75, x2: 100, y2: 130, width: .6, filled: false, sub: 900 };
  const cutLines = { 'spec:revision:21': [...outline, cutStroke] };
  const cutModel = recoverFoundationGeometry(p, bandModel, cutSource, cutLines);
  expect(cutModel.elements[1].shape).toMatchObject({ type: 'point', z: -.55, size: [1.5, 1.5, .3] });
  expect(cutModel.elements[1].issues.join(' ')).toContain('ALTERNATE DETAIL');
  expect(cutModel.elements[1].sources.some(s => s.page === 22 && s.quote?.includes('7/S1.1'))).toBe(true);
  expect(cutModel.elements.map(e => e.quantity)).toEqual(bandModel.elements.map(e => e.quantity));
  expect(recoverFoundationGeometry(p, cutModel, cutSource, cutLines)).toEqual(cutModel);
  for (const missing of ['7', 'S1.1', 'BP3', 'F1']) {
    const without = { ...cutSource, 'spec:revision:21': cutSource['spec:revision:21'].filter(t => t.str !== missing) };
    expect(recoverFoundationGeometry(p, cutModel, without, cutLines).elements[1].shape?.type).toBe('locator');
  }
  for (const missing of ['DROP T/O FOOTING 250', 'FIN. GROUND FLOOR', '0', 'B', 'MIN. 75mm CONCRETE', 'COVER TO ALL STEEL']) {
    const without = { ...cutSource, 'spec:revision:22': cutSource['spec:revision:22'].filter(t => t.str !== missing) };
    expect(recoverFoundationGeometry(p, cutModel, without, cutLines).elements[1].shape?.type).toBe('locator');
  }
  expect(recoverFoundationGeometry(p, cutModel, cutSource, { 'spec:revision:21': outline }).elements[1].shape?.type).toBe('locator');
  expect(recoverFoundationGeometry(p, cutModel, cutSource, { 'spec:revision:21': [cutStroke] }).elements[1].shape?.type).toBe('locator');
  expect(cutModel.elements[1].sources.some(s => s.quote?.includes('75 mm + scheduled minimum embedment 150 mm = 225 mm'))).toBe(true);
  for (const replacement of ['', '(MIN. 250 EMBEDMENT)']) {
    const incompatible = { ...cutSource, 'spec:revision:19': cutSource['spec:revision:19'].map(t => t.str === '(MIN. 150 EMBEDMENT)' ? { ...t, str: replacement } : t) };
    expect(recoverFoundationGeometry(p, cutModel, incompatible, cutLines).elements[1].shape?.type).toBe('locator');
  }
  const excessCover = { ...cutSource, 'spec:revision:22': cutSource['spec:revision:22'].map(t => t.str === 'MIN. 75mm CONCRETE' ? { ...t, str: 'MIN. 200mm CONCRETE' } : t) };
  expect(recoverFoundationGeometry(p, cutModel, excessCover, cutLines).elements[1].shape?.type).toBe('locator');
  const adjacentPad = { ...located, id: 'adjacent-pad', measurementId: 'adjacent-pad', shape: { type: 'locator' as const, at: [200 * scale, 100 * scale] as [number, number], z: -1.2 } };
  const adjacentOut = recoverFoundationGeometry(p, { ...bandModel, elements: [...bandModel.elements, adjacentPad] }, cutSource, { 'spec:revision:21': [...outline, ...outline.map(l => ({ ...l, x1: l.x1 + 100, x2: l.x2 + 100 })), cutStroke] });
  expect(adjacentOut.elements[1].shape?.type).toBe('point');
  expect(adjacentOut.elements[2].shape?.type).toBe('locator');

  p.specs![0].book!.changes!.push({page:3,text:'Question about foundation coordination',label:'Q',y:0,sections:[],sheets:[],action:'clarified'});
  const polluted={...directModel,elements:directModel.elements.map(e=>({...e,sources:[...e.sources,{kind:'spec' as const,id:'revision',page:3,label:'Addendum5',quote:'Newer foundation drawing contains explicit local footing elevations; supersedes generic original-sheet datum.'},{kind:'spec' as const,id:'revision',page:31,label:'Revised foundation detail (stale)',quote:'T/O FOOTING -1200 mm; FIN. GROUND FLOOR 0'}]}))};
  const clean=recoverFoundationGeometry(sp,polluted,directSource,directLines);
  expect([...new Set(clean.elements[1].sources.filter(s=>s.kind==='spec').map(s=>s.page))].sort((a,b)=>a-b)).toEqual([19,21]);
  expect(clean.elements[1].sources.some(s=>s.quote?.startsWith('Foundation revision notice:'))).toBe(false);
  expect(clean.elements[0].sources.filter(s=>s.kind==='spec').map(s=>s.page)).toEqual([21]);
  expect(clean.elements[0].sources[0].quote).toContain('still requires its own footprint and datum association');
  expect(recoverFoundationGeometry(sp,clean,directSource,directLines)).toEqual(clean);

});

it('accounts for every large pad-perimeter gap using actual scheduled strip returns', () => {
  const segment = (x1: number, y1: number, x2: number, y2: number, sub: number) => ({ x1, y1, x2, y2, width: .6, filled: false, color: '#000000', sub });
  const exposed = [segment(0,0,0,20,1),segment(0,80,0,100,2),segment(100,0,100,20,3),segment(100,80,100,100,4),segment(0,0,20,0,5),segment(80,0,100,0,6),segment(0,100,100,100,7)];
  const returns = [segment(-20,20,0,20,8),segment(-20,80,0,80,9),segment(100,20,120,20,10),segment(100,80,120,80,11),segment(20,-20,20,0,12),segment(80,-20,80,0,13)];
  const plan = { docId: 'revision', page: 21, key: 'spec:revision:21', sheetId: 'plan', frame: { a: .01, b: 0, tx: 0, ty: 0, residual: 0 }, texts: [], lines: [...exposed, ...returns, segment(-20,20,-20,80,14),segment(120,20,120,80,15),segment(20,-20,80,-20,16)] };
  const strips = [{ width: .6, depth: .3, source: { kind: 'spec' as const, id: 'revision', page: 19, label: 'Strip schedule' } }];
  const result = padJunctionPerimeter(plan, [0,0,100,100], .3, strips);
  expect(result?.openings).toHaveLength(3);
  expect(padJunctionPerimeter({...plan,lines:[...exposed,...returns]},[0,0,100,100],.3,strips)).toBeNull();
  expect(padJunctionPerimeter({...plan,lines:[...plan.lines,segment(-23,17,-17,23,17)]},[0,0,100,100],.3,strips)).toBeNull();
  const arrow = [segment(-20,20,-15,18,18),segment(-15,18,-15,22,18),segment(-15,22,-20,20,18)].map(l=>({...l,filled:true}));
  expect(padJunctionPerimeter({...plan,lines:[...plan.lines,...arrow]},[0,0,100,100],.3,strips)).toBeNull();

  expect(result?.coverage).toEqual([1,1,1,1]);
  // A real corner has unequal inner/outer reaches, separated by strip width.
  const bend = plan.lines.filter(l => ![8,9,14].includes(l.sub)).concat([
    segment(-100,20,0,20,20),segment(-40,80,0,80,21),
    segment(-100,20,-100,180,22),segment(-40,80,-40,180,23),
  ]);
  expect(padJunctionPerimeter({...plan,lines:bend},[0,0,100,100],.3,strips)?.openings).toHaveLength(3);
  expect(padJunctionPerimeter({...plan,lines:bend.filter(l=>l.sub!==23)},[0,0,100,100],.3,strips)).toBeNull();

  expect(padJunctionPerimeter({ ...plan, lines: plan.lines.filter(l => l.sub !== 8) }, [0,0,100,100], .3, strips)).toBeNull();
  expect(padJunctionPerimeter({ ...plan, lines: plan.lines.map(l => l.sub === 8 ? { ...l, width: 1.32 } : l) }, [0,0,100,100], .3, strips)).toBeNull();
  expect(padJunctionPerimeter({ ...plan, lines: plan.lines.map(l => l.sub === 9 ? { ...l, y1: 75, y2: 75 } : l) }, [0,0,100,100], .3, strips)).toBeNull();
  expect(padJunctionPerimeter(plan, [0,0,100,100], .3, [])).toBeNull();
});

 it('does not borrow footing boundary weights from remote collinear strokes', () => {
  const line = (x1: number,y1: number,x2: number,y2: number,width=.6) => ({x1,y1,x2,y2,width,filled:false});
  const plan = {docId:'revision',page:21,key:'spec:revision:21',sheetId:'plan',frame:{a:.01,b:0,tx:0,ty:0,residual:0},texts:[],lines:[
    line(0,0,0,20),line(0,80,0,100),line(100,0,100,100),line(0,0,100,0),line(0,100,100,100),
    line(0,200,0,300,1.32),line(-20,20,0,20,1.32),line(-20,80,0,80,1.32),
  ]};
  expect(padJunctionPerimeter(plan,[0,0,100,100],.3,[{width:.6,depth:.3,source:{kind:'spec',id:'revision',page:19,label:'Strip schedule'}}])).toBeNull();
});


it('requires two independent agreeing leaders and a closed shoulder for mass-to-pad TOP continuity', () => {
  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    sub: number,
    filled = false,
  ) => ({
    x1,
    y1,
    x2,
    y2,
    sub,
    width: filled ? 0 : 0.6,
    filled,
    color: filled ? '#c0c0c0' : '#000000',
  });
  const shoulder = [
    line(0, 70, 150, 70, 1, true),
    line(150, 70, 150, 100, 1, true),
    line(150, 100, 0, 100, 1, true),
    line(0, 100, 0, 70, 1, true),
  ];
  const edges = [
    line(0, 70, 0, 100, 2),
    line(150, 70, 150, 100, 3),
    line(60, -30, 60, 70, 4),
    line(150, -30, 150, 70, 5),
    line(60, 200, 60, 240, 6),
    line(150, 200, 150, 240, 7),
  ];
  const plan = {
    docId: 'revision',
    page: 21,
    key: 'spec:revision:21',
    sheetId: 'plan',
    frame: { a: 0.01, b: 0, tx: 0, ty: 0, residual: 0 },
    texts: [],
    lines: [...shoulder, ...edges],
  };
  const source = {
    kind: 'spec' as const,
    id: 'revision',
    page: 21,
    label: 'Direct local leader',
  };
  const stripLeader = {
    tip: [150, 70] as [number, number],
    top: -0.25,
    bottom: -0.55,
    source: { ...source, quote: 'Independent strip top/bottom' },
  };
  const massLeader = {
    tip: [300, 150] as [number, number],
    top: -0.25,
    bottom: -0.65,
    source: { ...source, quote: 'Independent mass top/bottom' },
  };
  const leaders = [stripLeader, massLeader];
  const mass = {
    ...pad,
    typeName: 'MF2',
    shape: {
      type: 'point',
      at: [1.5, 1.5],
      z: -0.65,
      size: [3, 1, 0.4],
      rotation: 0,
    },
    issues: ['Foundation revision applied: direct local top/underside leader'],
    sources: [source],
  } as BuildElement;
  const current = { ...model, elements: [mass] };
  const strips = [
    { width: 0.9, depth: 0.3, source: { ...source, label: 'SF2 schedule' } },
  ];
  const box = [50, 240, 230, 420];
  const recover = (p = plan, ls = leaders, m = current) =>
    padMassTopDatum(p, box, 0.3, ls, strips, m);
  expect(recover()?.top).toBe(-0.25);
  expect(
    recover()
      ?.sources.map((s) => s.quote)
      .join(' '),
  ).toContain('shoulder volume and depth remain unmodelled');
  expect(recover()?.sources).toContainEqual(stripLeader.source);
  expect(recover()?.sources).toContainEqual(massLeader.source);
  expect(recover(plan, [stripLeader])).toBeNull();
  expect(recover(plan, [massLeader])).toBeNull();
  expect(
    recover(plan, [{ ...stripLeader, top: -0.3, bottom: -0.6 }, massLeader]),
  ).toBeNull();
  expect(
    recover({ ...plan, lines: plan.lines.filter((l) => l.sub !== 1) }),
  ).toBeNull();
  expect(
    recover({ ...plan, lines: plan.lines.filter((l) => l.sub !== 2) }),
  ).toBeNull();
  expect(
    recover({ ...plan, lines: plan.lines.filter((l) => l.sub !== 4) }),
  ).toBeNull();
  expect(
    recover({
      ...plan,
      lines: plan.lines.map((l) =>
        l.sub === 1 ? { ...l, y1: l.y1 - 5, y2: l.y2 - 5 } : l,
      ),
    }),
  ).toBeNull();
  expect(
    recover({ ...plan, lines: [...plan.lines, line(60, 220, 150, 220, 8)] }),
  ).toBeNull();
  for (const [cx, cy] of [
    [100, 0],
    [100, 85],
    [200, 150],
    [100, 220],
  ]) {
    expect(
      recover({ ...plan, texts: [{ str: 'STEP', cx, cy }] } as typeof plan),
    ).toBeNull();
  }
  expect(
    recover(plan, leaders, {
      ...current,
      elements: [
        {
          ...mass,
          shape: { ...mass.shape!, z: -0.7 } as BuildElement['shape'],
        },
      ],
    }),
  ).toBeNull();
});

it('recognizes split and full step strokes without borrowing wall pens or outside ticks', () => {
  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width = 0.6,
  ) => ({ x1, y1, x2, y2, width, filled: false, color: '#000000' });
  const edges = [line(0, 0, 0, 100), line(90, 0, 90, 100)];
  const split = [line(0, 50, 22, 50), line(68, 50, 90, 50)];
  const plan = {
    docId: 'revision',
    page: 21,
    key: 'spec:revision:21',
    sheetId: 'plan',
    frame: { a: 0.01, b: 0, tx: 0, ty: 0, residual: 0 },
    texts: [],
    lines: [...edges, ...split],
  };
  const check = (lines = plan.lines) =>
    hasFootingCrossbar({ ...plan, lines }, 1, 0, 90, 0, 100);
  expect(check()).toBe(true);
  expect(check([...edges, line(0, 50, 90, 50)])).toBe(true);
  expect(check([...edges, split[0]])).toBe(false);
  expect(check([...edges, ...split.map((l) => ({ ...l, width: 1.32 }))])).toBe(
    false,
  );
  expect(check([{ ...edges[0], width: 1.32 }, edges[1], ...split])).toBe(false);
  expect(check([...edges, line(-22, 50, 0, 50), line(90, 50, 112, 50)])).toBe(
    false,
  );
  expect(check([...edges, line(-3, 47, 3, 53), line(87, 47, 93, 53)])).toBe(
    false,
  );
  const rotated = plan.lines.map((l) => ({
    ...l,
    x1: l.y1,
    y1: l.x1,
    x2: l.y2,
    y2: l.x2,
  }));
  expect(
    hasFootingCrossbar({ ...plan, lines: rotated }, 0, 0, 90, 0, 100),
  ).toBe(true);
});
it.each([0.5,1,3])('reads explicit above-label footing datums at scale %s without guessing local pad geometry', scale=>{
 const labels=[{str:'GROUND FLOOR',cx:200,cy:200,w:100,h:10},{str:'0',cx:230,cy:184,w:6,h:8},
 {str:'T/O FOOTING',cx:210,cy:300,w:80,h:10},{str:'-1400',cx:230,cy:284,w:25,h:8}]
 .map(t=>({...t,cx:t.cx*scale,cy:t.cy*scale,w:t.w*scale,h:t.h*scale}));
 const datum=footingTopDatum(project,{section:labels});
 expect(datum?.z).toBe(-1.4);
 expect(datum?.sources[0].quote).toContain('GROUND FLOOR 0');
 expect(datum?.sources[0].box?.[1]).toBeLessThan(284*scale);
 expect(footingTopDatum(project,{section:labels.filter(t=>t.str!=='0')})).toBeNull();
 expect(footingTopDatum(project,{section:[...labels,{...labels[3],str:'-1600',cx:220*scale}]})).toBeNull();
});
it('does not fall back to a number below an ambiguous above-label footing datum',()=>{
 const ts=[text('FIN. GROUND FLOOR',200,100),text('0',200,108),
 {...text('T/O FOOTING',200,300),w:100,h:10},
 text('-1400',200,284),text('-1600',210,284),text('-1200',200,308)];
 expect(footingTopDatum(project,{section:ts})).toBeNull();
});
it('keeps scheduled pad dimensions and datum reviewable without promoting an unverified footprint',()=>{
 const out=recoverFoundationGeometry(project,model,texts).elements.find(e=>e.id==='pad')!;
 expect(out.shape?.type).toBe('locator');
 expect(out.quantity).toBe(pad.quantity);
 expect(out.sources.map(s=>s.id)).toEqual(expect.arrayContaining(['schedule','section']));
 expect(out.issues.some(s=>s.includes('actual footprint remain unverified'))).toBe(true);
});
