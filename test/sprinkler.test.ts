import { describe, expect, it } from 'vitest';
import type { PageText } from '../src/pageText';
import { pipeSizeOf, readSprinklerSheet, runsOf } from '../src/fill/sprinkler';
import type { Segment } from '../src/fill/vectors';

let sub = 1;
const line = (x1: number, y1: number, x2: number, y2: number, extra: Partial<Segment> = {}): Segment => ({ x1, y1, x2, y2, width: 0.96, filled: false, color: '#000000', sub: sub++, ...extra });
/** A sidewall head: a triangle in the pipe's pen, apex on the pipe end. */
const head = (x: number, y: number): Segment[] => {
  const s = sub++;
  return [line(x - 4, y + 7, x + 4, y + 7, { sub: s }), line(x + 4, y + 7, x, y, { sub: s }), line(x, y, x - 4, y + 7, { sub: s })];
};
const label = (str: string, cx: number, cy: number, angle = 0): PageText => ({ str, cx, cy, w: 6, h: 3.6, angle });

describe('fire sprinklers, with nothing marked', () => {
  // An 80 main along y = 100 with three 25 branches down to sidewall heads, one round a corner,
  // and the main capped at its far end. Walls in grey run alongside.
  const segs: Segment[] = [
    line(100, 100, 200, 100),
    line(200, 100, 300, 100),
    line(300, 100, 400, 100),
    line(200, 100, 200, 150),
    ...head(200, 150),
    line(300, 100, 300, 150),
    ...head(300, 150),
    line(400, 100, 400, 130),
    line(400, 130, 450, 130),
    line(450, 130, 450, 150),
    ...head(450, 150),
    line(100, 90, 500, 90, { color: '#989898' }),
    line(100, 110, 500, 110, { color: '#989898' }),
  ];
  const texts = [label('80', 150, 97), label('25', 197, 125, -Math.PI / 2)];
  const read = readSprinklerSheet(segs, texts, { width: 2835, height: 2004 })!;

  it('finds the heads and the pipe without being shown either', () => {
    expect(read.heads.map((g) => [g.shape, g.at.length])).toEqual([['triangle', 3]]);
    expect(read.network.style).toEqual({ width: 0.96, color: '#000000' });
  });

  it('sizes the pipe from its labels, carrying the main size straight on', () => {
    const bySize = new Map<string, number>();
    for (const p of read.network.pieces) bySize.set(p.size ?? '?', (bySize.get(p.size ?? '?') ?? 0) + Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]));
    // The main is 300 long; the branches 50 + 50 + 100 take the size labelled on one of them.
    expect(Math.round(bySize.get('80')!)).toBe(300);
    expect(Math.round(bySize.get('25')!)).toBe(200);
  });

  it('counts the fittings: two tees, an elbow at each corner, a capped end', () => {
    const kinds = read.network.fittings.map((f) => `${f.kind} ${f.size}`).sort();
    expect(kinds).toEqual(['cap 80', 'elbow 25', 'elbow 25', 'elbow 80', 'tee 80', 'tee 80']);
  });

  it('joins pieces of one size into runs', () => {
    expect(runsOf(read.network.pieces).filter((r) => r.size === '80')).toHaveLength(1);
  });

  it('reads pipe sizes as printed', () => {
    expect(['25', '100Ø', '40 mm', '1-1/4"', '2"', '12', '101'].map(pipeSizeOf)).toEqual(['25', '100', '40', '1-1/4"', '2"', null, null]);
  });
});
