import { describe, expect, it } from 'vitest';
import { buildAll, replan } from '../src/build/run';
import { applySetupEdits } from '../src/build/plan';
import { gridAxes, registerSheets, levelDatums } from '../src/build/building';
import { runSolids } from '../src/build/solids';
import { sourceHashOf } from '../src/build/extract';
import { readSpecFacts } from '../src/build/facts';
import { toIfc } from '../src/build/ifc';
import type { Project } from '../src/model';
import type { SpecSection } from '../src/spec/parse';

const make = (): Project =>
  ({
    version: 1,
    id: 'building-test',
    name: 'New lodge',
    units: 'metric',
    docs: [{ id: 'd', name: 'Architectural.pdf' }],
    sheets: ['Ground', 'Second'].map((n, i) => ({
      id: `s${i}`,
      name: `A${i}`,
      docId: 'd',
      page: i + 1,
      title: `${n} floor plan`,
      width: 1000,
      height: 1000,
      metersPerPoint: 0.1,
      scaleLabel: '1:100',
      scaleSource: null,
      scaleHints: [],
    })),
    types: [
      {
        id: 'ew',
        name: 'EW1',
        kind: 'linear',
        height: 3,
        thickness: 0.25,
        color: '#aaa',
        items: [],
      },
      {
        id: 'door',
        name: 'Door',
        kind: 'count',
        height: 2.1,
        color: '#bbb',
        items: [],
        division: '08 Openings',
      },
    ],
    measurements: [
      ...['s0', 's1'].map((sheetId, i) => ({
        id: `wall${i}`,
        sheetId,
        typeId: 'ew',
        points: [
          [100, 100],
          [300, 100],
          [300, 500],
          [100, 500],
          [100, 100],
        ],
        holes: [],
      })),
      {
        id: 'door0',
        sheetId: 's0',
        typeId: 'door',
        points: [[200, 100]],
        holes: [],
      },
    ],
  }) as unknown as Project;
const input = () => ({
  project: make(),
  sections: [],
  facts: [],
  today: '2026-11-02',
});
const labels = (dx = 0, dy = 0) => [
  ...['A', 'B'].flatMap((str, i) => [
    { str, cx: 100 + i * 200 + dx, cy: 50 + dy },
    { str, cx: 100 + i * 200 + dx, cy: 950 + dy },
  ]),
  ...['1', '2'].flatMap((str, i) => [
    { str, cx: 50 + dx, cy: 100 + i * 400 + dy },
    { str, cx: 800 + dx, cy: 100 + i * 400 + dy },
  ]),
];

