import { describe as group, expect, it } from 'vitest';
import type { Segment } from '../src/fill/vectors';
import type { Sheet } from '../src/model';
import type { PageText } from '../src/pageText';
import { readAbbreviations } from '../src/smart/legends';
import { describe, emptyIndex, entries, expand, indexStats, norm, readSheetInto, searchEntries, tagsOn, wallFacts } from '../src/smart/index';
import { readSchedules, scheduleKind } from '../src/smart/schedules';

const text = (str: string, x0: number, cy: number, h = 6, angle?: number): PageText => ({ str, cx: x0 + (str.length * h * 0.6) / 2, cy, w: str.length * h * 0.6, h, ...(angle !== undefined ? { angle } : {}) });
const seg = (x1: number, y1: number, x2: number, y2: number): Segment => ({ x1, y1, x2, y2, width: 0.5, filled: false });
const sheet = (id: string, name: string): Sheet => ({ id, docId: 'd', page: 1, name, width: 2000, height: 1400, metersPerPoint: null, scaleLabel: null, scaleSource: null, scaleHints: [] });

/** A small ruled door schedule: NO. | DOOR (MATERIAL, FINISH) | HARDWARE (CLOSER, EXIT DEVICE) | REMARKS. */
function doorSchedule(): { texts: PageText[]; segs: Segment[] } {
  const xs = [100, 160, 210, 260, 310, 360, 480];
  const texts: PageText[] = [
    text('DOOR SCHEDULE', 200, 80, 12),
    text('DOOR', 165, 110),
    text('HARDWARE', 265, 110),
    text('NO.', 110, 140),
    text('MATERIAL', 163, 140, 5),
    text('FINISH', 213, 140, 5),
    text('CLOSER', 263, 140, 5),
    text('EXIT DEVICE', 312, 140, 4),
    text('REMARKS', 365, 140),
  ];
  const rows = [
    ['D101', 'HM', 'PTD', '●', '', 'ONE POWER EXIT BAR'],
    ['D102', 'WD', 'STN', '●', '●', ''],
    ['D103', 'HM', 'PTD', '', '', ''],
  ];
  const segs: Segment[] = [seg(100, 95, 480, 95), seg(100, 125, 480, 125), seg(100, 150, 480, 150)];
  rows.forEach((r, i) => {
    const y = 162 + i * 20;
    r.forEach((c, j) => c && texts.push(text(c, xs[j] + 4, y)));
    segs.push(seg(100, y + 10, 480, y + 10));
  });
  for (const x of xs) segs.push(seg(x, 125, x, 222));
  // Group headings' rules: DOOR over two columns, HARDWARE over two.
  segs.push(seg(100, 95, 100, 222), seg(160, 95, 160, 125), seg(260, 95, 260, 125), seg(360, 95, 360, 125));
  return { texts, segs };
}

group('schedules', () => {
  it('reads a ruled schedule by its own columns, group headings and ticks included', () => {
    const { texts, segs } = doorSchedule();
    const [s] = readSchedules(texts, segs);
    expect(s.title).toBe('DOOR SCHEDULE');
    expect(s.kind).toBe('door');
    expect(s.rows.map((r) => r.mark)).toEqual(['D101', 'D102', 'D103']);
    expect(s.columns.map((c) => c.join(' · '))).toEqual(['NO.', 'DOOR · MATERIAL', 'DOOR · FINISH', 'HARDWARE · CLOSER', 'HARDWARE · EXIT DEVICE', 'REMARKS']);
    expect(s.rows[1].cells).toEqual(['D102', 'WD', 'STN', '✓', '✓', '']);
    expect(s.rows[0].cells[5]).toBe('ONE POWER EXIT BAR');
  });

  it('names what a schedule is from its title', () => {
    expect(scheduleKind('ROOM FINISH SCHEDULE')).toBe('room');
    expect(scheduleKind('WINDOW SCHEDULE')).toBe('window');
    expect(scheduleKind('WALL ASSEMBLIES')).toBe('wall');
    expect(scheduleKind('LINTEL SCHEDULE')).toBe('structure');
    expect(scheduleKind('FAN SCHEDULE')).toBe('other');
  });

  it('does not take a note pointing at a schedule for one', () => {
    expect(readSchedules([text('PER SCHEDULE', 100, 100), text('D1', 100, 120), text('D2', 100, 140)], [])).toEqual([]);
  });
});

