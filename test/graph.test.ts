import { describe, expect, it } from 'vitest';
import type { SetAccess } from '../src/automate/set';
import type { Segment } from '../src/fill/vectors';
import { buildGraph, linkRows, sheetEdges } from '../src/graph/graph';
import { findViews } from '../src/graph/views';
import type { Sheet } from '../src/model';
import type { PageText } from '../src/pageText';

const text = (str: string, x0: number, cy: number, h = 6): PageText => ({ str, cx: x0 + (str.length * h * 0.6) / 2, cy, w: str.length * h * 0.6, h });
const sheet = (id: string, name: string, title = ''): Sheet => ({ id, docId: 'd', page: 1, name, title, width: 2000, height: 1400, metersPerPoint: null, scaleLabel: null, scaleSource: null, scaleHints: [] });

describe('views', () => {
  it('finds a drawing by its title: the number in its bubble, its name, its scale', () => {
    const texts = [text('5', 100, 610, 20), text('PARTITION AT CONCRETE', 140, 590, 12), text('PLAN DETAIL', 140, 604, 12), text('SCALE: 1 1/2" = 1\'-0"', 140, 622, 6)];
    const [v] = findViews(texts, 2000, 1400);
    expect(v.number).toBe('5');
    expect(v.title).toBe('PARTITION AT CONCRETE PLAN DETAIL');
  });

  it('reads a number written into the title (C-UNIVERSAL WASHROOM)', () => {
    const texts = [text('C-UNIVERSAL WASHROOM 029', 690, 491, 11), text('SCALE:', 651, 506, 6), text('1/4" = 1\'-0"', 680, 506, 6)];
    const [v] = findViews(texts, 2000, 1400);
    expect([v.number, v.title]).toEqual(['C', 'UNIVERSAL WASHROOM 029']);
  });
});

describe('graph', () => {
  it('links bubbles to the drawing they point at, notes to sheets and schedules, and back again', async () => {
    const plan = sheet('p', 'A1.3', 'FLOOR PLAN');
    const details = sheet('d', 'A5.0', 'DETAILS');
    const struct = sheet('s', 'S1.0', 'STRUCTURAL PLAN');
    const sched = sheet('x', 'A6.1', 'SCHEDULES');
    const texts: Record<string, PageText[]> = {
      p: [text('5', 500, 489), text('A5.0', 494, 500), text('STEEL BEAM PER STRUCTURAL', 800, 300), text('SEE A5.0 FOR BLOCKING', 800, 340), text('HARDWARE PER DOOR SCHEDULE', 800, 380)],
      d: [text('5', 100, 610, 20), text('PARTITION AT CONCRETE PLAN DETAIL', 140, 600, 12), text('SCALE: 1 1/2" = 1\'-0"', 140, 622, 6)],
      s: [text('LEVEL 1 STRUCTURAL PLAN', 140, 600, 12)],
      x: [text('DOOR SCHEDULE', 200, 80, 12), text('NO.', 110, 140), text('MATERIAL', 163, 140, 5), text('D101', 104, 162), text('HM', 164, 162), text('D102', 104, 182), text('WD', 164, 182)],
    };
    const sheets = [plan, details, struct, sched];
    const access: SetAccess = { page: async () => null, texts: async (s) => texts[s.id], segments: async () => [] as Segment[] };
    const g = await buildGraph(sheets, access);
    const on = g.links.p;
    const bubble = on.find((l) => l.kind === 'callout' && l.label === '5/A5.0')!;
    expect(bubble.to[0].sheetId).toBe('d');
    expect(bubble.to[0].label).toContain('PARTITION AT CONCRETE PLAN DETAIL');
    expect(on.find((l) => l.kind === 'sheet' && l.label === 'A5.0')?.to[0].sheetId).toBe('d');
    expect(on.find((l) => /STRUCTURAL/.test(l.label))?.to.map((p) => p.sheetId)).toEqual(['s']);
    expect(on.find((l) => l.kind === 'schedule')?.to[0].sheetId).toBe('x');
    // The drawing's title links back to the bubble.
    const back = g.links.d.find((l) => l.kind === 'view')!;
    expect(back.to.map((p) => p.sheetId)).toEqual(['p']);
    expect(sheetEdges(g).find((e) => e.from === 'p' && e.to === 'd')?.n).toBe(2);
    expect(linkRows(g).length).toBeGreaterThanOrEqual(4);
  });
});
