import { describe, expect, it } from 'vitest';
import { Calendar, schedule } from '../src/build/cpm';
import { applySetupEdits, defaultSetup, planActivities } from '../src/build/plan';
import { extractModel, levelWords, tradeOf } from '../src/build/extract';
import { readSpecFacts } from '../src/build/facts';
import { toIfc } from '../src/build/ifc';
import { ifcClassLabel, ifcGuid } from '../src/build/ifcClass';
import { geometryOf } from '../src/build/sceneGeometry';
import { nearestGridIntersection } from '../src/build/gridCounts';
import { registerViewportMeasurements, viewportLevels } from '../src/build/viewports';
import { replan } from '../src/build/run';
import type { Project, TakeoffType } from '../src/model';
import type { SpecSection } from '../src/spec/parse';

const type = (id: string, name: string, kind: TakeoffType['kind'], division: string): TakeoffType => ({ id, name, color: '#000', kind, height: 10, items: [], division });
const sheet = (id: string, name: string, title: string, page: number) => ({ id, docId: 'd', page, name, title, width: 3000, height: 2000, metersPerPoint: 0.0339, scaleLabel: '1/8"', scaleSource: null, scaleHints: [] });

function project(): Project {
  const m = (id: string, sheetId: string, typeId: string, points: [number, number][]) => ({ id, sheetId, typeId, points, holes: [] });
  const wall = (i: number, s: string) => m(`w${s}${i}`, s, 'P1', [[100 + i * 40, 100], [100 + i * 40, 700]]);
  return {
    version: 1,
    id: 'p',
    name: 'Test',
    units: 'imperial',
    docs: [{ id: 'd', name: 'A.pdf' }],
    sheets: [sheet('s1', 'A1.1', 'LEVEL 1 FLOOR PLAN', 1), sheet('s2', 'A1.2', 'LEVEL 2 FLOOR PLAN', 2), sheet('s3', 'A1.3', 'LEVEL 1 ENLARGED PLAN', 3)],
    types: [type('P1', 'P1 – 3 5/8" stud partition, GB each side', 'linear', '09 Finishes'), type('D1', 'Door type A', 'count', '08 Openings')],
    measurements: [
      ...Array.from({ length: 20 }, (_, i) => wall(i, 's1')),
      ...Array.from({ length: 10 }, (_, i) => wall(i, 's2')),
      ...Array.from({ length: 12 }, (_, i) => m(`d${i}`, 's1', 'D1', [[200 + i * 20, 400]])),
      m('x', 's3', 'D1', [[10, 10]]),
    ],
  } as unknown as Project;
}
const sections = [
  { key: '08100', number: '08100', title: 'HOLLOW METAL DOORS AND FRAMES', division: '08', docId: 'spec', pages: [40], parts: [], articles: [{ number: '1.3', title: 'SHOP DRAWINGS', page: 40, y: 0 }], sections: [], sheets: [], schedules: [], words: [] },
  { key: '09250', number: '09250', title: 'Gypsum Board', division: '09', docId: 'spec', pages: [], parts: [], articles: [], sections: [], sheets: [], schedules: [], words: [], missing: true },
  { key: '01330', number: '01330', title: 'SUBMITTAL PROCEDURES', division: '01', docId: 'spec', pages: [12], parts: [], articles: [], sections: [], sheets: [], schedules: [], words: [] },
] as unknown as SpecSection[];