group('legends', () => {
  it('reads an abbreviations list', () => {
    const texts = [text('ABBREVIATIONS', 100, 50, 8)];
    const list = [
      ['HM', 'HOLLOW METAL'],
      ['PTD', 'PAINTED'],
      ['EX', 'EXISTING'],
      ['GB', 'GYPSUM BOARD'],
      ['STN', 'STAINED'],
      ['WD', 'WOOD'],
    ];
    list.forEach(([a, m], i) => texts.push(text(a, 100, 70 + i * 10, 5), text(m, 130, 70 + i * 10, 5)));
    const ab = readAbbreviations(texts);
    expect(ab.get('HM')).toBe('HOLLOW METAL');
    expect(ab.get('GB')).toBe('GYPSUM BOARD');
    expect(expand('EX GB', Object.fromEntries(ab))).toBe('EX GB (existing gypsum board)');
    expect(expand('NO', { NO: 'NUMBER' })).toBe('NO');
  });

  it('pulls a wall type\'s framing, boards and ratings out of its legend lines', () => {
    const facts = Object.fromEntries(wallFacts(['INTERIOR PARTITION CONSTRUCTION', '5/8" TYPE \'X\' GYPSUM BOARD', '3 5/8" STEEL STUDS @ 16" O.C.', '1 HR FIRE RATING', 'STC 45']).map((r) => [r.label, r.value]));
    expect(facts.Framing).toBe('3 5/8" steel studs @ 16" o.c.');
    expect(facts.Boards).toContain("5/8\" type 'x' gypsum board");
    expect(facts['Fire rating']).toMatch(/1 HR/);
    expect(facts['Sound (STC)']).toBe('45');
  });
});

group('smart index', () => {
  it('finds each scheduled door on a plan and says what the schedule says about it', () => {
    const sched = sheet('s1', 'A6.1');
    const plan = sheet('s2', 'A1.1');
    const index = emptyIndex();
    const { texts, segs } = doorSchedule();
    readSheetInto(index, sched, texts, segs);
    const planTexts = [text('D101', 300, 300), text('102', 500, 300), text('A6.1', 800, 900, 4), text('1', 800, 890, 4)];
    const dict = entries(index);
    const tags = tagsOn(plan, planTexts, index, [sched, plan], dict);
    expect(tags.map((t) => `${t.kind}:${t.code}`)).toEqual(['door:D101', 'door:D102', 'sheet:A6.1']);
    expect(tags[2].target).toBe('s1');
    index.where[dict.get('D101')!.key] = { s2: 1 };
    index.where[dict.get('D102')!.key] = { s2: 1 };
    const info = describe(dict.get(norm('D102'))!, index, [sched, plan], dict);
    expect(info.source).toBe('Door Schedule, A6.1');
    const door = info.sections.find((s) => s.title === 'Door')!;
    expect(door.rows.map((r) => `${r.label}=${r.value}`)).toEqual(['Material=WD', 'Finish=STN']);
    expect(info.sections.find((s) => s.title === 'Hardware')!.rows[0]).toEqual({ label: 'Checked', value: 'Closer, Exit device' });
    const st = indexStats(index, dict).get('door')!;
    expect([st.listed, st.onPlans, st.missing]).toEqual([3, 2, ['D103']]);
    expect(searchEntries(new Map([...dict.values()].map((e) => [e.key, e])), 'd10').map((e) => e.code)).toEqual(['D101', 'D102', 'D103']);
  });
});
