import { describe, expect, it } from 'vitest';
import { polylineLength } from '../src/geometry';
import type { Segment } from '../src/fill/vectors';
import { bridgeGaps } from '../src/fill/walls';
import { combineWallKeys, parseWallRows, scoreWalls } from '../src/eval/wallKey';
import { findWallRuns } from '../src/walls/bands';
import { runsToLines } from '../src/walls/runsToLines';
import { resolveTags, type TagText } from '../src/walls/tags';
import { lengthsByType, tagKind, wallTakeoff } from '../src/walls/wallTakeoff';

/** 1:100 metric: metres per sheet point. */
const MPP = (100 * 0.0254) / 72;
const pt = (m: number) => m / MPP;
const T = 0.124; // W1: 16 + 92 + 16

/** A polyline in metres, as wall-pen segments in sheet points. */
function poly(width: number, ...pts: [number, number][]): Segment[] {
  return pts.slice(1).map((p, i) => ({ x1: pt(pts[i][0]), y1: pt(pts[i][1]), x2: pt(p[0]), y2: pt(p[1]), width, filled: false }));
}
const wall = (...pts: [number, number][]) => poly(0.57, ...pts);

/** An L of two walls: 5 m along the top, 4 m down the left side (outer dimensions). */
function lShape(): Segment[] {
  return [
    ...wall([5, 0], [0, 0], [0, 4]),
    ...wall([5, T], [T, T], [T, 4]),
    ...wall([5, 0], [5, T]),
    ...wall([0, 4], [T, 4]),
  ];
}

/** A diamond tag around (x, y) metres with a leader to (lx, ly). */
function tag(code: string, x: number, y: number, leaderTo?: [number, number]): { text: TagText; segs: Segment[] } {
  const r = 0.45; // half-diagonal in metres (13 pt)
  const segs = poly(0.51, [x, y - r], [x + r, y], [x, y + r], [x - r, y], [x, y - r]);
  if (leaderTo) segs.push(...poly(0.51, [x, y + r], leaderTo));
  return { text: { code, cx: pt(x), cy: pt(y), w: 10.6, h: 4.9 }, segs };
}

const meters = (runs: { a: number[]; b: number[] }[]) => runs.reduce((n, r) => n + Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]), 0) * MPP;

describe('wall bands', () => {
  it('finds a straight wall as one centreline with its thickness', () => {
    const runs = findWallRuns([...wall([0, 0], [5, 0]), ...wall([0, T], [5, T])], pt(0.05), pt(0.65));
    expect(runs).toHaveLength(1);
    expect(runs[0].thickness * MPP).toBeCloseTo(T, 3);
    expect(meters(runs)).toBeCloseTo(5, 2);
    expect(runs[0].a[1] * MPP).toBeCloseTo(T / 2, 4);
  });

  it('carries a wall through a door once the opening is bridged', () => {
    const faces = [...wall([0, 0], [2, 0]), ...wall([2.9, 0], [5, 0]), ...wall([0, T], [2, T]), ...wall([2.9, T], [5, T])];
    expect(findWallRuns(faces, pt(0.05), pt(0.65))).toHaveLength(2);
    const bridged = [...faces, ...bridgeGaps(faces, pt(3))];
    const runs = findWallRuns(bridged, pt(0.05), pt(0.65));
    expect(runs).toHaveLength(1);
    expect(meters(runs)).toBeCloseTo(5, 2);
  });

  it('ignores parallel lines too far apart to be a wall', () => {
    expect(findWallRuns([...wall([0, 0], [5, 0]), ...wall([0, 2], [5, 2])], pt(0.05), pt(0.65))).toHaveLength(0);
  });
});