describe('building and full-scope rework', () => {
  it('registers both grid axes across displaced sheets; rejects inconsistent scale', () => {
    const p = make(),
      texts = { s0: labels(), s1: labels(30, 70) };
    expect(Object.keys(gridAxes(texts.s0, 1000, 1000))).toHaveLength(4);
    const r = registerSheets(p, texts);
    expect(r.s1.x - r.s0.x).toBeCloseTo(3);
    expect(r.s1.y - r.s0.y).toBeCloseTo(7);
    p.sheets[1].metersPerPoint = 0.2;
    expect(registerSheets(p, texts).s1).toBeUndefined();
  });
  it('uses matching section datums and rejects conflicting elevations', () => {
    const p = make();
    p.sheets.push({
      ...p.sheets[0],
      id: 'section',
      title: 'Building sections',
    });
    const texts = {
      section: [
        { str: 'FIN. SECOND FLOOR', cx: 200, cy: 100 },
        { str: '4000', cx: 130, cy: 100 },
      ],
    };
    expect(levelDatums(p, texts).L2).toBe(4);
    const b = buildAll({ ...input(), project: p, drawingTexts: texts });
    expect(b.model.levels.find((l) => l.id === 'L2')!.elevation).toBe(4);
    texts.section.push({ str: 'FIN. SECOND FLOOR', cx: 200, cy: 300 }, { str: '4500', cx: 130, cy: 300 });
    expect(levelDatums(p, texts).L2).toBeUndefined();
  });
  it('adds shell context and full scope without changing or duplicating a measurement', () => {
    const i = input(),
      before = JSON.stringify(i.project),
      b = buildAll(i);
    expect(JSON.stringify(i.project)).toBe(before);
    expect(
      b.model.elements
        .filter((e) => e.origin === 'takeoff')
        .map((e) => e.measurementId)
        .sort(),
    ).toEqual(i.project.measurements.map((m) => m.id).sort());
    expect(b.model.floorAreas).toEqual({ L1: 800, L2: 800 });
    expect(b.model.elements.some((e) => e.origin === 'building' && e.typeName.includes('slab'))).toBe(true);
    const ids = b.schedule.activities.map((a) => a.id);
    for (const id of [
      'scope:excavation',
      'scope:foundations',
      'scope:underground',
      'scope:roof',
      'scope:envelope',
      'ms:weather-tight',
      'work:structure:L2',
      'work:mech-rough:L1',
      'scope:inspection:L1',
      'cx:mech',
      'closeout',
      'longlead:switchgear',
    ])
      expect(ids).toContain(id);
    expect(b.schedule.issues.some((i) => i.id === 'loop')).toBe(false);
    const ifc = toIfc({ ...b, project: i.project, sections: [] });
    expect(ifc).toContain('Qto_BuildingAllowance');
  });
  it('cuts hosted door voids identically for the scene and IFC, without removing wall takeoff', () => {
    const b = buildAll(input()),
      wall = b.model.elements.find((e) => e.id === 'wall0')!;
    if (wall.shape?.type !== 'run') throw Error('wall missing');
    expect(wall.shape.openings?.[0].elementId).toBe('door0');
    const volume = runSolids(wall.shape).reduce((n, p) => n + p.length * p.height * p.thickness, 0);
    const gross = 120 * 3.6 * 0.25;
    expect(volume).toBeCloseTo(gross - 0.95 * 2.1 * 0.25);
    expect(wall.quantity).toBe(120);
  });
  it('moves targets by changing resources, retains fixed lead times, and relaxes back to baseline', {timeout:15000}, () => {
    const i = input(),
      b = buildAll(i),
      setup = applySetupEdits(b.setup, { setup: { target: '2027-07-01' } });
    const fast = replan(b.model, setup, i).schedule;
    expect(fast.feasibility.changes!.length).toBeGreaterThan(0);
    expect(fast.feasibility.earliestFinish < b.schedule.feasibility.earliestFinish).toBe(true);
    expect(fast.activities.find((a) => a.id === 'longlead:switchgear')!.duration).toBe(
      b.schedule.activities.find((a) => a.id === 'longlead:switchgear')!.duration,
    );
    const relaxed = replan(b.model, applySetupEdits(b.setup, { setup: { target: '2030-01-01' } }), i).schedule;
    expect(relaxed.activities.map((a) => [a.id, a.crews, a.duration, a.deps])).toEqual(
      b.schedule.activities.map((a) => [a.id, a.crews, a.duration, a.deps]),
    );
    const edited = replan(b.model, setup, {
      ...i,
      edits: { activities: { 'work:mech-rough:L1': { duration: 100 } } },
    }).schedule;
    expect(edited.activities.find((a) => a.id === 'work:mech-rough:L1')!.duration).toBe(100);
  });
  it('keeps services above their storey and new finishes on existing substrates new', () => {
    const i=input();
    i.project.types.push({id:'duct',name:'Duct',kind:'linear',height:0,color:'#aaa',items:[],division:'20 Mechanical'}, {id:'new-ceiling',name:'c3 – New Gypsum Board on Existing Structure',kind:'area',height:0,color:'#aaa',items:[],division:'09 Finishes'});
    i.project.measurements.push({id:'duct1',typeId:'duct',sheetId:'s1',points:[[110,110],[200,110]],holes:[]}, {id:'ceiling1',typeId:'new-ceiling',sheetId:'s1',points:[[110,110],[200,110],[200,200],[110,200]],holes:[],ceilingHeight:2.7});
    const b=buildAll(i), duct=b.model.elements.find(e=>e.id==='duct1')!, ceiling=b.model.elements.find(e=>e.id==='ceiling1')!;
    expect(duct.shape?.type==='run'&&duct.shape.z0).toBeCloseTo(6.55);
    expect(ceiling.status).toBe('new');
    expect(ceiling.shape?.type==='surface'&&ceiling.shape.z).toBeCloseTo(6.3);
  });
  it('does not alias basement levels from unrelated title-block notes',()=>{
    const i=input(); i.project.sheets[0].title='Basement Floor Plan';
    i.project.sheets.push({...i.project.sheets[1],id:'notes',title:'Notes plan'});
    const b=buildAll({...i,drawingTexts:{notes:[]},levelHints:{notes:'THIRD FLOOR lower finish notes'}});
    expect(b.model.elements.find(e=>e.id==='wall0')!.level).toBe('L0');
  });
  it('invalidates cache for an interior vertex or ceiling-height edit', () => {
    const i = { ...input(), floorToFloor: 3.6 };
    const a = sourceHashOf(i);
    i.project.measurements[0].points[1][0] += 1;
    expect(sourceHashOf(i)).not.toBe(a);
    const b = sourceHashOf(i);
    i.project.measurements[0].ceilingHeight = 2.8;
    expect(sourceHashOf(i)).not.toBe(b);
  });
  it('reads date-first Division 01 milestones including start and closeout period', async () => {
    const sec = {
      key: '013020',
      number: '013020',
      title: 'Construction Schedules',
      docId: 'spec',
      pages: [44],
    } as SpecSection;
    const facts = await readSpecFacts(
      [sec],
      async () =>
        'By Monday, February 24, 2025, mobilization to the site, and start of the Work. By Monday, July 28, 2025, achievement of Occupancy for phase 1. By Friday, October 31, 2025, Substantial Performance of the Work. Achieve Completion of the Contract within 30 (thirty) days of Substantial Completion.',
    );
    expect(facts.map((f) => [f.key, f.value])).toEqual(
      expect.arrayContaining([
        ['startDate', '2025-02-24'],
        ['phaseDate', '2025-07-28'],
        ['substantialDate', '2025-10-31'],
        ['closeoutDays', 30],
      ]),
    );
  });
});
