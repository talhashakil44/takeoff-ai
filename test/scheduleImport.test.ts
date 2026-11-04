import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv, parseDate, parseDuration, parseMsProjectXml, parsePredecessors, parseXer, readScheduleFile, tasksFromTable } from '../src/build/scheduleImport';
import { activeUserSchedule, elementTimes, fromGenerated, fromImport, kindOf, levelOfText, newActivity, scheduleCsv, scheduleGroups, scheduleUser, tradeOfText } from '../src/build/userSchedule';
import { defaultSetup } from '../src/build/plan';
import type { Activity, BuildElement, BuildModel, Level } from '../src/build/types';

const sample = (name: string) => readFileSync(new URL(`./schedule-samples/${name}`, import.meta.url));
const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const levels: Level[] = [
  { id: 'fdn', name: 'Foundation', elevation: -1.2, basis: 'inferred', sheets: [] },
  { id: 'L1', name: 'Level 1', elevation: 0, basis: 'documented', sheets: [] },
  { id: 'mezz', name: 'Mezzanine', elevation: 3.6, basis: 'documented', sheets: [] },
  { id: 'roof', name: 'Roof', elevation: 7.2, basis: 'inferred', sheets: [] },
];
const el = (id: string, trade: string, level: string, typeName: string): BuildElement => ({
  id, name: typeName, trade, level, shape: null, quantity: 10, unit: 'm', typeId: id, typeName, division: '', measurementId: id, sheetId: 's', specs: [], sources: [], placement: 'documented', issues: [],
});
const model: BuildModel = {
  version: 1, sourceHash: '', units: 'metric', levels, issues: [], extent: [0, 0, 10, 10],
  elements: [
    el('w1', 'partitions', 'L1', 'W1 steel stud wall'),
    el('w2', 'partitions', 'L1', 'W2 steel stud wall'),
    el('w3', 'partitions', 'mezz', 'W3 stud wall'),
    el('d1', 'doors', 'L1', 'HM door and frame'),
    el('d2', 'doors', 'L1', 'Overhead door'),
    el('f1', 'structure', 'fdn', 'Strip footing F1'),
    el('c1', 'structure', 'L1', 'HSS column'),
    el('r1', 'envelope', 'roof', 'Metal roof deck and membrane'),
    el('e1', 'elec-trim', 'L1', 'Light fixture type A'),
    el('a1', 'ceilings', 'L1', 'ACT ceiling'),
  ],
};
const setup = defaultSetup(model, [], '2026-11-02');

