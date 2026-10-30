import { describe, expect, it } from 'vitest';
import { Calendar, schedule } from '../src/build/cpm';
import { applySetupEdits, defaultSetup, planActivities } from '../src/build/plan';
import { extractModel, levelWords, tradeOf } from '../src/build/extract';
import { readSpecFacts } from '../src/build/facts';
import { toIfc } from '../src/build/ifc';
import { ifcClassLabel, ifcGuid } from '../src/build/ifcClass';
import { geometryOf } from '../src/build/sceneGeometry';
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
