import { describe, expect, it } from 'vitest';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';
import { checkScale, dimensionMeters } from '../src/scaleCheck';

const MPP = (100 * 0.0254) / 72; // 1:100
const pt = (m: number) => m / MPP;
const seg = (x1: number, y1: number, x2: number, y2: number): Segment => ({ x1, y1, x2, y2, width: 0.25, filled: false });

describe('scale check from dimension strings', () => {
  it('reads values in millimetres and feet and inches', () => {
    expect(dimensionMeters('5300', 'metric')).toBe(5.3);
    // With a thousands separator, as many offices print them.
    expect(dimensionMeters('18,371', 'metric')).toBe(18.371);
    expect(dimensionMeters('2,438', 'metric')).toBe(2.438);
    expect(dimensionMeters('12', 'metric')).toBeNull();
    expect(dimensionMeters("12'-6\"", 'imperial')).toBeCloseTo(3.81, 2);
    expect(dimensionMeters("3'-0 1/2\"", 'imperial')).toBeCloseTo(0.927, 3);
  });

  it('finds the scale most dimensions agree on', () => {
    const texts: PageText[] = [];
    const segs: Segment[] = [];
    // Five horizontal dimensions drawn at 1:100, text just above each line.
    [5300, 4240, 2650, 1860, 3000].forEach((mm, i) => {
      const y = 100 + i * 40;
      segs.push(seg(100, y, 100 + pt(mm / 1000), y));
      texts.push({ str: String(mm), cx: 100 + pt(mm / 2000), cy: y - 4, w: 14, h: 5 });
    });
    // One figure that is not a dimension of its line.
    segs.push(seg(100, 400, 200, 400));
    texts.push({ str: '9999', cx: 150, cy: 396, w: 14, h: 5 });
    const r = checkScale(texts, segs, 'metric')!;
    expect(r.label).toBe('1:100');
    expect(r.agree).toBe(5);
    expect(r.read).toBe(6);
  });

  it('reads feet and inches on a project set to metric', () => {
    const mpp = (48 * 0.0254) / 72; // 1/4" = 1'-0"
    const texts: PageText[] = [];
    const segs: Segment[] = [];
    [
      ["12'-6\"", 3.81],
      ["8'-0\"", 2.4384],
      ["15'-3\"", 4.6482],
      ["10'-0\"", 3.048],
    ].forEach(([str, m], i) => {
      const y = 100 + i * 40;
      const len = (m as number) / mpp;
      segs.push(seg(100, y, 100 + len, y));
      texts.push({ str: str as string, cx: 100 + len / 2, cy: y - 4, w: 18, h: 5 });
    });
    const r = checkScale(texts, segs, 'metric')!;
    expect(r.metersPerPoint).toBeCloseTo(mpp, 8);
    expect(r.agree).toBe(4);
  });
});