describe('build it', () => {
  it('retains disputed takeoffs as evidence while excluding them from Frederick work quantities', () => {
    const p = project();
    p.units = 'metric';
    p.sheets = [
      sheet('egress', 'A011', 'OBC Matrix and Information', 1),
      sheet('demo', 'A201', 'Demolition Plan', 2),
      sheet('floor', 'A211', 'Basement Floor Plan', 3),
      sheet('elevation', 'A301', 'Building Elevations', 4),
      sheet('ceiling', 'A503', 'Second Floor Reflected Ceiling Plan', 5),
      sheet('plumbing', 'M104', 'Third Floor Plumbing Plan', 6),
      sheet('roof', 'M305', 'Roof HVAC Plan', 7),
      sheet('existing', 'M203', 'Second Floor Heating Hydronic System Plan', 8),
    ];
    p.types = [
      type('wall', 'Demo: other walls and partitions shown dashed', 'linear', '02 Existing Conditions'),
      type('demo0', 'Demo 0: Floor Types, see A000 series Sheets Roof Types', 'count', '02 Existing Conditions'),
      type('room', 'Rooms', 'area', '09 Finishes'),
      type('window', 'Windows', 'count', '08 Openings'),
      type('open', 'Ceiling – open / none shown (untagged)', 'area', '09 Finishes'),
      type('bad', '0 – See A000 series Sheets', 'area', '09 Finishes'),
      type('equipment', 'Equipment Identification', 'count', '20-25 Mechanical'),
    ];
    const m = (id: string, sheetId: string, typeId: string, source: NonNullable<Project['measurements'][number]['source']>, points: [number, number][]) => ({ id, sheetId, typeId, source, points, holes: [] });
    p.measurements = [
      m('egress-wall', 'egress', 'wall', 'demolition', [[10, 10], [20, 10]]),
      m('real-demo', 'demo', 'wall', 'demolition', [[10, 10], [20, 10]]),
      m('demo-zero', 'demo', 'demo0', 'demolition', [[30, 30]]),
      { ...m('room-area', 'floor', 'room', 'rooms', [[10, 10], [20, 10], [20, 20], [10, 20]]), ceilingHeight: 3 },
      m('plan-window', 'floor', 'window', 'windows', [[40, 40]]),
      m('elevation-window', 'elevation', 'window', 'windows', [[40, 40]]),
      m('open-ceiling', 'ceiling', 'open', 'ceilings', [[10, 10], [20, 10], [20, 20], [10, 20]]),
      m('bad-ceiling', 'ceiling', 'bad', 'ceilings', [[30, 10], [40, 10], [40, 20], [30, 20]]),
      ...[100, 200, 300].flatMap((x, i) => [
        m(`plumbing-${i}`, 'plumbing', 'equipment', 'trades', [[x, 100]]),
        m(`roof-${i}`, 'roof', 'equipment', 'trades', [[x, 100]]),
      ]),
      m('exist-equip', 'existing', 'equipment', 'trades', [[585, 303]]),
    ];
    const drawingTexts = { existing: [
      { str: 'BB-X1', cx: 520, cy: 230 }, { str: 'as exist.', cx: 520, cy: 241 },
    ] };
    const model = extractModel({ project: p, sections: [], drawingTexts, floorToFloor: 3.6 });
    const byId = (id: string) => model.elements.find((e) => e.id === id)!;
    expect(model.elements.filter((e) => e.origin === 'takeoff')).toHaveLength(p.measurements.length);
    expect(byId('room-area')).toMatchObject({ trade: 'other', planningExcluded: 'room-context', shape: null });
    expect(byId('elevation-window')).toMatchObject({ level: null, planningExcluded: 'elevation-window', shape: null });
    expect(byId('exist-equip').status).toBe('existing');
    for (const id of ['egress-wall', 'demo-zero', 'open-ceiling', 'bad-ceiling', 'plumbing-0', 'plumbing-1', 'plumbing-2'])
      expect(byId(id).planningExcluded).toBeTruthy();
    for (const id of ['real-demo', 'plan-window', 'roof-0', 'roof-1', 'roof-2'])
      expect(byId(id).planningExcluded).toBeUndefined();
    expect(byId('plumbing-0').level).toBe('roof');
    const setup = defaultSetup(model, [], '2026-11-02');
    const acts = planActivities(model, setup, [], []);
    const work = acts.filter((a) => a.kind === 'work');
    expect(work.flatMap((a) => a.elements).sort()).toEqual(['plan-window', 'real-demo', 'roof-0', 'roof-1', 'roof-2'].sort());
    expect(work.find((a) => a.id === 'work:mech-trim:roof')?.quantities?.ea).toBe(3);
    const schedule = replan(model, setup, { sections: [], facts: [], today: '2026-11-02' }).schedule;
    expect(schedule.issues.map((i) => i.id)).toEqual(expect.arrayContaining([
      'takeoff-review:egress-demolition', 'takeoff-review:unverified-demo-type',
      'takeoff-review:open-ceiling', 'takeoff-review:unverified-ceiling-type',
    ]));
  });

  it('places structural count markers on registered grid crossings and keeps their tag source', () => {
    expect(nearestGridIntersection({
      '1': { axis: 'x', at: 500 }, '2': { axis: 'x', at: 1000 },
      A: { axis: 'y', at: 500 }, B: { axis: 'y', at: 1000 },
    }, ['1', '2', 'A', 'B'], [520, 525], 0.05)).toMatchObject({ point: [500, 500], labels: ['1', 'A'] });
    expect(nearestGridIntersection({ '1': { axis: 'x', at: 500 }, A: { axis: 'y', at: 500 } }, ['1', 'A'], [600, 600], 0.05)).toBeNull();

    const p = project();
    p.units = 'metric';
    p.sheets = [{ ...sheet('struct', 'S1.0', 'FOUNDATION PLAN', 1), metersPerPoint: 0.05 }];
    p.types = [type('footing', 'F1 – Pad footing 1500 x 1500 x 300', 'count', '03 Concrete')];
    p.measurements = [
      { id: 'near', sheetId: 'struct', typeId: 'footing', source: 'foundations', points: [[520, 525]], holes: [] },
      { id: 'far', sheetId: 'struct', typeId: 'footing', source: 'foundations', points: [[2000, 1500]], holes: [] },
    ];
    const drawingTexts = { struct: [
      { str: 'A', cx: 100, cy: 500 }, { str: 'A', cx: 2500, cy: 500 },
      { str: 'B', cx: 100, cy: 1000 }, { str: 'B', cx: 2500, cy: 1000 },
      { str: '1', cx: 500, cy: 100 }, { str: '1', cx: 500, cy: 1800 },
      { str: '2', cx: 1000, cy: 100 }, { str: '2', cx: 1000, cy: 1800 },
    ] };
    const model = extractModel({ project: p, sections: [], drawingTexts, floorToFloor: 3.6 });
    const near = model.elements.find((e) => e.id === 'near')!;
    const far = model.elements.find((e) => e.id === 'far')!;
    expect(near.shape?.type).toBe('locator');
    expect(near.sources[0].box).toEqual([520, 525, 520, 525]);
    expect(near.issues.some((s) => s.includes('structural grid 1/A'))).toBe(true);
    expect(geometryOf(near)).not.toBeNull();
    expect(far.shape).toBeNull();
    expect(far.issues.some((s) => s.includes('No registered structural grid intersection within 2.5 m'))).toBe(true);
    expect(toIfc({ model, schedule: null, project: p, sections: [] })).toContain("TagPointOnSheet");
  });

  it('keeps the electrical tag source on extracted elements for rough-in planning', () => {
    const p = project();
    p.sheets = [sheet('e1', 'E2-01', 'LEVEL 1 ELECTRICAL PLAN', 1)];
    p.types = [type('light', 'Light fixtures (by circuit tag)', 'count', '26 Electrical')];
    p.measurements = [{ id: 'tag', sheetId: 'e1', typeId: 'light', source: 'etags', points: [[200, 400]], holes: [] }];
    const model = extractModel({ project: p, sections: [], floorToFloor: 3.6 });
    expect(model.elements.find((e) => e.id === 'tag')).toMatchObject({ trade: 'elec-trim', level: 'L1', measurementSource: 'etags' });
    expect(planActivities(model, defaultSetup(model, [], '2026-11-02'), [], []).find((a) => a.id === 'work:elec-rough:L1')?.quantities).toEqual({ ea: 1 });
  });

  it('knows trades and levels', () => {
    expect(tradeOf(type('a', 'P5 – 6" stud partition', 'linear', '09 Finishes'))).toBe('partitions');
    expect(tradeOf(type('a', 'ACT-1 lay-in ceiling', 'area', '09 Finishes'))).toBe('ceilings');
    expect(tradeOf(type('a', 'Remove existing light fixture', 'count', '26 Electrical'))).toBe('demolition');
    expect(tradeOf(type('ew', 'EW1A', 'linear', ''))).toBe('envelope');
    expect(tradeOf(type('ew', 'EW-2', 'linear', ''))).toBe('envelope');
    expect(tradeOf(type('clad', 'Exterior wall cladding', 'linear', '06 Wood'))).toBe('envelope');
    expect(levelWords('LEVEL 2 (MAIN) FLOOR PLAN')).toEqual({ num: 2, word: 'main' });
    expect(levelWords('BELOW GRADE PLAN - DRAINAGE').word).toBe('lower');
    for (const name of ['Beam B2 GLULAM', 'Column C1', 'Lintel L1', 'Brace BR1', 'Post P1', 'Base plate BP1', 'Structural wall WT1'])
      expect(tradeOf(type('s', name, 'count', '06 Wood, Plastics & Composites'))).toBe('structure');
    expect(tradeOf(type('s', 'Joist / truss J1', 'count', '06 Wood'), 'structure')).toBe('structure');
    expect(tradeOf(type('f', 'Excavation', 'area', '31 Earthwork'), 'foundations')).toBe('site');
  });

  it('plans measured EW wall work as envelope after framing without duplicating takeoffs', () => {
    const p = project();
    p.units = 'metric';
    p.sheets = [sheet('framing', 'S2.0', 'LEVEL 1 FRAMING PLAN', 1), sheet('wall', 'A2.1', 'LEVEL 1 FLOOR PLAN', 2)];
    p.types = [type('beam', 'B1 Beam GLULAM', 'count', '06 Wood'), type('ew', 'EW1A', 'linear', '')];
    p.measurements = [
      { id: 'beam', sheetId: 'framing', typeId: 'beam', source: 'structure', points: [[100, 100]], holes: [] },
      { id: 'ew', sheetId: 'wall', typeId: 'ew', source: 'walls', points: [[100, 100], [200, 100]], holes: [] },
    ];
    const model = extractModel({ project: p, sections: [], floorToFloor: 3.6 });
    expect(model.elements.map((e) => e.trade)).toEqual(['structure', 'envelope']);
    const acts = planActivities(model, defaultSetup(model, [], '2026-11-02'), [], []);
    expect(acts.find((a) => a.id === 'work:envelope:L1')).toMatchObject({ elements: ['ew'] });
    expect(acts.find((a) => a.id === 'work:envelope:L1')?.deps.map((d) => d.from)).toContain('work:structure:L1');
    expect(acts.some((a) => a.id === 'work:partitions:L1')).toBe(false);
  });

  it('schedules labelled side-by-side plan measurements on their own levels without false XY geometry', () => {
    const p = project();
    p.units = 'metric';
    p.sheets = [{ ...sheet('mechanical', 'M1-02', '', 1), title: undefined }];
    p.types = [type('pipe', 'Pipe 50 mm SAN', 'linear', '22 Plumbing')];
    p.measurements = [
      ...[400, 500, 1200, 1300].map((x, i) => ({ id: `pipe${i}`, sheetId: 'mechanical', typeId: 'pipe', source: 'pipes' as const, points: [[x, 400], [x + 20, 400]] as [number, number][], holes: [] })),
    ];
    const drawingTexts = { mechanical: [
      { str: 'L1-Plumbing', cx: 300, cy: 1600 },
      { str: 'L2-Plumbing', cx: 1100, cy: 1600 },
    ] };
    expect([...viewportLevels(p.sheets[0], drawingTexts.mechanical, p.measurements).values()].map((v) => v.id)).toEqual(['L1', 'L1', 'L2', 'L2']);
    const crossing = { id: 'cross', sheetId: 'mechanical', typeId: 'pipe', source: 'pipes' as const, points: [[600, 400], [1100, 400]] as [number, number][], holes: [] };
    expect(viewportLevels(p.sheets[0], drawingTexts.mechanical, [...p.measurements, crossing]).has('cross')).toBe(false);
    expect(viewportLevels(p.sheets[0], drawingTexts.mechanical.slice(0, 1), p.measurements).size).toBe(0);
    const model = extractModel({ project: p, sections: [], drawingTexts, floorToFloor: 3.6 });
    expect(model.elements.map((e) => [e.level, e.shape, e.quantity > 0])).toEqual([
      ['L1', null, true], ['L1', null, true], ['L2', null, true], ['L2', null, true],
    ]);
    expect(model.issues.some((i) => i.id === 'unplaced:viewport alignment')).toBe(true);
    const acts = planActivities(model, defaultSetup(model, [], '2026-11-02'), [], []);
    expect(acts.find((a) => a.id === 'work:mech-rough:L2')?.deps.map((d) => d.from)).toContain('work:mech-rough:L1');
  });

  it('registers each labelled viewport to both architectural grid families before drawing services', () => {
    const p = project();
    p.units = 'metric';
    p.sheets = [sheet('arch', 'A2.1', 'GROUND FLOOR PLAN', 1), { ...sheet('mechanical', 'M1-02', '', 2), title: undefined }];
    p.types = [type('pipe', 'Pipe 50 mm SAN', 'linear', '22 Plumbing')];
    p.measurements = [400, 500, 1400, 1500].map((x, i) => ({ id: `pipe${i}`, sheetId: 'mechanical', typeId: 'pipe', source: 'pipes' as const, points: [[x, 600], [x + 20, 600]] as [number, number][], holes: [] }));
    const at = (str: string, cx: number, cy: number) => ({ str, cx, cy });
    const arch = [
      ...['A', 'B', 'C'].flatMap((key, i) => [at(key, 100 + 300 * i, 100), at(key, 100 + 300 * i, 1700)]),
      ...['1', '2', '3'].flatMap((key, i) => [at(key, 100, 300 + 400 * i), at(key, 900, 300 + 400 * i)]),
    ];
    const mechanical = [at('L1-Plumbing', 300, 1600), at('L2-Plumbing', 1300, 1600),
      ...[0, 1000].flatMap((shift) => [
        ...['A', 'B', 'C'].map((key, i) => at(key, 100 + 300 * i + shift, 100)),
        ...['1', '2', '3'].map((key, i) => at(key, 800 + shift, 300 + 400 * i)),
      ])];
    const texts = { arch, mechanical };
    const levels = viewportLevels(p.sheets[1], mechanical, p.measurements);
    expect(levels.size).toBe(4);
    const registered = registerViewportMeasurements(p, texts, levels);
    expect(registered.size).toBe(4);
    expect(registered.get('pipe0')?.grids).toEqual(expect.arrayContaining(['A', 'B', 'C', '1', '2', '3']));
    expect(Math.abs(registered.get('pipe2')!.x - registered.get('pipe0')!.x)).toBeGreaterThan(30);
    const model = extractModel({ project: p, sections: [], drawingTexts: texts, floorToFloor: 3.6 });
    const left = model.elements.find((e) => e.id === 'pipe0')?.shape;
    const right = model.elements.find((e) => e.id === 'pipe2')?.shape;
    expect(left?.type).toBe('run');
    expect(right?.type).toBe('run');
    if (left?.type === 'run' && right?.type === 'run')
      expect(Math.hypot(left.points[0][0] - right.points[0][0], left.points[0][1] - right.points[0][1])).toBeLessThan(0.1);
    expect(model.elements.find((e) => e.id === 'pipe2')?.level).toBe('L2');

    const missingGrid = { ...texts, mechanical: mechanical.filter((t) => !(t.str === 'C' && t.cx > 1000)) };
    const partial = registerViewportMeasurements(p, missingGrid, levels);
    expect(partial.has('pipe0')).toBe(true);
    expect(partial.has('pipe2')).toBe(false);
  });

  it('shows located beam spans as plan axes without exporting invented solids', () => {
    const p = project();
    p.units = 'metric';
    p.sheets = [sheet('framing', 'S2.0', 'LEVEL 1 FRAMING PLAN', 1)];
    p.types = [type('beam', 'B3 – Beam 265 x 608 GLULAM', 'linear', '06 Wood')];
    p.measurements = [{ id: 'beam-span', sheetId: 'framing', typeId: 'beam', source: 'structure', points: [[100, 100], [200, 100]], holes: [] }];
    const model = extractModel({ project: p, sections: [], floorToFloor: 3.6 });
    const e = model.elements[0];
    expect(e).toMatchObject({ trade: 'structure', level: 'L1', quantity: 3.39, unit: 'm', shape: { type: 'axis' } });
    expect(e.issues.join(' ')).toMatch(/diagrammatic axis/);
    const g = geometryOf(e)!;
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeLessThan(0.06);
    g.dispose();
    expect(ifcClassLabel(e)).toBe('IfcBeam · Beam');
    const ifc = toIfc({ model, schedule: null, project: p, sections: [] });
    expect(ifc).toMatch(/IFCBEAM\([^\n]+,\$,/);
    expect(ifc).toContain("IFCQUANTITYLENGTH('Length'");
  });

  it('plans stated site lengths after mobilization without a building level or route geometry', () => {
    const p = project();
    p.units = 'metric';
    p.sheets = [{ ...sheet('civil', 'C1.0', 'SITE SERVICES PLAN', 1), metersPerPoint: null }, { ...sheet('road', 'C2.0', 'ROAD PLAN AND PROFILE', 2), metersPerPoint: null }];
    p.types = [type('pipe', 'Sanitary sewer', 'linear', '33 Utilities'), {
      ...type('pavement', 'Access road (by chainage)', 'linear', '32 Exterior Improvements'),
      width: 6,
      items: [{ id: 'road-area', name: 'Road area', unit: 'm²', formula: 'L * W' }],
    }];
    p.measurements = [
      { id: 'run', sheetId: 'civil', typeId: 'pipe', source: 'site', points: [[0, 0], [20, 0]], holes: [], statedLength: 900 },
      { id: 'paving', sheetId: 'road', typeId: 'pavement', source: 'site', points: [[0, 0], [20, 0]], holes: [], statedLength: 415 },
    ];
    const model = extractModel({ project: p, sections: [], floorToFloor: 3.6 });
    const el = model.elements[0];
    expect(el).toMatchObject({ trade: 'site', level: null, shape: null, quantity: 900, unit: 'm' });
    expect(model.elements[1]).toMatchObject({ quantity: 415, unit: 'm', production: { quantity: 2490, unit: 'm²' } });
    expect(model.issues.some((i) => i.id === 'unplaced:level unknown')).toBe(false);
    const setup = defaultSetup(model, [], '2026-11-02');
    const work = planActivities(model, setup, [], []).find((a) => a.id === 'work:site:site')!;
    expect(work).toMatchObject({ name: 'Site work', level: null, quantities: { m: 900, 'm²': 2490 }, duration: 38 });
    expect(work.deps.map((d) => d.from)).toEqual(['mobilize']);
  });

  it('uses foundation concrete volume for production and structural counts separately', () => {
    const p = project();
    p.units = 'metric';
    p.sheets = [sheet('fdn', 'S1.0', 'FOUNDATION PLAN', 1), sheet('framing', 'S2.0', 'FRAMING PLAN', 2), sheet('roof', 'S2.1', 'PLAN', 3)];
    p.types = [
      { ...type('pad', 'F1 – Pad footing', 'count', '03 Concrete'), width: 1.5, depth: 1.5, thickness: 0.3, items: [{ id: 'concrete', name: 'Concrete + 5%', unit: 'm³', formula: 'N * W * D * T * 1.05' }] },
      type('beam', 'B2 – Beam GLULAM', 'count', '06 Wood'),
    ];
    p.measurements = [
      { id: 'pad1', sheetId: 'fdn', typeId: 'pad', source: 'foundations', points: [[1, 1]], holes: [] },
      { id: 'beam1', sheetId: 'framing', typeId: 'beam', source: 'structure', points: [[1, 1]], holes: [] },
      { id: 'beam2', sheetId: 'roof', typeId: 'beam', source: 'structure', points: [[1, 1]], holes: [] },
    ];
    const model = extractModel({ project: p, sections: [], levelHints: { framing: 'MAIN FLOOR FRAMING PLAN', roof: 'HIGH ROOF FRAMING PLAN' }, floorToFloor: 3.6 });
    expect(model.elements.map((e) => [e.trade, e.level])).toEqual([['structure', 'fdn'], ['structure', 'L1'], ['structure', 'roof']]);
    expect(model.elements[0].quantity).toBe(1);
    expect(model.elements[0].production).toEqual({ quantity: 0.70875, unit: 'm³' });
    const setup = defaultSetup(model, [], '2026-11-02');
    const acts = planActivities(model, setup, [], []);
    expect(acts.find((a) => a.id === 'work:structure:fdn')?.quantities).toEqual({ 'm³': 0.70875 });
    expect(acts.find((a) => a.id === 'work:structure:L1')?.quantities).toEqual({ ea: 1 });
    expect(setup.trades.structure.value.rates['m³']).toBe(8);
    expect(replan(model, setup, { sections: [], facts: [], today: '2026-11-02' }).schedule.issues.some((i) => i.id === 'structure-production-review')).toBe(true);
    const confirmed = applySetupEdits(setup, { setup: { trades: { structure: { rates: { ea: 4, 'm³': 6 } } } } });
    expect(replan(model, confirmed, { sections: [], facts: [], today: '2026-11-02' }).schedule.issues.some((i) => i.id === 'structure-production-review')).toBe(false);
  });

  it('schedules Div 31 bank excavation after mobilization and before foundation work', () => {
    const p = project();
    p.units = 'metric';
    p.sheets = [{ ...sheet('fdn', 'S1.0', 'FOUNDATION PLAN', 1), metersPerPoint: 0.1 }, { ...sheet('civil', 'C1.0', 'SITE SERVICES PLAN', 2), metersPerPoint: null }];
    p.types = [
      { ...type('dig', 'Excavation and backfill (depth assumed)', 'area', '31 Earthwork'), depth: 1.5, items: [
        { id: 'bank', name: 'Excavation (bank)', unit: 'm³', formula: 'A * D' },
        { id: 'swell', name: 'Excavation + 25% swell', unit: 'm³', formula: 'A * D * 1.25' },
      ] },
      type('pad', 'F1 – Pad footing', 'count', '03 Concrete'),
      type('pipe', 'Sanitary sewer', 'linear', '33 Utilities'),
    ];
    p.measurements = [
      { id: 'dig1', sheetId: 'fdn', typeId: 'dig', source: 'foundations', points: [[0, 0], [296, 0], [296, 300], [0, 300]], holes: [] },
      { id: 'pad1', sheetId: 'fdn', typeId: 'pad', source: 'foundations', points: [[1, 1]], holes: [] },
      { id: 'pipe1', sheetId: 'civil', typeId: 'pipe', source: 'site', points: [[0, 0], [20, 0]], holes: [], statedLength: 900 },
    ];
    const model = extractModel({ project: p, sections: [], floorToFloor: 3.6 });
    expect(model.elements.find((e) => e.id === 'dig1')).toMatchObject({ trade: 'site', level: null, quantity: 888, unit: 'm²', production: { quantity: 1332, unit: 'm³' } });
    const setup = defaultSetup(model, [], '2026-11-02');
    const acts = planActivities(model, setup, [], []);
    const dig = acts.find((a) => a.id === 'work:site:earthwork')!;
    const foundation = acts.find((a) => a.id === 'work:structure:fdn')!;
    expect(dig).toMatchObject({ quantities: { 'm³': 1332 }, rates: { 'm³': 50 }, duration: 27 });
    expect(dig.deps.map((d) => d.from)).toEqual(['mobilize']);
    expect(foundation.deps.map((d) => d.from)).toContain(dig.id);
    expect(foundation.deps.map((d) => d.from)).not.toContain('work:site:site');
    expect(replan(model, setup, { sections: [], facts: [], today: '2026-11-02' }).schedule.issues.some((i) => i.id === 'excavation-production-review')).toBe(true);
    const unmeasured = { ...model, elements: model.elements.map((e) => e.id === 'dig1' ? { ...e, production: undefined } : e) };
    expect(replan(unmeasured, setup, { sections: [], facts: [], today: '2026-11-02' }).schedule.issues.some((i) => i.id === 'excavation-volume-missing')).toBe(true);
  });

  it('reads the review period the specification gives', async () => {
    const facts = await readSpecFacts(sections, async () => 'The Consultant will review and return submittals within ten (10) working days of receipt.');
    expect(facts.find((f) => f.key === 'reviewDays')).toMatchObject({ value: 10, unit: 'working days', source: { label: '01330', page: 12 } });
  });

  it('places what it can, says why it can’t place the rest, and links specs', () => {
    const model = extractModel({ project: project(), sections, floorToFloor: 3.6 });
    expect(model.levels.map((l) => l.id)).toEqual(['L1', 'L2']);
    expect(model.elements.filter((e) => e.shape).length).toBe(42);
    expect(model.elements.find((e) => e.id === 'x')!.issues[0]).toMatch(/enlarged/);
    expect(model.elements.find((e) => e.id === 'd0')!.specs.map((s) => s.key)).toEqual(['08100']);
    expect(model.issues.some((i) => /not issued: 09250/.test(i.text))).toBe(true);
  });

  it('can’t meet an impossible deadline, and says which chain and assumptions are why', async () => {
    const model = extractModel({ project: project(), sections, floorToFloor: 3.6 });
    const facts = await readSpecFacts(sections, async () => 'Consultant will review submittals within 10 working days.');
    const setup = applySetupEdits(defaultSetup(model, facts, '2026-11-02'), { setup: { target: '2026-11-30' } });
    expect(setup.reviewDays).toMatchObject({ value: 10, basis: 'documented' });
    const s = schedule(planActivities(model, setup, sections, facts), setup);
    expect(s.feasibility.overBy).toBeGreaterThan(0);
    expect(s.issues.find((i) => i.id === 'target')!.text).toMatch(/can't meet 2026-11-30/);
    const chain = s.feasibility.chain.map((c) => c.id);
    expect(chain).toContain('sub:review:doors');
    expect(s.feasibility.documentedDays).toBe(10);
    expect(s.feasibility.levers.join(' ')).toMatch(/only the consultant can shorten it/);
    expect(s.times['work:doors:L1'].late).toBe(true);
    // Nothing was squeezed: the doors still take their quantity's time.
    expect(s.activities.find((a) => a.id === 'work:doors:L1')!.duration).toBe(Math.ceil(13 / 6));
  });

  it('recomputes from edits: more crews, a dropped link, a loop reported', () => {
    const model = extractModel({ project: project(), sections, floorToFloor: 3.6 });
    const setup = defaultSetup(model, [], '2026-11-02');
    const base = schedule(planActivities(model, setup, sections, []), setup);
    const edits = { activities: { 'work:partitions:L1': { crews: 3 }, 'proc:doors': { duration: 5 } } };
    const after = schedule(planActivities(model, setup, sections, [], edits), setup);
    expect(after.activities.find((a) => a.id === 'work:partitions:L1')!.duration).toBeLessThan(base.activities.find((a) => a.id === 'work:partitions:L1')!.duration);
    expect(after.feasibility.earliestFinish <= base.feasibility.earliestFinish).toBe(true);
    const loop = schedule(planActivities(model, setup, sections, [], { activities: { mobilize: { addDeps: [{ from: 'ms:finish' }] } } }), setup);
    expect(loop.issues.some((i) => i.id === 'loop')).toBe(true);
  });

  it('counts working days only', () => {
    const c = new Calendar('2026-11-06', [1, 2, 3, 4, 5], ['2026-11-11']);
    expect(c.date(0)).toBe('2026-11-06');
    expect(c.date(1)).toBe('2026-11-09');
    expect(c.date(3)).toBe('2026-11-12');
    expect(c.workingDaysTo('2026-11-12')).toBe(4);
  });

  it('exports IFC 4: storeys, classed elements with quantities and specs, and the schedule as tasks', async () => {
    const model = extractModel({ project: project(), sections, floorToFloor: 3.6 });
    const facts = await readSpecFacts(sections, async () => '');
    const setup = defaultSetup(model, facts, '2026-11-02');
    const sched = schedule(planActivities(model, setup, sections, facts), setup);
    const ifc = toIfc({ model, schedule: sched, project: project(), sections });
    expect(ifc).toMatch(/^ISO-10303-21;/);
    expect(ifc).toMatch(/FILE_SCHEMA\(\('IFC4'\)\)/);
    expect((ifc.match(/IFCBUILDINGSTOREY\(/g) ?? []).length).toBe(2);
    expect((ifc.match(/IFCWALL\(/g) ?? []).length).toBe(30);
    expect((ifc.match(/IFCDOOR\(/g) ?? []).length).toBe(13);
    expect(ifc).toContain('Qto_TakeoffAI');
    expect(ifc).toContain('08100 HOLLOW METAL DOORS AND FRAMES');
    expect(ifc).toMatch(/IFCRELCONTAINEDINSPATIALSTRUCTURE\([^)]*'Not placed'/);
    expect(ifc).toMatch(/IFCWORKSCHEDULE\(/);
    expect(ifc).toMatch(/IFCTASK\(/);
    const wall = model.elements.find((e) => e.id === 'ws10')!;
    expect(ifcClassLabel(wall)).toBe('IfcWall · Standard');
    expect(ifcGuid(wall.id)).toHaveLength(22);
    expect(ifc).toContain(`'${ifcGuid(wall.id)}'`);
  });
});
