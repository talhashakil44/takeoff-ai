import { describe, expect, it } from 'vitest';
import { background, inlineRun, leaderTip, oneRunPerPipe, pipeTag, spreadLabels } from '../src/automate/pipes';
import type { InkRun } from '../src/fill/inkRuns';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';

const run = (x1: number, y1: number, x2: number, y2: number, width = 1.3, hatch: [number, number] = [0, 0]): InkRun => ({ a: [x1, y1], b: [x2, y2], width, hatch });
const seg = (x1: number, y1: number, x2: number, y2: number): Segment => ({ x1, y1, x2, y2, width: 0.6, filled: false, color: '#000000' }) as Segment;

describe('pipes by label', () => {
  it('reads pipe labels, metric and imperial, by their service', () => {
    expect(pipeTag('75Ø DCW')).toMatchObject({ size: 75, code: 'DCW', existing: false });
    expect(pipeTag('50mmØ SAN')).toMatchObject({ size: 50, code: 'SAN' });
    expect(pipeTag('75Ø INCOMING DCW LINE FROM WELL')).toMatchObject({ size: 75, code: 'DCW' });
    expect(pipeTag('1-1/2"ø HWS')).toMatchObject({ size: 38, code: 'HWS', says: '1-1/2"' });
    expect(pipeTag('Ex. 4"ø STM piping')).toMatchObject({ size: 102, code: 'STM', existing: true });
    expect(pipeTag("'D1'-150Ø-70 L/s")).toBeNull();
    expect(pipeTag('300x300 S/A')).toBeNull();
    expect(pipeTag('100Ø')).toBeNull();
  });

  it('follows a leader from its label to the arrow, not back up the arrowhead', () => {
    const t = { str: '100Ø HGS', cx: 664, cy: 432.4, w: 32.4, h: 5.6 } as PageText;
    const leaders = [seg(680.2, 432.7, 693.1, 432.7), seg(693.1, 464.9, 693.1, 432.7), seg(693.1, 464.9, 691.2, 457.8), seg(693.1, 464.9, 695, 457.8)];
    const tip = leaderTip(t, leaders)!;
    expect(tip[0]).toBeCloseTo(693.1, 1);
    expect(tip[1]).toBeCloseTo(464.9, 1);
  });

  it('carries a label along its pipe through bends before branches, and not round a hatched outline', () => {
    const runs = [
      run(0, 0, 100, 0), // 0: labelled 75
      run(100, 0, 100, 80), // 1: bend on from 0
      run(50, 0, 50, 40), // 2: branch off 0, labelled 25
      run(50, 40, 50, 90), // 3: on from 2
      run(100, 80, 300, 80, 2.4, [0.08, 0]), // 4: an outline round a hatched area
    ];
    const label = spreadLabels(runs, new Map([[0, 0], [2, 1]]), 12);
    expect(label).toEqual([0, 0, 1, 1, -1]);
  });

  it('leaves out what every sibling plan draws too', () => {
    const mine = [run(0, 0, 500, 0), run(10, 50, 90, 50)];
    const bg = background(mine, [[run(0, 0.5, 500, 0.5)]]);
    expect(bg).toEqual([true, false]);
  });

  it('reads a pipe drawn double as one run', () => {
    const runs = [run(0, 10, 100, 10, 3), run(0, 9, 100, 9, 1), run(0, 11.2, 98, 11.2, 1), run(0, 30, 100, 30, 1.3)];
    expect(oneRunPerPipe(runs)).toEqual([runs[0], runs[3]]);
  });
  it('finds the pipe a label is written in the line of', () => {
    // "75Ø SAN" written vertically in a pipe's line, breaking it at y 100–130.
    const t: PageText = { str: '75Ø SAN', cx: 200, cy: 115, w: 30, h: 5, angle: Math.PI / 2 };
    const runs: InkRun[] = [
      { a: [200, 20], b: [200, 98], width: 2 }, // the pipe above the label
      { a: [208, 132], b: [208, 220], width: 2 }, // a pipe beside, off its centreline
      { a: [140, 100], b: [196, 100], width: 2 }, // a pipe ending at the label, across it
    ];
    expect(inlineRun(t, runs)).toBe(0);
    expect(inlineRun(t, runs.slice(1))).toBe(-1);
  });
});
