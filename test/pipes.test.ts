import { describe, expect, it } from 'vitest';
import { background, leaderTip, pipeTag, spreadLabels } from '../src/automate/pipes';
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
});
