import { describe, expect, it } from 'vitest';
import { sheetViews, viewScaleAt } from '../src/sheetViews';
import { measurementVars } from '../src/quantities';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';
import type { Measurement, Sheet, TakeoffType } from '../src/model';

const t = (str: string, cx: number, cy: number, h = 10): PageText => ({ str, cx, cy, w: str.length * h * 0.6, h, angle: 0 });
const line = (x1: number, y1: number, x2: number, y2: number): Segment => ({ x1, y1, x2, y2, width: 0.5, filled: false });
/** A drawing: a box with a grid of lines inside, from (x, y), w by h. */
const drawing = (x: number, y: number, w: number, h: number): Segment[] => {
  const out = [line(x, y, x + w, y), line(x + w, y, x + w, y + h), line(x + w, y + h, x, y + h), line(x, y + h, x, y)];
  for (let i = 1; i < 5; i++) out.push(line(x + (w * i) / 5, y, x + (w * i) / 5, y + h), line(x, y + (h * i) / 5, x + w, y + (h * i) / 5));
  return out;
};

describe('drawings at their own scales on one sheet', () => {
  // A 2592 x 1728 sheet: a low roof plan at 1:100 top right, a canopy plan at 1:50 bottom left,
  // a schedule with a detail's 1:25 beside it, and the sheet border.
  const W = 2592;
  const H = 1728;
  const segs = [
    ...drawing(1000, 80, 900, 400),
    ...drawing(180, 1180, 400, 360),
    ...drawing(160, 720, 400, 180),
    line(20, 20, W - 20, 20), line(W - 20, 20, W - 20, H - 20), line(W - 20, H - 20, 20, H - 20), line(20, H - 20, 20, 20),
  ];
  const texts = [
    t('LOW ROOF FRAMING PLAN', 1180, 519), t('SCALE: 1 : 100', 1130, 535, 5),
    t('CANOPY FRAMING PLAN', 360, 1573), t('SCALE: 1 : 50', 320, 1590, 5),
    t('MECHANICAL UNIT SCHEDULE', 340, 712), t('SCALE: 1 : 25', 215, 915, 5),
  ];

  it('reads each drawing with the scale under its title; a schedule, the border and title block are not drawings', () => {
    const views = sheetViews(texts, segs, W, H);
    expect(views.map((v) => [v.title, v.scaleLabel])).toEqual([
      ['LOW ROOF FRAMING PLAN', '1:100'],
      ['CANOPY FRAMING PLAN', '1:50'],
    ]);
    expect(views[0].box[0]).toBeLessThanOrEqual(1000);
    expect(views[0].box[2]).toBeGreaterThanOrEqual(1900);
  });

  it('measures a takeoff at the scale of the one drawing it lies in, never across two, and the sheet scale wins', () => {
    const views = sheetViews(texts, segs, W, H);
    expect(viewScaleAt(views, [[1100, 200], [1500, 200]])?.scaleLabel).toBe('1:100');
    expect(viewScaleAt(views, [[200, 1200]])?.scaleLabel).toBe('1:50');
    expect(viewScaleAt(views, [[1100, 200], [200, 1200]])).toBeNull();
    expect(viewScaleAt(views, [[2400, 1600]])).toBeNull();

    const sheet = { id: 's', metersPerPoint: null, views } as unknown as Sheet;
    const beam = { kind: 'linear', height: 0 } as TakeoffType;
    const m = { points: [[1100, 200], [1250, 200]], holes: [] } as unknown as Measurement;
    expect(measurementVars(m, beam, sheet, 'metric')?.L).toBeCloseTo(150 * (0.0254 / 72) * 100, 6);
    expect(measurementVars({ ...m, points: [[1100, 200], [200, 1200]] } as Measurement, beam, sheet, 'metric')).toBeNull();
    expect(measurementVars(m, beam, { ...sheet, metersPerPoint: 0.001 }, 'metric')?.L).toBeCloseTo(0.15, 6);
  });
});
