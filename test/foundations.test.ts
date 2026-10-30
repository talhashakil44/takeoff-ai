import { describe, expect, it } from 'vitest';
import { enclosedOutline, foundationMarks, lengthOf, markPlaces, sizesOf, slabThickness } from '../src/automate/foundations';
import { divisionOf, structuralMembers } from '../src/automate/structure';
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
    expect(by.F1).toMatchObject({ kind: 'pad', width: 1.5, length: 1.5, depth: 0.3 });
    expect(by.P2).toMatchObject({ kind: 'pier', width: 0.48, length: 0.8 });
    expect(by.MF2).toMatchObject({ kind: 'mass', width: 5, length: 1.8, depth: 0.4 });
    expect(by['FW-3']).toMatchObject({ kind: 'wall', width: 0.3 });
  });

  it('counts tags, stacked tags included, and not notes that name a footing', () => {
    const marks = [{ mark: 'F1', kind: 'pad' as const, says: '', schedule: '' }];
    const places = markPlaces([txt('F1', 1, 1), txt('F1 / P2', 5, 5), txt('PROVIDE F1 FOOTING AT ALL COLUMNS', 9, 9)], marks);
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
    expect(divisionOf('HSS 127 x 127 x 9.5')).toMatch(/^05/);
    expect(divisionOf('W 200 x 27')).toMatch(/^05/);
  });
});