describe('reading schedule files', () => {
  it('reads the dates and durations schedules write', () => {
    expect(parseDate('2026-11-04')).toBe('2026-11-04');
    expect(parseDate('Mon 11/9/26')).toBe('2026-11-09');
    expect(parseDate('9/11/2026', true)).toBe('2026-11-09');
    expect(parseDate('25/12/2026')).toBe('2026-12-25');
    expect(parseDate('04-Nov-26 08:00')).toBe('2026-11-04');
    expect(parseDate('November 4, 2026 8:00 AM')).toBe('2026-11-04');
    expect(parseDate('2027-01-04T08:00:00')).toBe('2027-01-04');
    expect(parseDate('46330')).toBe('2026-11-04');
    expect(parseDate('')).toBeUndefined();
    expect(parseDuration('5 days?')).toBe(5);
    expect(parseDuration('2 wks')).toBe(10);
    expect(parseDuration('16 hrs')).toBe(2);
    expect(parseDuration('7 edays')).toBe(5);
    expect(parseDuration('soon')).toBeUndefined();
  });

  it('reads predecessor lists in MS Project, P6 and this app’s own form', () => {
    const known = new Set(['3', '5', 'A1010', 'work:partitions:L1', 'ms:start']);
    expect(parsePredecessors('3FS+2 days, 5SS', known)).toEqual([
      { key: '3', type: 'FS', lag: 2 },
      { key: '5', type: 'SS', lag: 0 },
    ]);
    expect(parsePredecessors('A1010: FF -1w', known)).toEqual([{ key: 'A1010', type: 'FF', lag: -5 }]);
    expect(parsePredecessors('work:partitions:L1 ms:start', known).map((p) => p.key)).toEqual(['work:partitions:L1', 'ms:start']);
  });

  it('reads CSV with quotes, other separators and header variants', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
    expect(parseCsv('Task;Begin;Days\nFrame;2026-11-02;4')).toEqual([['Task', 'Begin', 'Days'], ['Frame', '2026-11-02', '4']]);
    const r = tasksFromTable(parseCsv('Project: Shop\n\nActivity ID,Activity Description,Start Date,End Date,Floor\nX1,Paint,2026-11-02,2026-11-06,Mezzanine\n'), 'csv');
    expect(r.tasks).toEqual([expect.objectContaining({ code: 'X1', name: 'Paint', start: '2026-11-02', finish: '2026-11-06', level: 'Mezzanine' })]);
  });

  it('reads an MS Project CSV export: summary rows become groups, links and lags kept', () => {
    const r = tasksFromTable(parseCsv(sample('ms-project-export.csv').toString()), 'csv');
    expect(r.tasks.map((t) => t.code)).toEqual(['2', '3', '5', '6', '7', '8', '9']);
    const mob = r.tasks.find((t) => t.code === '3')!;
    expect(mob).toMatchObject({ group: 'Preconstruction', start: '2026-11-16', duration: 2, preds: [{ key: '2', type: 'SS', lag: 5 }] });
    expect(r.tasks.find((t) => t.code === '7')!.preds.map((p) => p.key)).toEqual(['6', '2']);
    expect(r.tasks.find((t) => t.code === '6')).toMatchObject({ duration: 5, trade: 'Sparky Electric', group: 'Level 1' });
    expect(r.warnings.join(' ')).toMatch(/2 summary rows/);
  });

  it('reads MS Project XML: summary tasks as groups, baselines ignored, link types and lags', () => {
    const r = parseMsProjectXml(sample('ms-project.xml').toString());
    expect(r.tasks.map((t) => t.name)).toEqual(['Excavate & form footings', 'Pour footings', 'Erect structural steel', 'Roofing', 'Mezzanine partitions', 'Substantial completion']);
    expect(r.tasks[0]).toMatchObject({ key: '2', group: 'Foundations', start: '2027-01-04', finish: '2027-01-08', duration: 5 });
    expect(r.tasks[2].preds).toEqual([{ key: '3', type: 'FS', lag: 2 }]);
    expect(r.tasks[4].preds).toEqual([{ key: '5', type: 'SS', lag: 3 }]);
    expect(r.tasks[5]).toMatchObject({ milestone: true, duration: 0, preds: [{ key: '6', type: 'FS', lag: 0 }, { key: '7', type: 'FF', lag: 0 }] });
    expect(r.warnings.join(' ')).toMatch(/link to summary tasks left out/);
  });

  it('reads a P6 XER: WBS as groups, hours to days by calendar, relationships', () => {
    const r = parseXer(sample('p6.xer').toString());
    expect(r.tasks.map((t) => t.code)).toEqual(['A1000', 'A1010', 'A1020', 'A1030']);
    expect(r.tasks[1]).toMatchObject({ name: 'Drywall partitions', group: 'Interior - Level 1', duration: 10, start: '2026-11-16' });
    expect(r.tasks[2].preds).toEqual([{ key: '1002', type: 'FF', lag: 2 }]);
    expect(r.tasks[3]).toMatchObject({ milestone: true, duration: 0 });
    expect(r.warnings.join(' ')).toMatch(/1 relationship/);
  });

  it('reads Excel workbooks', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Schedule');
    ws.addRow(['Task ID', 'Task Name', 'Start', 'Duration', 'Predecessors']);
    ws.addRow([10, 'Frame walls', new Date(Date.UTC(2026, 10, 2)), 4, '']);
    ws.addRow([20, 'Hang doors', new Date(Date.UTC(2026, 10, 6)), '2 days', '10']);
    const data = await wb.xlsx.writeBuffer();
    const r = await readScheduleFile('schedule.xlsx', data as ArrayBuffer);
    expect(r.format).toBe('xlsx');
    expect(r.tasks).toEqual([
      expect.objectContaining({ code: '10', name: 'Frame walls', start: '2026-11-02', duration: 4 }),
      expect.objectContaining({ code: '20', start: '2026-11-06', duration: 2, preds: [{ key: '10', type: 'FS', lag: 0 }] }),
    ]);
  });

  it('tells the formats apart by name and content', async () => {
    expect((await readScheduleFile('x.xer', buf(sample('p6.xer')))).format).toBe('xer');
    expect((await readScheduleFile('export', buf(sample('ms-project.xml')))).format).toBe('msp-xml');
    expect((await readScheduleFile('a.csv', buf(sample('ms-project-export.csv')))).tasks.length).toBe(7);
    await expect(readScheduleFile('plan.mpp', new ArrayBuffer(4))).rejects.toThrow(/Save As/);
  });
});

