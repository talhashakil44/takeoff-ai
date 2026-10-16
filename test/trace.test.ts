import { describe, expect, it } from 'vitest';
import { polylineLength } from '../src/geometry';
import { linesLike, runLength, traceLine } from '../src/fill/trace';
import type { Segment } from '../src/fill/vectors';

const seg = (x1: number, y1: number, x2: number, y2: number, width = 0.5): Segment => ({ x1, y1, x2, y2, width, filled: false });

describe('trace a line', () => {
  it('follows a dashed polyline in one pen round its corners, from a click anywhere on it', () => {
    // An L of dashes: 0→100 along y=0 (dash 8, gap 2), then down to y=50.
    const dashes: Segment[] = [];
    for (let x = 0; x < 100; x += 10) dashes.push(seg(x, 0, x + 8, 0));
    dashes.push(seg(98, 0, 100, 0));
    for (let y = 0; y < 50; y += 10) dashes.push(seg(100, y + 2, 100, y + 10));
    const other = [seg(0, 20, 100, 20, 0.25), seg(50, -30, 50, 30, 0.25)];
    const line = traceLine([...dashes, ...other], [55, 1], 5)!;
    expect(line[0]).toEqual([0, 0]);
    expect(line[line.length - 1]).toEqual([100, 50]);
    expect(polylineLength(line)).toBeCloseTo(150, 0);
  });

  it('finds nothing far from any line', () => {
    expect(traceLine([seg(0, 0, 10, 0)], [5, 50], 5)).toBeNull();
  });
});

describe('every line like this', () => {
  const pipe = (x1: number, y1: number, x2: number, y2: number, sub: number, extra: Partial<Segment> = {}): Segment => ({ x1, y1, x2, y2, width: 0.96, filled: false, color: '#000000', sub, ...extra });
  const head = (x: number, y: number, sub: number) => [pipe(x - 4, y + 3.5, x + 4, y + 3.5, sub), pipe(x + 4, y + 3.5, x, y - 3.5, sub), pipe(x, y - 3.5, x - 4, y + 3.5, sub)];
  const segs: Segment[] = [
    // A main with a branch off it, in two pieces either side of the tee.
    pipe(100, 100, 300, 100, 1),
    pipe(300, 100, 500, 100, 2),
    pipe(300, 100, 300, 200, 3),
    // A sidewall head on the branch, drawn in the pipe's pen.
    ...head(300, 210, 4),
    // A wall in the same pen but grey ink.
    pipe(100, 120, 500, 120, 5, { color: '#989898' }),
    // A thinner line in black.
    pipe(100, 140, 500, 140, 6, { width: 0.48 }),
    // The sheet's frame, and a title block line.
    pipe(0, 2, 2835, 2, 7),
    pipe(2500, 100, 2500, 1900, 8),
  ];
  const sheet = { width: 2835, height: 2004 };

  it('measures the whole pipe network and nothing else', () => {
    const runs = linesLike(segs, [200, 101], 3, sheet, [[2420, 0, 2835, 2004]])!;
    const total = runs.reduce((n, r) => n + runLength(r), 0);
    expect(Math.round(total)).toBe(500);
    // Broken at the tee: the main either side and the branch.
    expect(runs.length).toBe(3);
  });

  it('finds nothing away from any line', () => {
    expect(linesLike(segs, [1000, 1000], 3, sheet)).toBeNull();
  });
});
