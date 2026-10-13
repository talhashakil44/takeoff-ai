import { describe, expect, it } from 'vitest';
import type { ExtractedAssembly } from '../src/ai/schema';
import { buildTakeoffType, findAssemblyCodes } from '../src/assemblyBuilder';
import { evaluate } from '../src/formula';
import { textLines } from '../src/sheetInfo';

const W1: ExtractedAssembly = {
  code: 'W1',
  category: 'interior_wall',
  title: 'TYPICAL INTERIOR WALL',
  layers: [
    { material: '16mm GYPSUM BOARD', role: 'board', thickness_mm: 16, spacing_mm: null },
    { material: '92mm METAL STUDS FRAMING @ 610mm O.C.', role: 'framing', thickness_mm: 92, spacing_mm: 610 },
    { material: '16mm GYPSUM BOARD', role: 'board', thickness_mm: 16, spacing_mm: null },
  ],
  total_thickness_mm: 125,
  notes: ['ASSEMBLY TO U/S OF STRUCTURE'],
};

const F1: ExtractedAssembly = {
  code: 'F1',
  category: 'floor',
  title: 'INTERIOR SLAB-ON-GRADE (R16)',
  layers: [
    { material: 'FINISH TO BE SPECIFIED BY ARCHITECT', role: 'finish', thickness_mm: null, spacing_mm: null },
    { material: '150mm CAST-IN-PLACE CONCRETE SLAB', role: 'structure', thickness_mm: 150, spacing_mm: null },
    { material: '100mm EPS RIGID INSULATION', role: 'insulation', thickness_mm: 100, spacing_mm: null },
    { material: '10 MIL POLY VAPOUR BARRIER MEMBRANE', role: 'membrane', thickness_mm: null, spacing_mm: null },
    { material: '150mm COMPACTED GRANULAR A FILL', role: 'fill', thickness_mm: 150, spacing_mm: null },
    { material: '25mm AIR SPACE', role: 'air_space', thickness_mm: 25, spacing_mm: null },
  ],
  total_thickness_mm: null,
  notes: [],
};

const quantities = (items: { name: string; formula: string }[], vars: Record<string, number>) =>
  Object.fromEntries(items.map((i) => [i.name, (evaluate(i.formula, vars) as { value: number }).value]));

describe('buildTakeoffType', () => {
  it('turns a wall legend entry into a linear type with per-layer materials', () => {
    const t = buildTakeoffType(W1, 'metric', 0, 3);
    expect(t.kind).toBe('linear');
    expect(t.name).toBe('W1 – TYPICAL INTERIOR WALL');
    expect(t.height).toBe(3);
    // 20 m of wall in 2 runs at 3 m high.
    const q = quantities(t.items, { L: 20, H: 3, A: 60, P: 0, N: 2 });
    expect(q['Wall area']).toBe(60);
    expect(q['92mm METAL STUDS FRAMING @ 610mm O.C. – members']).toBe(Math.ceil(20 / 0.61) + 2);
    expect(q['92mm METAL STUDS FRAMING @ 610mm O.C. – top & bottom track/plate']).toBe(40);
    // Board listed on both faces gives two lines, each with waste.
    const boards = t.items.filter((i) => i.name.startsWith('16mm GYPSUM BOARD'));
    expect(boards).toHaveLength(2);
    expect(boards.map((b) => (evaluate(b.formula, { A: 60 }) as { value: number }).value)).toEqual([66, 66]);
  });

  it('uses imperial spacing and units', () => {
    const t = buildTakeoffType(W1, 'imperial', 0, 10);
    const studs = t.items.find((i) => i.name.endsWith('members'))!;
    expect(studs.unit).toBe('ea');
    expect(studs.formula).toBe(`ceil(L / ${Number((610 / 304.8).toFixed(4))}) + N`);
  });

  it('turns a floor entry into an area type with volumes and no air spaces', () => {
    const t = buildTakeoffType(F1, 'metric', 0, 3);
    expect(t.kind).toBe('area');
    expect(t.items.some((i) => i.name.includes('AIR SPACE'))).toBe(false);
    const q = quantities(t.items, { L: 0, H: 3, A: 100, P: 40, N: 1 });
    expect(q['Floor area']).toBe(100);
    expect(q['150mm CAST-IN-PLACE CONCRETE SLAB – volume']).toBeCloseTo(15);
    expect(q['150mm COMPACTED GRANULAR A FILL – volume']).toBeCloseTo(15);
    expect(q['10 MIL POLY VAPOUR BARRIER MEMBRANE – incl. 10% waste']).toBeCloseTo(110);
    const vol = t.items.find((i) => i.name.endsWith('SLAB – volume'))!;
    expect(vol.unit).toBe('m³');
  });

  it('gives imperial slab volume in cubic yards', () => {
    const t = buildTakeoffType(F1, 'imperial', 0, 10);
    const vol = t.items.find((i) => i.name.endsWith('SLAB – volume'))!;
    expect(vol.unit).toBe('CY');
    // 1000 SF at 150 mm (0.4921 ft) is about 18.2 CY.
    expect((evaluate(vol.formula, { A: 1000 }) as { value: number }).value).toBeCloseTo((1000 * (150 / 304.8)) / 27, 2);
  });
});