describe('the imported schedule on the model', () => {
  it('finds trade, level and kind from an activity’s words', () => {
    expect(tradeOfText('Steel stud framing L1')).toBe('partitions');
    expect(tradeOfText('Install HM doors, frames and hardware')).toBe('doors');
    expect(tradeOfText('Electrical rough-in - Level 1')).toBe('elec-rough');
    expect(tradeOfText('Light fixtures')).toBe('elec-trim');
    expect(tradeOfText('Erect structural steel')).toBe('structure');
    expect(tradeOfText('Roofing')).toBe('envelope');
    expect(tradeOfText('Metal roof deck and roofing')).toBe('envelope');
    expect(tradeOfText('Steel roof deck')).toBe('structure');
    expect(tradeOfText('Rough-in', 'Plumbing')).toBe('mech-rough');
    expect(tradeOfText('09 91 23 Interior painting')).toBe('painting');
    expect(tradeOfText('Section 26 05 00')).toBe('elec-rough');
    expect(tradeOfText('Owner walkthrough')).toBeNull();
    expect(levelOfText('Electrical rough-in - Level 1', levels)).toBe('L1');
    expect(levelOfText('Framing L1', levels)).toBe('L1');
    expect(levelOfText('Mezzanine partitions', levels)).toBe('mezz');
    expect(levelOfText('Pour footings', levels)).toBe('fdn');
    expect(levelOfText('Ground floor', levels)).toBe('L1');
    expect(levelOfText('Roof membrane', levels)).toBe('roof');
    expect(kindOf('Shop drawings - doors', 10)).toBe('submittal');
    expect(kindOf('Mobilization', 2)).toBe('mobilize');
    expect(kindOf('Owner walkthrough', 0)).toBe('milestone');
    expect(kindOf('Paint walls', 5)).toBe('work');
  });

  it('links imported activities to the model’s elements by trade, level and words', async () => {
    const r = await readScheduleFile('shop.csv', buf(sample('ms-project-export.csv')));
    const us = fromImport(r, 'shop.csv', model, setup);
    const by = (code: string) => us.activities.find((a) => a.code === code)!;
    expect(by('5')).toMatchObject({ trade: 'partitions', level: 'L1', elements: ['w1', 'w2'], linked: 'matched' });
    // "HM doors, frames" names the HM door, so the overhead door isn't counted in.
    expect(by('7')).toMatchObject({ trade: 'doors', elements: ['d1'] });
    expect(by('6')).toMatchObject({ trade: 'elec-rough', level: 'L1', elements: [] });
    expect(by('2')).toMatchObject({ kind: 'submittal', elements: [] });
    expect(by('9')).toMatchObject({ kind: 'milestone', duration: 0 });
    expect(by('3').preds).toEqual([{ from: 'imp:2', type: 'SS', lag: 5 }]);

    const { schedule, setup: s2 } = scheduleUser(us, setup);
    expect(s2.start.value).toBe('2026-11-02');
    const t = schedule.times;
    // The file's dates hold: starts are "not earlier than", links only push later.
    expect(t['imp:2'].start).toBe('2026-11-02');
    expect(t['imp:3'].start).toBe('2026-11-16');
    expect(t['imp:5'].start).toBe('2026-11-18');
    expect(t['imp:7'].finish).toBe('2026-12-09');
    expect(schedule.issues.find((i) => i.id === 'user-schedule-unlinked')?.refs).toEqual(['imp:6', 'imp:8']);
    // Elements go up with their activity; the rest by their trade and level.
    const timeOf = elementTimes(schedule.activities, t);
    expect(timeOf(model.elements[0])).toEqual({ es: t['imp:5'].es, ef: t['imp:5'].ef });
    expect(timeOf({ id: 'drawing:x', trade: 'partitions', level: 'L1', name: 'Wall', shape: null, origin: 'drawing' })).toEqual({ es: t['imp:5'].es, ef: t['imp:5'].ef });
    expect(timeOf({ id: 'w9', trade: 'partitions', level: 'L1', name: 'Wall', shape: null })).toBeUndefined();
    expect(timeOf(model.elements[5])).toBeUndefined();
    expect(scheduleGroups(us, schedule.activities).map((g) => g.title)).toEqual(['Preconstruction', 'Level 1']);
  });

  it('keeps FF and SS links and lags when it schedules', () => {
    const us = fromImport(parseMsProjectXml(sample('ms-project.xml').toString()), 'fit-out.xml', model, setup);
    expect(us.activities.find((a) => a.id === 'imp:3')).toMatchObject({ trade: 'structure', level: 'fdn', elements: ['f1'] });
    expect(us.activities.find((a) => a.id === 'imp:6')).toMatchObject({ trade: 'envelope', elements: ['r1'] });
    expect(us.activities.find((a) => a.id === 'imp:7')).toMatchObject({ trade: 'partitions', level: 'mezz', elements: ['w3'] });
    const { schedule } = scheduleUser(us, setup);
    const t = schedule.times;
    expect(t['imp:5'].start).toBe('2027-01-20'); // pour footings + 2 days lag
    // SS +3 after steel starts would allow Jan 25; the file's own start holds it to Jan 27.
    expect(schedule.activities.find((a) => a.id === 'imp:7')!.deps.map((d) => [d.from, d.type, d.lag])).toEqual([['imp:5', 'SS', 3], ['ms:start', 'SS', 17]]);
    expect(t['imp:7'].start).toBe('2027-01-27');
    // FF: substantial completion can't finish before the partitions do.
    expect(t['imp:8'].es).toBeGreaterThanOrEqual(t['imp:7'].ef);
    expect(schedule.feasibility.chain.length).toBeGreaterThan(1);
  });

  it('round-trips through its own CSV, element links included', async () => {
    const us = fromImport(await readScheduleFile('p6.xer', buf(sample('p6.xer'))), 'p6.xer', model, setup);
    expect(us.activities.find((a) => a.code === 'A1020')).toMatchObject({ trade: 'ceilings', level: 'L1', elements: ['a1'] });
    const { schedule } = scheduleUser(us, setup);
    const csv = scheduleCsv(us, schedule.times, levels);
    const back = fromImport(await readScheduleFile('back.csv', new TextEncoder().encode(csv).buffer as ArrayBuffer), 'back.csv', model, setup);
    expect(back.activities.map((a) => [a.code, a.duration, a.elements, a.preds])).toEqual(us.activities.map((a) => [a.code, a.duration, a.elements, a.preds]));
    expect(back.activities.find((a) => a.code === 'A1020')!.linked).toBe('picked');
  });
});

