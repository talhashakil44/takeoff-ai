import { expect, it } from 'vitest';
import {
  footingTopDatum,
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

  p.specs![0].book!.changes!.push({page:3,text:'Question about foundation coordination',label:'Q',y:0,sections:[],sheets:[],action:'clarified'});
  const polluted={...directModel,elements:directModel.elements.map(e=>({...e,sources:[...e.sources,{kind:'spec' as const,id:'revision',page:3,label:'Addendum5',quote:'Newer foundation drawing contains explicit local footing elevations; supersedes generic original-sheet datum.'},{kind:'spec' as const,id:'revision',page:31,label:'Revised foundation detail (stale)',quote:'T/O FOOTING -1200 mm; FIN. GROUND FLOOR 0'}]}))};
  const clean=recoverFoundationGeometry(sp,polluted,directSource,directLines);
  expect([...new Set(clean.elements[1].sources.filter(s=>s.kind==='spec').map(s=>s.page))].sort((a,b)=>a-b)).toEqual([19,21]);
  expect(clean.elements[1].sources.some(s=>s.quote?.startsWith('Foundation revision notice:'))).toBe(false);
  expect(clean.elements[0].sources.filter(s=>s.kind==='spec').map(s=>s.page)).toEqual([21]);
  expect(clean.elements[0].sources[0].quote).toContain('still requires its own footprint and datum association');
  expect(recoverFoundationGeometry(sp,clean,directSource,directLines)).toEqual(clean);

});