describe('division', () => {
  it('prices a concrete foundation wall under concrete, a stud wall under framing', () => {
    const wall = (material: string, role: 'structure' | 'framing'): ExtractedAssembly => ({
      code: 'WF1',
      category: 'exterior_wall',
      title: 'FOUNDATION WALL TYPE 1',
      layers: [{ material, role, thickness_mm: null, spacing_mm: null }],
      total_thickness_mm: null,
      notes: [],
    });
    expect(buildTakeoffType(wall('CAST IN PLACE CONCRETE FOUNDATION WALL', 'structure'), 'metric', 0, 0).division).toBe('03 Concrete');
    expect(buildTakeoffType(wall('190 CONCRETE BLOCK', 'structure'), 'metric', 0, 0).division).toBe('04 Masonry');
    expect(buildTakeoffType(wall('38x140 WOOD STUDS @ 406 o.c.', 'framing'), 'metric', 0, 0).division).toBe('06 Wood Framing & Partitions');
  });
});

describe('findAssemblyCodes', () => {
  it('finds standalone type tags and ignores other text', () => {
    expect(findAssemblyCodes(['W1', 'EW3C', ' FR1 ', 'W6A', 'TYPE', 'A0.3', 'S-1', '92mm', 'W1'])).toEqual([
      'EW3C',
      'FR1',
      'W1',
      'W6A',
    ]);
  });
});

describe('textLines', () => {
  it('groups runs into positioned reading lines', () => {
    const lines = textLines([
      { str: 'CONSTRUCTION', x: 300, y: 100.4, size: 8 },
      { str: 'TYPE', x: 20, y: 100, size: 8 },
      { str: 'W1', x: 20, y: 140, size: 10 },
    ]);
    expect(lines).toEqual(['y100: [x20] TYPE  [x300] CONSTRUCTION', 'y140: [x20] W1']);
  });
});

describe('multi-layer board', () => {
  it('counts "2 LAYERS" of board twice', () => {
    const w1b: ExtractedAssembly = {
      code: 'W1B',
      category: 'interior_wall',
      title: '1HR F.R.R.',
      layers: [
        { material: '2 LAYERS 16mm TYPE X GYPSUM BOARD', role: 'board', thickness_mm: 32, spacing_mm: null },
        { material: '92mm METAL STUDS FRAMING @ 610mm O.C.', role: 'framing', thickness_mm: 92, spacing_mm: 610 },
      ],
      total_thickness_mm: 125,
      notes: [],
    };
    const board = buildTakeoffType(w1b, 'metric', 0, 3).items.find((i) => i.name.startsWith('2 LAYERS'))!;
    expect(board.name).toContain('2 layers');
    expect((evaluate(board.formula, { A: 10 }) as { value: number }).value).toBeCloseTo(22);
  });
});


describe('legend request', () => {
  it('lists the printed tags as a checklist', async () => {
    const { legendRequest } = await import('../src/ai/prompt');
    const text = legendRequest('A0.2', ['y10: [x5] EW1C'], ['EW1C', 'R1']);
    expect(text).toContain('These type tags appear in the sheet');
    expect(text).toContain('EW1C, R1');
    expect(legendRequest('A0.2', [])).not.toContain('These type tags');
  });
});
