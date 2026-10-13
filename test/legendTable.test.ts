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
  });
});