describe('a schedule of the user’s own', () => {
  it('starts blank or from the generated plan, and schedules from the project start', () => {
    const gen: Activity[] = [
      { id: 'ms:start', name: 'Start', kind: 'milestone', trade: null, level: null, elements: [], duration: 0, durationBasis: 'assumed', durationWhy: '', deps: [], specs: [], sources: [] },
      { id: 'work:partitions:L1', name: 'Partitions — Level 1', kind: 'work', trade: 'partitions', level: 'L1', elements: ['w1', 'w2'], duration: 6, durationBasis: 'assumed', durationWhy: '', deps: [{ from: 'ms:start', type: 'FS', lag: 0, basis: 'assumed', why: '' }], specs: [], sources: [] },
      { id: 'work:doors:L1', name: 'Doors — Level 1', kind: 'work', trade: 'doors', level: 'L1', elements: ['d1'], duration: 2, durationBasis: 'assumed', durationWhy: '', deps: [{ from: 'work:partitions:L1', type: 'FS', lag: 1, basis: 'assumed', why: '' }], specs: [], sources: [] },
    ];
    const own = fromGenerated(gen);
    expect(own.activities.map((a) => a.id)).toEqual(['own:work:partitions:L1', 'own:work:doors:L1']);
    expect(own.activities[1].preds).toEqual([{ from: 'own:work:partitions:L1', type: 'FS', lag: 1 }]);
    const extra = newActivity(own, { name: 'Paint', trade: 'painting', preds: [{ from: 'own:work:doors:L1', type: 'FS', lag: 0 }] });
    expect(extra).toMatchObject({ id: 'own:3', code: '3' });
    own.activities.push(extra);
    const { schedule, setup: s2 } = scheduleUser(own, setup);
    expect(s2.start.value).toBe(setup.start.value);
    expect(schedule.times['own:work:doors:L1'].es).toBe(7);
    expect(schedule.times['own:3'].es).toBe(9);
    expect(activeUserSchedule({ use: 'own', own })).toBe(own);
    expect(activeUserSchedule({ use: 'generated', own })).toBeNull();
  });

  it('reports a loop the user made instead of hanging', () => {
    const a = newActivity(undefined, { name: 'A' });
    const b = { ...newActivity({ name: '', activities: [a] }, { name: 'B' }), preds: [{ from: a.id, type: 'FS' as const, lag: 0 }] };
    a.preds = [{ from: b.id, type: 'FS', lag: 0 }];
    const { schedule } = scheduleUser({ name: 'Mine', format: 'own', activities: [a, b] }, setup);
    expect(schedule.issues.some((i) => i.id === 'loop')).toBe(true);
  });
});