describe('wall takeoff', () => {
  it('measures an L on the centreline, corner to corner', () => {
    const { runs } = wallTakeoff(lShape(), lShape(), [], MPP);
    expect(meters(runs)).toBeCloseTo(9 - T, 2);
  });

  it('types the tagged wall and carries the type round the corner', () => {
    const t = tag('W1', 2.5, 1.5, [2.5, T]);
    const lines = [...lShape(), ...t.segs];
    const res = wallTakeoff(lShape(), lines, [t.text], MPP);
    expect(res.unmatched).toHaveLength(0);
    const by = lengthsByType(res.runs, MPP);
    expect(by.get('W1')?.length).toBeCloseTo(9 - T, 2);
    expect(res.runs.filter((r) => r.how === 'tag')).toHaveLength(1);
    expect(res.runs.filter((r) => r.how === 'carried').length).toBeGreaterThan(0);
  });

  it('runs a wall that meets another into its centreline, and keeps types apart', () => {
    // Top wall 5 m (W2), and a stem down from its inside face at x = 2.5 m (W1), 3 m long.
    const s = 2.5 - T / 2;
    const lines = [
      ...wall([0, 0], [5, 0]),
      ...wall([0, T], [s, T]),
      ...wall([s + T, T], [5, T]),
      ...wall([s, T], [s, 3]),
      ...wall([s + T, T], [s + T, 3]),
      ...wall([s, 3], [s + T, 3]),
      ...wall([0, 0], [0, T]),
      ...wall([5, 0], [5, T]),
    ];
    const model = [...lines, ...bridgeGaps(lines, pt(3))];
    const top = tag('W2', 1, 1, [1, T]);
    const stem = tag('W1', 1.5, 2, [s, 2]);
    const res = wallTakeoff(model, [...lines, ...top.segs, ...stem.segs], [top.text, stem.text], MPP);
    const by = lengthsByType(res.runs, MPP);
    expect(by.get('W2')?.length).toBeCloseTo(5, 2);
    // From the top wall's centreline (T/2 down) to the stem's end at 3 m.
    expect(by.get('W1')?.length).toBeCloseTo(3 - T / 2, 2);
  });

  it('takes any type code (VS1 shaftwall) tagged onto a wall, and ignores stray codes', () => {
    const vs = tag('VS1', 2.5, 1.5, [2.5, T]);
    const stair = tag('ST1', 2.5, 8); // a stair tag: a code in a symbol, no leader
    const far = tag('FE1', 2.5, 9, [2.5, 8.5]); // equipment, its leader on no wall
    const res = wallTakeoff(lShape(), [...lShape(), ...vs.segs, ...stair.segs, ...far.segs], [vs.text, { ...stair.text, generic: true }, { ...far.text, generic: true }].map((t, i) => (i === 0 ? { ...t, generic: true } : t)), MPP);
    expect(lengthsByType(res.runs, MPP).get('VS1')?.length).toBeCloseTo(9 - T, 2);
    expect(res.unmatched).toHaveLength(0);
  });

  it('reports tags that point at no wall', () => {
    const t = tag('EW3A', 2.5, 8, [2.5, 7]);
    const res = wallTakeoff(lShape(), [...lShape(), ...t.segs], [t.text], MPP);
    expect(res.unmatched.map((u) => u.code)).toEqual(['EW3A']);
  });

  it('measures a wall drawn in light lines when a tag points at it', () => {
    // An exterior wall "below", drawn as two light lines 0.3 m apart with mullion ticks.
    const light = [...poly(0.28, [0, 6], [8, 6]), ...poly(0.28, [0, 6.3], [8, 6.3])];
    for (let x = 0.5; x < 8; x += 1) light.push(...poly(0.28, [x, 6], [x, 6.3]));
    const t = tag('EW3A', 4, 4.5, [4, 6]);
    const res = wallTakeoff(lShape(), [...lShape(), ...light, ...t.segs], [t.text], MPP);
    expect(res.unmatched).toHaveLength(0);
    const run = res.runs.find((r) => r.tags.includes('EW3A'))!;
    expect(run.light).toBe(true);
    expect(meters([run])).toBeCloseTo(8, 2);
    expect(run.thickness * MPP).toBeCloseTo(0.3, 2);
  });

  it('can leave door openings out of partitions', () => {
    const faces = [...wall([0, 0], [2, 0]), ...wall([2.9, 0], [5, 0]), ...wall([0, T], [2, T]), ...wall([2.9, T], [5, T])];
    const lines = [...faces, ...bridgeGaps(faces, pt(3))];
    const door = [
      [pt(2), 0],
      [pt(2.9), 0],
      [pt(2.9), pt(T)],
      [pt(2), pt(T)],
    ] as [number, number][];
    const t = tag('W1', 1, 1.5, [1, T]);
    const all = [...lines, ...t.segs];
    const through = wallTakeoff(lines, all, [t.text], MPP, { doors: [door] });
    expect(lengthsByType(through.runs, MPP).get('W1')?.length).toBeCloseTo(5, 2);
    const cut = wallTakeoff(lines, all, [t.text], MPP, { doors: [door], throughDoors: false });
    expect(lengthsByType(cut.runs, MPP).get('W1')).toMatchObject({ runs: 2 });
    expect(lengthsByType(cut.runs, MPP).get('W1')?.length).toBeCloseTo(4.1, 2);
  });

  it('keeps two exterior types tagged on one wall (a screen wall over the wall below)', () => {
    const a = tag('EW6A', 1.5, 1.5, [1.5, T]);
    const b = tag('EW6B', 3.5, 1.5, [3.5, T]);
    const res = wallTakeoff(lShape(), [...lShape(), ...a.segs, ...b.segs], [a.text, b.text], MPP);
    const by = lengthsByType(res.runs, MPP);
    expect(by.get('EW6A')?.length).toBeGreaterThan(4.8);
    expect(by.get('EW6B')?.length).toBeGreaterThan(4.8);
  });

  it('gives a furring tag pointing into a column to the furring wrapped round it', () => {
    const F = 0.06;
    // Furring wrapped round a column: a ring of thin walls. The column between its inner
    // faces reads as a thick wall too, and that is where the tag's leader ends.
    const ring = [...wall([0, 0], [0.54, 0], [0.54, 1], [0, 1], [0, 0]), ...wall([F, F], [0.54 - F, F], [0.54 - F, 1 - F], [F, 1 - F], [F, F])];
    const t = tag('FR2', -1.2, 0.5, [0.27, 0.5]);
    const res = wallTakeoff(ring, [...ring, ...t.segs], [t.text], MPP);
    const by = lengthsByType(res.runs, MPP);
    // The ring's centreline: 2 × (0.48 + 0.94).
    expect(by.get('FR2')?.length).toBeCloseTo(2.84, 1);
  });

  it('carries an exterior type along a wall broken by a pier and stepping slightly', () => {
    const t1 = 0.3;
    const t2 = 0.34;
    // Two lengths of one foundation wall, 0.3 m apart at a pier, the second a little thicker.
    const walls = [...wall([0, 0], [5, 0]), ...wall([0, t1], [5, t1]), ...wall([5.3, -0.02], [10, -0.02]), ...wall([5.3, t2 - 0.02], [10, t2 - 0.02])];
    const t = tag('EW1', 8, 1.5, [8, t2 - 0.02]);
    const res = wallTakeoff(walls, [...walls, ...t.segs], [t.text], MPP);
    expect(lengthsByType(res.runs, MPP).get('EW1')?.length).toBeCloseTo(10, 1);
  });

  it('sorts tags into kinds that do not compete', () => {
    expect(tagKind('EW3A')).toBe('exterior');
    expect(tagKind('FR1')).toBe('furring');
    expect(tagKind('W1A')).toBe('partition');
    expect(tagKind('CB2')).toBe('partition');
    expect(tagKind('EW-2A')).toBe('exterior');
    expect(tagKind('W-1')).toBe('partition');
  });
});

