import { stripsFromTags } from '../src/automate/stripTags';
import type { WallTag } from '../src/walls/tags';
import { describe, expect, it } from 'vitest';
import { enclosedOutline, foundationMarks, lengthOf, markPlaces, sizesOf, slabThickness } from '../src/automate/foundations';
import { beamSpan, divisionOf, structuralMembers } from '../src/automate/structure';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';
import type { Schedule } from '../src/smart/schedules';

const sched = (title: string, columns: string[][], rows: [string, string[]][]): Schedule => ({
  title,
  kind: 'structure',
  columns,
  markColumn: 0,
  rows: rows.map(([mark, cells]) => ({ mark, cells })),
  box: [0, 0, 10, 10],
});
const txt = (str: string, cx: number, cy: number): PageText => ({ str, cx, cy, w: 10, h: 5 }) as PageText;

describe('foundations', () => {
  it('reads sizes in millimetres or feet, and not rebar as metres', () => {
    expect(lengthOf('1500', true)).toBe(1.5);
    expect(lengthOf("4'-6\"", false)).toBeCloseTo(1.3716, 4);
    expect(lengthOf('15M', true)).toBeNull();
    expect(lengthOf('1.5M', true)).toBe(1.5);
    expect(sizesOf('1500 x 1800', true)).toEqual([1.5, 1.8]);
  });

  it('reads the footing, pier, mass footing and foundation wall schedules', () => {
    const marks = foundationMarks(
      [
        sched('CONCRETE FOOTING SCHEDULE', [['MARK'], ['TYPE', 'P = PAD', 'S = STRIP'], ['DEPTH'], ['SIZE']], [
          ['SF-N', ['SF-N', 'ST', '', '', '2', '15M', 'B. CONT.', 'REFER TO DETAIL 10/S1.2']],
          ['SF-1', ['SF-1', 'S', '300', '600']],
          ['F1', ['F1', 'P', '300', '1500 x 1500']],
        ]),
        sched('PIER SCHEDULE', [['MARK'], ['SIZE']], [['P2', ['P2', '480 x 800']]]),
        sched('MASS FOOTING SCHEDULE', [['MARK'], ['SIZE'], ['THICKNESS'], ['REINFORCING', 'SIZE']], [['20M', ['MF2', '5000 x 1800', '400', '20M']]]),
        sched('FOUNDATION WALL SCHEDULE', [['MARK'], ['WALL TYPE'], ['REINFORCING STEEL', 'SIZE']], [['FW-3', ['FW-3', '458 ICF (300 CONCRETE)', '20M 20M']]]),
      ],
      true,
    );
    const by = Object.fromEntries(marks.map((m) => [m.mark, m]));
    expect(by['SF-1']).toMatchObject({ kind: 'strip', width: 0.6, depth: 0.3 });
    // A strip the schedule sizes by a detail (Kelso SF-N: thickened slab under masonry, "REFER TO DETAIL 10/S1.2").
    expect(by['SF-N']).toMatchObject({ kind: 'strip', width: undefined, depth: undefined, refer: 'REFER TO DETAIL 10/S1.2' });
    expect(by['SF-1'].refer).toBeUndefined();
    expect(by.F1).toMatchObject({ kind: 'pad', width: 1.5, length: 1.5, depth: 0.3 });
    expect(by.P2).toMatchObject({ kind: 'pier', width: 0.48, length: 0.8 });
    expect(by.MF2).toMatchObject({ kind: 'mass', width: 5, length: 1.8, depth: 0.4 });
    expect(by['FW-3']).toMatchObject({ kind: 'wall', width: 0.3 });
  });

  it('counts tags, stacked tags included, and not notes that name a footing', () => {
    const marks = [{ mark: 'F1', kind: 'pad' as const, says: '', schedule: '' }];
    const places = markPlaces([txt('F1', 1, 1), txt('F1 / P2', 5, 5), txt('PROVIDE F1 FOOTING AT ALL COLUMNS', 9, 9), txt('TYP. AT F1', 12, 12)], marks);
    expect(places.get('F1')).toHaveLength(2);
  });

  it('finds the slab inside the foundation walls across a door-width gap, and grows it for the excavation', () => {
    // A 20 m x 10 m rectangle of walls at 1:100 (0.0353 m a point), with a 0.9 m gap.
    const k = 0.035277777777777776;
    const m = (v: number) => v / k;
    const walls = [
      [[m(0), m(0)], [m(20), m(0)], [m(20), m(10)], [m(10.9), m(10)]],
      [[m(10), m(10)], [m(0), m(10)], [m(0), m(0)]],
    ] as [number, number][][];
    const area = (r: [number, number][]) => Math.abs(r.reduce((n, p, i) => n + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;
    const slab = enclosedOutline(walls, k)!;
    expect(area(slab) * k * k).toBeGreaterThan(180);
    expect(area(slab) * k * k).toBeLessThan(215);
    const dig = enclosedOutline(walls, k, 1)!;
    expect(area(dig) * k * k).toBeGreaterThan(250);
    expect(area(dig) * k * k).toBeLessThan(275);
    expect(enclosedOutline([[[0, 0], [m(5), 0]]], k)).toBeNull();
  });

  it('reads a slab thickness from a note', () => {
    expect(slabThickness([txt('125 THICK CONCRETE SLAB ON GRADE', 0, 0)], true)).toBe(0.125);
    expect(slabThickness([txt('SLAB ON GRADE 4" THICK', 0, 0)], false)).toBeCloseTo(0.1016, 4);
  });
});

describe('structure', () => {
  it('reads beam, column, lintel and structural wall schedules, not the foundation ones', () => {
    const members = structuralMembers([
      sched('BEAM SCHEDULE', [['MARK'], ['SIZE']], [['B2', ['B2', '265 x 608 GLULAM 24f-EX']], ['B7', ['B7', 'W 200 x 27']]]),
      sched('COLUMN SCHEDULE', [['MARK'], ['SIZE'], ['NOTES']], [['C2', ['C2', 'HSS 127 x 127 x 9.5', 'STEEL COLUMN']]]),
      sched('WOOD LINTEL SCHEDULE', [['MARK'], ['SIZE']], [['L1', ['L1', '2 - 38x184 (2x8)']]]),
      sched('STRUCTURAL WALL SCHEDULE', [['MARK'], ['WALL TYPE']], [['WT-1', ['WT-1', '38 x 140 (2x6) @ 400 O.C.']]]),
      sched('CONCRETE FOOTING SCHEDULE', [['MARK'], ['SIZE']], [['F1', ['F1', '1500 x 1500']]]),
    ]);
    expect(members.map((m) => [m.mark, m.kind])).toEqual([
      ['B2', 'beam'],
      ['B7', 'beam'],
      ['C2', 'column'],
      ['L1', 'lintel'],
      ['WT-1', 'wall'],
    ]);
    expect(divisionOf('265 x 608 GLULAM')).toMatch(/^06/);
    // A size of bare dimensions takes its material from the row (Kelso C1: 265 x 342 | GLULAM COLUMN).
    const [c1] = structuralMembers([sched('COLUMN SCHEDULE', [['MARK'], ['SIZE'], ['DESCRIPTION']], [['C1', ['C1', '265 x 342', 'GLULAM COLUMN']]])]);
    expect(c1.size).toBe('265 x 342 GLULAM');
    expect(divisionOf(c1.size)).toMatch(/^06/);
    expect(divisionOf('HSS 127 x 127 x 9.5')).toMatch(/^05/);
    expect(divisionOf('W 200 x 27')).toMatch(/^05/);
  });
});

describe('beam spans', () => {
  const line = (x1: number, y1: number, x2: number, y2: number, width = 0.96): Segment => ({ x1, y1, x2, y2, width, filled: false }) as Segment;
  // A vertical beam line broken at three columns (squares across it at y 100, 200, 300), tag beside it.
  const segs = [line(50, 0, 50, 95), line(50, 105, 50, 195), line(50, 205, 50, 295), line(50, 305, 50, 400), line(0, 150, 400, 150, 0.36)];
  for (const y of [100, 200, 300]) segs.push(line(46, y - 5, 54, y - 5, 0.48), line(54, y - 5, 54, y + 5, 0.48), line(54, y + 5, 46, y + 5, 0.48), line(46, y + 5, 46, y - 5, 0.48));
  it('runs from the column before the tag to the one after', () => {
    const t = { str: 'B3', cx: 44, cy: 160, w: 6, h: 5, angle: -Math.PI / 2 } as PageText;
    expect(beamSpan(t, segs, 600)).toEqual([[50, 100], [50, 200]]);
  });
  it('to the end of the line where no column is drawn', () => {
    const t = { str: 'B3', cx: 44, cy: 350, w: 6, h: 5, angle: -Math.PI / 2 } as PageText;
    expect(beamSpan(t, segs, 600)).toEqual([[50, 300], [50, 400]]);
  });
  it('none when no line runs along the tag', () => {
    expect(beamSpan({ str: 'B3', cx: 300, cy: 300, w: 6, h: 5, angle: -Math.PI / 2 } as PageText, segs, 600)).toBeNull();
  });
  it('stops at a column hung off the line where its grid tick crosses and a column is tagged beside it (Kelso S2.1 B1)', () => {
    // A horizontal beam line at y 216.6, columns drawn below it (crossing nothing), one grid dash
    // crossing the line at each column, the column tags 15 pt along from them.
    const beam = [line(1085, 216.6, 1840, 216.6, 1.32)];
    const ticks = [1160.6, 1310.8, 1460.9, 1611, 1761.1].map((x) => line(x, 213.8, x, 218.3, 0.36));
    const t = { str: 'B1', cx: 1385.7, cy: 216.5, w: 8, h: 5, angle: 0 } as PageText;
    expect(beamSpan(t, [...beam, ...ticks], 900)).toEqual([[1085, 216.6], [1840, 216.6]]);
    const tags: [number, number][] = [1175.7, 1325.8, 1475.9, 1626.1, 1776.2].map((x) => [x, 212.1]);
    expect(beamSpan(t, [...beam, ...ticks], 900, tags)).toEqual([[1310.8, 216.6], [1460.9, 216.6]]);
    // A lone dash with no column tagged near it is still not a support.
    expect(beamSpan(t, [...beam, ...ticks], 900, [[1475.9, 212.1]])).toEqual([[1085, 216.6], [1460.9, 216.6]]);
  });
  it('runs on past its last support to the free end when noted as a cantilever (Kelso S2.1 B2 "(CANT.)")', () => {
    // Tag between the columns at 200 and 300; past 300 the line runs to 400 with no column.
    const t = { str: 'B2', cx: 44, cy: 250, w: 6, h: 5, angle: -Math.PI / 2 } as PageText;
    expect(beamSpan(t, segs, 600)).toEqual([[50, 200], [50, 300]]);
    expect(beamSpan(t, segs, 600, [], true)).toEqual([[50, 200], [50, 400]]);
    // Free ends both sides: which one cantilevers is not known, the span stays.
    const two = [line(50, 0, 50, 145), line(50, 155, 50, 245), line(50, 255, 50, 400)];
    for (const y of [150, 250]) two.push(line(46, y - 5, 54, y - 5, 0.48), line(54, y - 5, 54, y + 5, 0.48), line(54, y + 5, 46, y + 5, 0.48), line(46, y + 5, 46, y - 5, 0.48));
    const mid = { str: 'B2', cx: 44, cy: 200, w: 6, h: 5, angle: -Math.PI / 2 } as PageText;
    expect(beamSpan(mid, two, 600, [], true)).toEqual([[50, 150], [50, 250]]);
  });
});

describe('strip footings tagged on their own', () => {
  const k = (100 * 0.0254) / 72; // 1:100
  const P = (m: number) => m / k;
  /** A dashed line along y from x0 to x1 (metres): 9 pt dashes, 4.6 pt gaps. */
  const dashed = (y: number, x0: number, x1: number, width = 0.6): Segment[] => {
    const out: Segment[] = [];
    for (let x = P(x0); x < P(x1); x += 13.6) out.push({ x1: x, y1: P(y), x2: Math.min(x + 9, P(x1)), y2: P(y), width, filled: false });
    return out;
  };
  const tag = (code: string, x: number, y: number, tipY: number): WallTag => ({
    code, cx: P(x), cy: P(y), w: 18, h: 5, target: [P(x), P(tipY)], paths: [[[P(x), P(y) - 6], [P(x), P(tipY)]]], leader: true, tick: true,
  });

  it('runs along the two dashed edges its arrow lands on, the scheduled width apart, once for two tags', () => {
    // A 600 footing under a wall from x 2 to x 6, edges at y 5.0 and 5.6; tags below, arrows up onto y 5.6.
    const segs = [...dashed(5, 2, 6), ...dashed(5.6, 2, 6), ...dashed(4.6, 0, 8), ...dashed(6.3, 0, 8)];
    const found = stripsFromTags([tag('SF-1', 3, 6.6, 5.6), tag('SF-1', 5, 6.6, 5.6)], segs, k, () => 0.6);
    expect(found).toHaveLength(1);
    const [a, b] = found[0].line;
    expect(a[1] * k).toBeCloseTo(5.3, 1);
    expect(Math.abs(b[0] - a[0]) * k).toBeGreaterThan(3.8);
    expect(Math.abs(b[0] - a[0]) * k).toBeLessThan(4.1);
    expect(found[0].width * k).toBeCloseTo(0.6, 1);
  });

  it('takes the nearest edge beyond 300 when the schedule gives no width, and nothing without a far edge', () => {
    const segs = [...dashed(5, 2, 6), ...dashed(5.7, 2, 6)];
    const [f] = stripsFromTags([tag('SF-N', 3, 6.6, 5.7)], segs, k, () => undefined);
    expect(f.width * k).toBeCloseTo(0.7, 1);
    expect(stripsFromTags([tag('SF-N', 3, 6.6, 5.7)], dashed(5.7, 2, 6), k, () => undefined)).toHaveLength(0);
  });
});
