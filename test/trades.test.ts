import { describe, expect, it } from 'vitest';
import { isDemoPlan, keynoteList, removed } from '../src/automate/keynotes';
import { blobs, scheduleTags } from '../src/automate/trades';
import { chainRuns, dashLines, ductSizes, joinRuns, pairParallels, sizeRuns, withoutSymbols } from '../src/fill/runs';
import type { Segment } from '../src/fill/vectors';
import { baseLayer, isBackground, layerService, layerStatus } from '../src/layers';
import type { PageText } from '../src/pageText';
import type { Project, Sheet, TakeoffType } from '../src/model';
import type { SetAccess } from '../src/automate/set';

const seg = (x1: number, y1: number, x2: number, y2: number, extra: Partial<Segment> = {}): Segment => ({ x1, y1, x2, y2, width: 0.5, filled: false, ...extra });
const text = (str: string, x0: number, cy: number, h = 6): PageText => ({ str, cx: x0 + (str.length * h * 0.6) / 2, cy, w: str.length * h * 0.6, h });

describe('layers', () => {
  it('reads what a layer is and whether it is new, to remove or existing', () => {
    expect(layerService('Ductwork')?.kind).toBe('duct');
    expect(layerService('Duct-Hidden')?.key).toBe('duct');
    expect(layerService('Wat-Cold-Demo')?.key).toBe('dcw');
    expect(layerService('Wat-Recirc')?.key).toBe('dhwr');
    expect(layerService('San-B')?.key).toBe('san');
    expect(layerService('Stm-A-Exist')?.key).toBe('storm');
    expect(layerService('Heating')?.key).toBe('heating');
    expect(layerService('Alarm')?.key).toBe('alarm');
    expect(layerService('Fire')?.key).toBe('fire');
    expect(layerService('M-HVAC-DUCT-ANNO')).toBeNull();
    expect(layerService('2026-10-02-FloorPlan-LEVEL1FLOORPLAN|A-WALL')).toBeNull();
    expect(layerService('A-DETL-DEMO')?.key).toBe('arch-demo');
    expect(layerStatus('Wat-Cold-Demo')).toBe('demo');
    expect(layerStatus('26223 Existing M6.1|Ductwork - Hidden Exist')).toBe('exist');
    expect(layerStatus('Ductwork-EXIST')).toBe('exist');
    expect(layerStatus('Ductwork')).toBe('new');
    expect(baseLayer('26223 Existing M6.1|Ductwork-Exist')).toBe('Ductwork-Exist');
    expect(isBackground('xx26223 TB|Border3')).toBe(true);
  });
});

describe('runs', () => {
  it('joins a pipe drawn in pieces into one run and drops the short ticks', () => {
    const runs = chainRuns([seg(0, 0, 50, 0), seg(50, 0, 100, 0), seg(100, 0, 100, 40), seg(200, 200, 202, 200)], 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual([
      [0, 0],
      [100, 0],
      [100, 40],
    ]);
  });

  it('pairs a duct\'s two sides into its centreline and width, and sizes it by the label along it', () => {
    // A 24" duct at 1/8" = 1'-0" (0.75 pt to the inch), one side broken by a branch.
    const sides = [seg(0, 0, 300, 0), seg(0, 18, 140, 18), seg(160, 18, 300, 18)];
    const runs = pairParallels(sides, 2, 60, 10);
    expect(runs.reduce((n, r) => n + Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]), 0)).toBeCloseTo(280, 0);
    expect(runs.every((r) => Math.abs(r.width - 18) < 1e-6 && Math.abs(r.a[1] - 9) < 1e-6)).toBe(true);
    const sizes = ductSizes([text('24x12', 60, 30), text('8"ø', 250, 80)]);
    expect(sizes.map((s) => s.text)).toEqual(['24x12', '8"ø']);
    const sized = sizeRuns(runs, sizes, 0.75);
    expect(sized.map((s) => s?.text)).toEqual(['24x12', '24x12']);
  });

  it('leaves a diffuser drawn on the duct layer out of the ducts', () => {
    const box = [seg(0, 0, 20, 0, { sub: 1 }), seg(20, 0, 20, 20, { sub: 1 }), seg(20, 20, 0, 20, { sub: 1 }), seg(0, 20, 0, 0, { sub: 1 })];
    expect(withoutSymbols([...box, seg(0, 50, 300, 50, { sub: 2 })], 30)).toHaveLength(1);
  });

  it('joins dashes drawn one by one into a dashed line', () => {
    const dashes = [0, 1, 2, 3, 4].map((i) => seg(813, 500 + i * 14, 813, 509 + i * 14));
    const lines = dashLines(dashes, 20);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ x1: 813, y1: 500, x2: 813, y2: 565, dashed: true });
  });
});