describe('tags', () => {
  it('follows the leader from the symbol, past furniture drawn under the tag', () => {
    const t = tag('FR1', 3, 3, [3, 2]);
    // A small closed shape (a chair) overlapping the diamond, in a lighter pen.
    const chair = poly(0.28, [3.1, 2.8], [3.6, 2.8], [3.6, 3.3], [3.1, 3.3], [3.1, 2.8]);
    const [r] = resolveTags([t.text], [...t.segs, ...chair, ...chair]);
    expect(r.leader).toBe(true);
    const end = r.paths[0][r.paths[0].length - 1];
    expect(end[0] * MPP).toBeCloseTo(3, 3);
    expect(end[1] * MPP).toBeCloseTo(2, 3);
  });

  it('a tag without a leader stays where it is', () => {
    const t = tag('W1', 3, 3);
    const [r] = resolveTags([t.text], t.segs);
    expect(r.leader).toBe(false);
  });
});

describe('runs to lines', () => {
  it('chains the pieces of a type into one polyline round corners', () => {
    const t = tag('W1', 2.5, 1.5, [2.5, T]);
    const res = wallTakeoff(lShape(), [...lShape(), ...t.segs], [t.text], MPP);
    const [w1] = runsToLines(res.runs);
    expect(w1.code).toBe('W1');
    expect(w1.lines).toHaveLength(1);
    expect(w1.lines[0]).toHaveLength(3);
    expect(polylineLength(w1.lines[0]) * MPP).toBeCloseTo(9 - T, 2);
  });
});

