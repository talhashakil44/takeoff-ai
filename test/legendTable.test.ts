import { describe, expect, it } from 'vitest';
import { measures, readAssemblyTable, roleOf } from '../src/legendTable';
import type { PageText } from '../src/pageText';
import type { Segment } from '../src/fill/vectors';

const t = (str: string, x0: number, cy: number, h = 7): PageText => ({ str, cx: x0 + (str.length * h * 0.55) / 2, cy, w: str.length * h * 0.55, h });
const hline = (y: number, x1: number, x2: number): Segment => ({ x1, y1: y, x2, y2: y, width: 0.5, filled: false });
const vline = (x: number, y1: number, y2: number): Segment => ({ x1: x, y1, x2: x, y2, width: 0.5, filled: false });

describe('assembly schedules read from the drawing text', () => {
  it('reads a TYPE | ASSEMBLY | FIRE RATING | S.T.C. | DESCRIPTION table (a shaftwall, VS1)', () => {
    // Columns: TYPE 0-100, ASSEMBLY 100-350, FIRE RATING 350-600, S.T.C. 600-780, DESCRIPTION 780-1400.
    const cols = [0, 100, 350, 600, 780, 1400];
    const segs: Segment[] = [...cols.map((x) => vline(x, 60, 420)), hline(60, 0, 1400), hline(100, 0, 1400), hline(280, 0, 1400), hline(420, 0, 1400)];
    // The title's underline spans only the title: not a row line.
    segs.push(hline(132, 795, 950));
    const texts: PageText[] = [
      t('WALL ASSEMBLIES', 580, 40, 12),
      t('TYPE', 30, 80),
      t('ASSEMBLY', 190, 80),
      t('FIRE RATING', 430, 80),
      t('S.T.C.', 665, 80),
      t('DESCRIPTION', 1040, 80),
      t('VS1', 40, 190),
      t('1 HR F.R.R.', 370, 120),
      t('REF: BXUVC.W452', 370, 150),
      t('-', 690, 120),
      t('63mm SHAFTWALL', 800, 125),
      t('•', 800, 160),
      t('25mm SHAFTLINER', 850, 160),
      t('•', 800, 180),
      t('63mm C-H STEEL STUDS AT MAX 610 O.C.', 850, 180),
      t('•', 800, 200),
      t('FILL CAVITY WITH MINERAL WOOL BATT INSULATION', 850, 200),
      t('•', 800, 220),
      t('16mm GYPSUM WALL BOARD (REFER TO BXUVC W452)', 850, 220),
      t('W1', 40, 350),
      t('92mm STEEL STUD', 800, 300),
      t('•', 800, 330),
      t('16mm GYPSUM BOARD', 850, 330),
      t('•', 800, 350),
      t('92mm STEEL STUDS @ 406mm O.C.', 850, 350),
    ];
    const { assemblies } = readAssemblyTable(texts, segs);
    expect(assemblies.map((a) => [a.code, a.category, a.title])).toEqual([
      ['VS1', 'interior_wall', '63mm SHAFTWALL'],
      ['W1', 'interior_wall', '92mm STEEL STUD'],
    ]);
    const vs1 = assemblies[0];
    expect(vs1.layers.map((l) => [l.role, l.thickness_mm, l.spacing_mm])).toEqual([
      ['board', 25, null],
      ['framing', 63, 610],
      ['insulation', null, null],
      ['board', 16, null],
    ]);
    expect(vs1.notes[0]).toBe('FIRE RATING: 1 HR F.R.R. REF: BXUVC.W452');
    expect(assemblies[1].layers[1].spacing_mm).toBe(406);
  });

  it('reads a MARK | ASSEMBLY (PLAN VIEW) | ASSEMBLY DESCRIPTION table, two types in a row, sizes without "mm"', () => {
    // Columns: MARK 1280-1335, ASSEMBLY (PLAN VIEW) 1335-1490, ASSEMBLY DESCRIPTION 1490-1700, COMMENTS 1700-1800.
    const cols = [1280, 1335, 1490, 1700, 1800];
    const segs: Segment[] = [...cols.map((x) => vline(x, 65, 420)), hline(65, 1280, 1800), hline(85, 1280, 1800), hline(245, 1280, 1800), hline(420, 1280, 1800)];
    // Another table beside it on the same row (an OBC matrix): not this table's columns.
    segs.push(hline(65, 1820, 2200), hline(85, 1820, 2200));
    const texts: PageText[] = [
      t('WALL TYPES', 1520, 55, 10),
      t('MARK', 1295, 75),
      t('ASSEMBLY (PLAN VIEW)', 1360, 75),
      t('ASSEMBLY DESCRIPTION', 1540, 75),
      t('COMMENTS', 1720, 75),
      t('Item', 1830, 75),
      t('WALL PARTITION TYPE 1 (WP1)', 1500, 99, 6),
      t('- 13 GYPSUM BOARD', 1500, 119, 6),
      t('- 92 STEEL STUD @ 406 o.c. C/W SOUND BATT', 1500, 128, 6),
      t('INSULATION', 1500, 138, 6),
      t('- 13 GYPSUM BOARD', 1500, 148, 6),
      t('WP1', 1300, 160, 6),
      t('WALL PARTITION TYPE 2 (WP2a)', 1500, 262, 6),
      t('- 13 GYPSUM BOARD', 1500, 281, 6),
      t('- 152 STEEL STUD @ 406 o.c.', 1500, 291, 6),
      t('- 13 GYPSUM BOARD', 1500, 301, 6),
      t('WALL PARTITION TYPE 2 (WP2b)', 1500, 340, 6),
      t('- 13 GYPSUM BOARD', 1500, 359, 6),
      t('- 38x140 WOOD STUDS @ 406 o.c.', 1500, 369, 6),
      t('WP2a', 1300, 321, 6),
    ];
    const { assemblies } = readAssemblyTable(texts, segs);
    expect(assemblies.map((a) => [a.code, a.category])).toEqual([
      ['WP1', 'interior_wall'],
      ['WP2a', 'interior_wall'],
      ['WP2b', 'interior_wall'],
    ]);
    // The stud line carries on below its dash, and its insulation is a layer of its own.
    expect(assemblies[0].layers.map((l) => [l.role, l.thickness_mm, l.spacing_mm])).toEqual([
      ['board', 13, null],
      ['framing', 92, 406],
      ['insulation', null, null],
      ['board', 13, null],
    ]);
    expect(assemblies[0].layers[2].material).toBe('SOUND BATT INSULATION');
    expect(assemblies[2].layers.map((l) => l.thickness_mm)).toEqual([13, 140]);
    // The matrix beside the table adds no notes.
    expect(assemblies[0].notes.some((n) => /Item/.test(n))).toBe(false);
  });

  it('finds nothing on a sheet without a schedule', () => {
    expect(readAssemblyTable([t('GROUND FLOOR PLAN', 100, 100)], []).assemblies).toEqual([]);
  });

  it('reads thickness, spacing and role from a layer', () => {
    expect(measures('92mm METAL STUDS @ 610mm FRAMING O.C.')).toEqual({ thickness_mm: 92, spacing_mm: 610 });
    expect(measures('5/8" TYPE X GYPSUM BOARD')).toEqual({ thickness_mm: 16, spacing_mm: null });
    expect(measures('2-1/2" STUDS @ 16" O.C.').spacing_mm).toBe(406);
    expect(roleOf('25mm SHAFTLINER')).toBe('board');
    expect(roleOf('150mm CAST-IN-PLACE CONCRETE SLAB')).toBe('structure');
    expect(roleOf('10 MIL POLY VAPOUR BARRIER')).toBe('membrane');
    expect(measures('13 PLYWOOD SHEATHING').thickness_mm).toBe(13);
    expect(measures('6 MIL POLY VAPOUR BARRIER').thickness_mm).toBeNull();
    expect(measures('2x6 @ 406 o.c.')).toEqual({ thickness_mm: 140, spacing_mm: 406 });
    expect(roleOf('38x140 SCISSOR TRUSS')).toBe('framing');
  });
});