describe('schedules and keynotes', () => {
  it('reads a schedule\'s tag column, of any family', () => {
    const texts = [
      text('PLUMBING FIXTURE SCHEDULE', 100, 100, 8),
      text('WC-1', 100, 130),
      text('WATER CLOSET FLUSH', 140, 130),
      text('L-1', 100, 150),
      text('COUNTER MOUNTED LAV', 140, 150),
      text('FD-1', 100, 170),
      text('FLOOR DRAIN', 140, 170),
    ];
    expect(scheduleTags(texts).map((r) => `${r.code} ${r.description}`)).toEqual(['WC-1 WATER CLOSET FLUSH', 'L-1 COUNTER MOUNTED LAV', 'FD-1 FLOOR DRAIN']);
  });

  it('reads a keynote list (numbers alone, words beside), not general notes', () => {
    const texts = [
      text('1.', 50, 50),
      text('DO NOT DAMAGE EXISTING BUILDING.', 70, 50),
      text('1', 50, 100),
      text('REMOVE AND DISPOSE OF EXISTING CMU AS REQUIRED.', 80, 100),
      text('2', 50, 130),
      text('REMOVE AND DISPOSE OF EXISTING HOLLOW METAL DOOR AND FRAME.', 80, 130),
      text('REMOVE EXISTING BULLNOSE BLOCK.', 80, 140),
      text('3', 50, 170),
      text('REMOVE AND DISPOSE OF EXISTING FLOORING AND BASE.', 80, 170),
    ];
    const notes = keynoteList(texts);
    expect(notes.map((n) => n.number)).toEqual(['1', '2', '3']);
    expect(notes[1].text).toBe('REMOVE AND DISPOSE OF EXISTING HOLLOW METAL DOOR AND FRAME. REMOVE EXISTING BULLNOSE BLOCK.');
  });

  it('reads a note whose number sits beside its middle, and skips legend pointers and note 0', () => {
    const t = (str: string, x0: number, cy: number) => text(str, x0, cy, 6.2);
    // Numbers centred on notes of several lines, a blank line between notes.
    const texts = [
      t('1', 10, 149), t('Remove door, frame, and hardware complete, and', 30, 141), t('dispose. Enlarge the opening to suit new frame.', 30, 150), t('See Openings Schedule.', 30, 159),
      t('2', 10, 185), t('Remove door and hardware, and dispose.', 30, 181), t('Existing frame to remain.', 30, 190),
      t('3', 10, 218), t('Disconnect and remove light fixtures in accordance with', 30, 209), t('Electrical Lighting Plan.', 30, 218), t('See also Electrical documents.', 30, 227),
      t('4', 10, 248), t('Remove all washrooms accessories, and dispose.', 30, 245),
      // A symbol legend: pointers to other sheets, one numbered 0.
      t('0', 400, 140), t('Floor Types, see A000 series Sheets', 420, 140), t('5', 400, 160), t('Building Elevation See A300 series Sheets', 420, 160), t('6', 400, 180), t('Wall Section See A600 series Sheets', 420, 180),
    ];
    const notes = keynoteList(texts);
    expect(notes.map((n) => n.number)).toEqual(['1', '2', '3', '4']);
    expect(notes[0].text).toBe('Remove door, frame, and hardware complete, and dispose. Enlarge the opening to suit new frame. See Openings Schedule.');
    expect(notes[2].text.startsWith('Disconnect and remove light fixtures')).toBe(true);
  });

  it('reads what a removal note removes, and a pointer to removals plans is no removals plan', () => {
    expect(removed('Remove and dispose floor finish c/w base and make good all wood subfloors and wall substrates')).toBe('floor finish');
    expect(removed('Remove partitions, and dispose. Make good all subfloors')).toBe('partitions');
    expect(removed('REMOVE AND DISPOSE OF EXISTING WOOD FLOORING AND BASE.')).toBe('WOOD FLOORING AND BASE');
    const sheet = { id: 's', name: 'A011', title: 'OBC Matrix and Information', metersPerPoint: 0.03 } as never;
    const titled = (str: string) => ({ str, cx: 100, cy: 100, w: 200, h: 12.6 }) as PageText;
    expect(isDemoPlan(sheet, [titled('For Floor Plan Removals see A200 series Sheets')])).toBe(false);
    expect(isDemoPlan({ ...(sheet as object), name: 'A201', title: 'Basement Floor Removals Plan' } as never, [])).toBe(true);
  });

  it('finds each fixture drawn on a demolition layer once', () => {
    const fixture = (x: number, sub: number) => [seg(x, 0, x + 10, 0, { sub }), seg(x + 10, 0, x + 10, 20, { sub }), seg(x + 10, 20, x, 20, { sub }), seg(x, 20, x, 0, { sub })];
    expect(blobs([...fixture(0, 1), ...fixture(100, 2), seg(2, 2, 8, 18, { sub: 3 })], 3, 5, 60)).toHaveLength(2);
  });
});