describe('wall answer key', () => {
  const rows = [
    ['Mark', 'Item', 'Type', 'Desc', 'Dwg', 'Package', 'Inst', 'Measured qty', 'Unit', 'Height (m)'],
    ['W1', 'W1 - interior', '', '', 'A2.1', '', 14, 68.704, 'M', 4],
    ['W1', 'W1 - interior', '', '', 'A2.2', '', 4, 19.063, 'M', 5],
    ['EW1A', 'stone North', '', '', 'A2.1', '', 2, 4.85, 'M', 4],
    ['EW1A', 'stone South', '', '', 'A2.1', '', 2, 11.59, 'M', 4],
    ['ARCH EW2', 'below grade', '', '', 'A2.0', '', 1, 41.511, 'M', 2.5],
    ['W5-VEN', 'veneer', '', '', 'A0.3', '', null, 48.8, 'M2', null],
    ['FR2', 'drywall', '', '', 'A2.1', '', 1, 10, 'FT', 4],
  ];

  it('sums wall rows per type and sheet, in metres', () => {
    const key = parseWallRows(rows);
    const get = (code: string, sheet: string) => key.find((e) => e.code === code && e.sheet === sheet)?.meters;
    expect(get('W1', 'A2.1')).toBeCloseTo(68.704);
    expect(get('EW1A', 'A2.1')).toBeCloseTo(16.44);
    expect(get('EW2', 'A2.0')).toBeCloseTo(41.511);
    expect(get('FR2', 'A2.1')).toBeCloseTo(3.048);
    expect(key.some((e) => e.code === 'W5')).toBe(false);
  });

  it('counts a wall priced on two tabs once', () => {
    const tab = parseWallRows(rows);
    expect(combineWallKeys([tab, tab]).find((e) => e.code === 'W1' && e.sheet === 'A2.1')?.meters).toBeCloseTo(68.704);
  });

  it('scores lengths per type for a sheet', () => {
    const { rows: r, error } = scoreWalls(parseWallRows(rows), 'A2.1', new Map([['W1', 70], ['W9', 2]]));
    expect(r.find((x) => x.code === 'W1')).toEqual({ code: 'W1', expected: 68.704, got: 70 });
    expect(r.find((x) => x.code === 'W9')?.expected).toBeNull();
    expect(error).toBeGreaterThan(0);
  });
});