describe('joining runs', () => {
  it('joins runs broken in line and leaves a branch alone', () => {
    const joined = joinRuns(
      [
        [
          [0, 0],
          [50, 0],
        ],
        [
          [55, 0],
          [100, 0],
        ],
        [
          [100, 5],
          [100, 60],
        ],
      ],
      10,
      1,
    );
    expect(joined).toHaveLength(2);
    expect(joined[0]).toEqual([
      [0, 0],
      [100, 0],
    ]);
  });
});

describe('structural counts the other takeoffs already have', () => {
  it('counts a schedule tag once: not again where the foundations or structure took that code, nor a wall assembly', async () => {
    const { automateTrades } = await import('../src/automate/trades');
    const sched = { id: 's0', docId: 'd', page: 1, name: 'S0.2', title: 'SCHEDULES', width: 2592, height: 1728, metersPerPoint: null } as unknown as Sheet;
    const fdn = { id: 's1', docId: 'd', page: 2, name: 'S1.0', title: 'FOUNDATION PLAN', width: 2592, height: 1728, metersPerPoint: 0.0353 } as unknown as Sheet;
    const flr = { id: 's2', docId: 'd', page: 3, name: 'S2.0', title: 'FLOOR FRAMING PLAN', width: 2592, height: 1728, metersPerPoint: 0.0353 } as unknown as Sheet;
    const texts: Record<string, PageText[]> = {
      s0: [
        text('WOOD LINTEL SCHEDULE', 100, 100, 10), text('L1', 100, 140), text('2 - 38x184 (2x8)', 160, 140), text('L2', 100, 160), text('4 PLY LVL', 160, 160),
        text('STRUCTURAL WALL SCHEDULE', 100, 400, 10), text('WT-1', 100, 440), text('11 OSB SHEATHING', 160, 440), text('WT-2', 100, 460), text('13 PLYWOOD', 160, 460),
      ],
      s1: [text('FOUNDATION PLAN', 400, 1500, 10), text('L1', 600, 600)],
      s2: [text('FLOOR FRAMING PLAN', 400, 1500, 10), text('L1', 600, 600), text('L2', 900, 600), text('WT-1', 700, 800)],
    };
    const lintel = { id: 't1', name: 'L1 – Lintel 2 - 38x184 (2x8)', kind: 'count', color: '#000', height: 0, items: [] } as unknown as TakeoffType;
    const p = {
      sheets: [sched, fdn, flr],
      types: [lintel],
      measurements: [{ id: 'm1', sheetId: 's2', typeId: 't1', points: [[600, 610]], holes: [], source: 'structure' }],
    } as unknown as Project;
    const access = { texts: async (s: Sheet) => texts[s.id], segments: async () => [], layers: async () => new Map(), page: async () => null } as unknown as SetAccess;
    const r = await automateTrades(p, access);
    const q = r.apply!(p);
    const made = q.measurements.filter((m) => m.source === 'trades').map((m) => `${q.sheets.find((s) => s.id === m.sheetId)!.name} ${q.types.find((t) => t.id === m.typeId)!.name.split(' – ')[0]}`);
    // L1 on S2.0 is the structure takeoff's; L1 on S1.0 is not taken there; WT-1 is a wall assembly.
    expect(made.sort()).toEqual(['S1.0 L1', 'S2.0 L2']);
  });
});
