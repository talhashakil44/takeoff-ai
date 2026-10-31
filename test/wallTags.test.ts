import { describe, expect, it } from 'vitest';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';
import { tagTextsFrom } from '../src/walls/sheetWallTakeoff';
import { classifyCode, emptySetTypes, headingKind, readTagLegend, readTypeSheet, type SetTypes } from '../src/walls/setTypes';
import { resolveTags, WALL_TAG, type TagText } from '../src/walls/tags';
import { lengthsByType, tagKind, wallTakeoff } from '../src/walls/wallTakeoff';

/** 1:100 metric: metres per sheet point. */
const MPP = (100 * 0.0254) / 72;
const pt = (m: number) => m / MPP;
const T = 0.124;

function poly(width: number, ...pts: [number, number][]): Segment[] {
  return pts.slice(1).map((p, i) => ({ x1: pt(pts[i][0]), y1: pt(pts[i][1]), x2: pt(p[0]), y2: pt(p[1]), width, filled: false }));
}
const wall = (...pts: [number, number][]) => poly(0.57, ...pts);

/** An L of two walls: 5 m along the top, 4 m down the left side. */
function lShape(): Segment[] {
  return [...wall([5, 0], [0, 0], [0, 4]), ...wall([5, T], [T, T], [T, 4]), ...wall([5, 0], [5, T]), ...wall([0, 4], [T, 4])];
}

const R = 0.45; // half-diagonal of a tag diamond, metres
const diamond = (x: number, y: number): [number, number][] => [
  [x, y - R],
  [x + R, y],
  [x, y + R],
  [x - R, y],
  [x, y - R],
];
const text = (code: string, x: number, y: number, extra: Partial<TagText> = {}): TagText => ({ code, cx: pt(x), cy: pt(y), w: 10.6, h: 4.9, ...extra });
/** A solid black diamond (a filled shape, no outline) round (x, y). */
function solidDiamond(x: number, y: number): Segment[] {
  return poly(0, ...diamond(x, y)).map((s) => ({ ...s, filled: true, color: '#000000' }));
}
const pageText = (str: string, cx: number, cy: number, h = 6, w = str.length * h * 0.6): PageText => ({ str, cx, cy, w, h, angle: 0 });

describe('what the set says its codes are', () => {
  it('reads wall and other types from an assembly types sheet, column by column', () => {
    const notes = Array.from({ length: 12 }, (_, i) => pageText('Ex. wallboard on studs', 200, 80 + i * 10));
    const texts = [
      pageText('Partition (p) Types:', 160, 50, 12.6, 150),
      pageText('px1', 110, 100),
      pageText('p1', 110, 180),
      pageText('Floor (f) Types:', 460, 50, 12.6, 120),
      pageText('fx1', 410, 100),
      // A plan's own tag far down the sheet is not in the list.
      pageText('p9', 110, 900),
      ...notes,
    ];
    const read = readTypeSheet(texts, 1400, 1000)!;
    expect(read.wall).toEqual(['px1', 'p1']);
    expect(read.other).toEqual(['fx1']);
    expect(read.kinds.px1).toBe('partition');
  });

  it('reads which prefixes a symbol legend gives to walls and to other things', () => {
    const texts = [
      pageText('w#', 2000, 240),
      pageText('Foundation Wall Type, Wall Type', 2100, 243, 6, 130),
      pageText('f#', 2000, 270),
      pageText('Floor Types, see Sheet A012', 2090, 270, 6, 115),
      pageText('Wxx', 2000, 400),
      pageText('Window Type, see A300 Sheets', 2100, 400, 6, 127),
    ];
    const legend = readTagLegend(texts);
    expect(legend.wallPrefixes).toEqual(['w']);
    expect(legend.otherPrefixes.sort()).toEqual(['W', 'f']);
  });

  it('tells wall tags from other tags by the set, in any case', () => {
    const set: SetTypes = { ...emptySetTypes(), wall: ['px7', 'wx1', 'fwx2', 'p1'], other: ['fx2', 'c1'], wallPrefixes: ['w', 'p'], otherPrefixes: ['W', 'f'] };
    const fallback = (c: string) => WALL_TAG.test(c);
    expect(classifyCode('px7', set, [], fallback)).toEqual({ wall: true, confirmed: true });
    expect(classifyCode('fwx2', set, [], fallback)).toEqual({ wall: true, confirmed: true });
    // A window (W) is not a wall (w), and floor and ceiling tags are not walls.
    expect(classifyCode('W94', set, [], fallback)).toBeNull();
    expect(classifyCode('fx2', set, [], fallback)).toBeNull();
    // The set lists its wall types: an unlisted code (a "w1" wet-area note) is none.
    expect(classifyCode('w1', set, [], fallback)).toBeNull();
    // With nothing from the set, the usual prefixes in either case, with an existing-work x.
    const none = emptySetTypes();
    expect(classifyCode('EW3A', none, [], fallback)).toEqual({ wall: true, confirmed: false });
    expect(classifyCode('wx1', none, [], fallback)).toEqual({ wall: true, confirmed: false });
    expect(classifyCode('FR-2', none, [], fallback)).toEqual({ wall: true, confirmed: false });
    expect(classifyCode('VS1', none, [], fallback)).toEqual({ wall: false, generic: true });
  });

  it('leaves out a schedule listed on the plan itself', () => {
    const texts = [pageText('WALL ASSEMBLIES', 2059, 80, 8.4, 110), pageText('VS1', 1743, 159), pageText('VS1', 1300, 1100), ...Array.from({ length: 9 }, (_, i) => pageText('note', 900, 300 + i * 9))];
    const tags = tagTextsFrom(texts, [], undefined, [2835, 2004]);
    expect(tags.map((t) => [t.code, Math.round(t.cx)])).toEqual([['VS1', 1300]]);
  });

  it('reads a wide table under one title, its type columns side by side, beside another table', () => {
    // An "Interior Wall Types" title centred over three TYPE columns; "Floor Types" over the next table.
    const col = (x: number, codes: string[]) => codes.map((c, i) => pageText(c, x, 230 + i * 210, 6, 14));
    const texts = [
      pageText('INTERIOR WALL TYPES', 852, 94, 9.8, 165),
      ...col(135, ['W1', 'W1A', 'W2', 'W3']),
      ...col(618, ['W6A', 'W6B', 'W7A']),
      ...col(1099, ['FR1', 'CB1', 'CB2']),
      pageText('FLOOR TYPES', 1844, 94, 9.8, 100),
      ...col(1581, ['F1', 'F2']),
      ...Array.from({ length: 30 }, (_, i) => pageText('16mm gypsum board', 400, 300 + i * 30, 5.6, 80)),
    ];
    const read = readTypeSheet(texts, 2592, 1728)!;
    expect(read.wall.sort()).toEqual(['CB1', 'CB2', 'FR1', 'W1', 'W1A', 'W2', 'W3', 'W6A', 'W6B', 'W7A']);
    expect(read.other.sort()).toEqual(['F1', 'F2']);
    // Furring keeps its own kind even listed among the interior walls.
    expect(tagKind('FR1', undefined, read.kinds)).toBe('furring');
    expect(read.kinds.W1).toBe('partition');
  });

  it('reads a construction legend of walls, floors and roofs, apart from the schedule beside it', () => {
    const notes = Array.from({ length: 30 }, (_, i) => pageText('note', 300, 100 + i * 40, 5.6, 40));
    const legend = ['EW1', 'EW2', 'W1', 'W2', 'F1', 'F2', 'R1'].map((c, i) => pageText(c, 1844, 120 + i * 90, 6.7, 6.7 * c.length * 0.6));
    const schedule = Array.from({ length: 8 }, (_, i) => pageText(`10${i}`, 1100, 90 + i * 11, 5.6, 14));
    const texts = [pageText('ROOM SCHEDULE', 1434, 63, 8.4, 70), ...schedule, pageText('CONSTRUCTION LEGEND', 2069, 78, 6.7, 119), ...legend, ...notes];
    const read = readTypeSheet(texts, 2592, 1728)!;
    expect(read.wall.sort()).toEqual(['EW1', 'EW2', 'W1', 'W2']);
    expect(read.other.sort()).toEqual(['F1', 'F2', 'R1']);
  });

  it('ends a list at the next heading in its column', () => {
    const notes = Array.from({ length: 20 }, (_, i) => pageText('note', 300, 100 + i * 40, 5.6, 40));
    const texts = [
      pageText('WALL TYPES', 1526, 55, 9, 80),
      ...['WP1', 'WP2a', 'WE1'].map((c, i) => pageText(c, 1306, 161 + i * 160, 6, 18)),
      pageText('CEILING TYPES', 1516, 764, 9, 100),
      ...['CA1', 'CA2'].map((c, i) => pageText(c, 1306, 864 + i * 160, 6, 18)),
      ...notes,
    ];
    const read = readTypeSheet(texts, 2592, 1728)!;
    expect(read.wall).toEqual(['WP1', 'WP2a', 'WE1']);
    expect(read.other).toEqual(['CA1', 'CA2']);
  });

  it('reads the codes of an assembly types sheet whose headings are not text, and codes written with spaces', () => {
    const notes = Array.from({ length: 20 }, (_, i) => pageText('note', 700, 100 + i * 40, 5.5, 40));
    const texts = [
      ...['EW1', 'EW2', 'EW3'].map((c, i) => pageText(c, 133, 160 + i * 163, 6.9, 20)),
      ...['CB1', 'CB2', 'CB3'].map((c, i) => pageText(c, 515, 160 + i * 163, 6.9, 19)),
      pageText('ASSEMBLY TYPES MATRIX', 238, 962, 8.8, 163),
      ...notes,
    ];
    expect(readTypeSheet(texts, 2592, 1728)!.wall.sort()).toEqual(['CB1', 'CB2', 'CB3', 'EW1', 'EW2', 'EW3']);
    const spaced = [pageText('EXTERIOR WALL TYPE LEGEND', 256, 1488, 7, 152), pageText('EX 1', 165, 1582, 5.7, 18), pageText('EX 2', 165, 1697, 5.7, 18), ...notes];
    const read = readTypeSheet(spaced, 2592, 1728)!;
    expect(read.wall).toEqual(['EX1', 'EX2']);
    expect(read.kinds.EX1).toBe('exterior');
  });

  it('names what a list heading lists by its last word', () => {
    expect(headingKind('WALL PLATE')).toBe('other');
    expect(headingKind('BLOCK LINTEL')).toBe('other');
    expect(headingKind('MASONRY WALL')).toBe('partition');
    expect(headingKind('FOUNDATION TYPE')).toBe('foundation');
    expect(headingKind('WALL / FOUNDATION / FLOOR / ROOF TYPE')).toBeNull();
    expect(headingKind('FLOOR PLAN')).toBeNull();
    expect(headingKind('CONSTRUCTION')).toBeNull();
  });

  it('takes a code lettered like the listed wall types as a guessed wall type', () => {
    const set: SetTypes = { ...emptySetTypes(), wall: ['P1a', 'P1b', 'P2a', 'EX1'] };
    const fallback = (c: string) => WALL_TAG.test(c);
    expect(classifyCode('P2b', set, [], fallback)).toEqual({ wall: true, confirmed: false });
    expect(classifyCode('D12', set, [], fallback)).toBeNull();
  });

  it('sorts lowercase and existing-work codes into kinds', () => {
    expect(tagKind('wx1', undefined, { wx1: 'exterior' })).toBe('exterior');
    expect(tagKind('FRX2')).toBe('furring');
    expect(tagKind('fwx3')).toBe('foundation');
    expect(tagKind('ewx1')).toBe('exterior');
    expect(tagKind('px7')).toBe('partition');
  });
});

describe('tag symbols', () => {
  it('finds a filled symbol with no outline, and names its shape', () => {
    const [r] = resolveTags([text('p1', 3, 3, { confirmed: true })], solidDiamond(3, 3));
    expect(r.symbol?.shape).toBe('diamond');
    expect(r.symbol?.filled).toBe(true);
    expect(r.symbol!.size * MPP).toBeCloseTo(2 * R, 2);
  });

  it('names a diamond in a square, a hexagon, and a diamond in a circle', () => {
    const box = poly(0.43, [2.5, 2.5], [3.5, 2.5], [3.5, 3.5], [2.5, 3.5], [2.5, 2.5]);
    const [a] = resolveTags([text('px7', 3, 3)], [...box, ...poly(0.43, [3, 2.5], [3.5, 3], [3, 3.5], [2.5, 3], [3, 2.5])]);
    expect(a.symbol?.shape).toBe('box+diamond');
    const hex = poly(0.43, [2.4, 3], [2.6, 2.7], [3.4, 2.7], [3.6, 3], [3.4, 3.3], [2.6, 3.3], [2.4, 3]);
    const [b] = resolveTags([text('W94', 3, 3)], hex);
    expect(b.symbol?.shape).toBe('polygon');
    // A circle whose points the diamond's corners touch: one outline group the text sits in.
    const circle: Segment[] = [];
    for (let k = 0; k < 16; k++) {
      const [a0, a1] = [(k * Math.PI) / 8, ((k + 1) * Math.PI) / 8];
      circle.push({ ...poly(0.43, [3 + R * Math.cos(a0), 3 + R * Math.sin(a0)], [3 + R * Math.cos(a1), 3 + R * Math.sin(a1)])[0], curve: true });
    }
    const [c] = resolveTags([text('wx1', 3, 3.02)], [...circle, ...poly(0.43, ...diamond(3, 3))]);
    expect(c.symbol?.shape).toBe('round');
  });

  it('follows a leader drawn in a finer pen than its symbol', () => {
    const segs = [...poly(0.43, ...diamond(3, 3)), ...poly(0.14, [3 + R, 3], [4.5, 3])];
    const [r] = resolveTags([text('wx1', 3, 3)], segs);
    expect(r.leader).toBe(true);
    const end = r.paths[0][r.paths[0].length - 1];
    expect(end[0] * MPP).toBeCloseTo(4.5, 2);
  });

  it('follows a plain-text tag\'s arrow: a shoulder from beside the text, a leader, an arrowhead (Dunnville S1-1 "FW-2")', () => {
    // Text 24 x 7 pt at (940, 213); shoulder from its left end, leader down-left to (910.3, 252.6), arrowhead there.
    const L = (x1: number, y1: number, x2: number, y2: number, width = 0.48, filled = false): Segment => ({ x1, y1, x2, y2, width, filled });
    const leader = [L(925.8, 213.4, 920.6, 213.4), L(920.6, 213.4, 910.3, 252.6)];
    const head = [L(910.3, 252.6, 913.9, 244.8, 0, true), L(913.9, 244.8, 911.0, 244.1, 0, true), L(911.0, 244.1, 910.3, 252.6, 0, true)];
    const t: TagText = { code: 'FW-2', cx: 940.4, cy: 213.2, w: 23.7, h: 6.7 };
    const [r] = resolveTags([t], [...leader, ...head]);
    expect(r.leader).toBe(true);
    const end = r.paths[0][r.paths[0].length - 1];
    expect(end[0]).toBeCloseTo(910.3, 1);
    expect(end[1]).toBeCloseTo(252.6, 1);
    // No arrowhead: a line passing beside the text is not its leader.
    expect(resolveTags([t], leader)[0].leader).toBe(false);
  });

  it('takes the tick off a tag box, not a section bubble drawn over it with a cut line from its side', () => {
    // Kelso S1.0 FW-4: a box with a tick from the middle of its right side onto the wall at x 4.5,
    // and a section bubble (a polyline circle in a finer pen) over it with its cut line running off.
    const box = poly(0.84, [2.6, 2.86], [3.4, 2.86], [3.4, 3.14], [2.6, 3.14], [2.6, 2.86]);
    const tick = poly(0.84, [3.4, 3], [4.5, 3]);
    const bubble: Segment[] = [];
    for (let k = 0; k < 16; k++) {
      const [a0, a1] = [(k * Math.PI) / 8, ((k + 1) * Math.PI) / 8];
      bubble.push(...poly(0.6, [3.1 + 0.35 * Math.cos(a0), 3.05 + 0.35 * Math.sin(a0)], [3.1 + 0.35 * Math.cos(a1), 3.05 + 0.35 * Math.sin(a1)]));
    }
    const cut = poly(0.6, [3.45, 3.05], [8, 3.05]);
    const [r] = resolveTags([text('FW-4', 2.95, 3, { w: 18.6, h: 5.2 })], [...box, ...tick, ...bubble, ...cut]);
    expect(r.leader).toBe(true);
    expect(r.target[0] * MPP).toBeCloseTo(4.5, 2);
    expect(r.target[1] * MPP).toBeCloseTo(3, 2);
  });
});

describe('labelling walls from tags', () => {
  it('gives a tag with no leader to the wall it sits beside, within about its size', () => {
    const near = solidDiamond(2.5, 0.8);
    const far = solidDiamond(2.5, 2.6);
    const res = wallTakeoff(lShape(), [...lShape(), ...near, ...far], [text('px7', 2.5, 0.8, { confirmed: true }), text('p1', 2.5, 2.6, { confirmed: true })], MPP);
    const by = lengthsByType(res.runs, MPP);
    expect(by.get('px7')?.length).toBeCloseTo(9 - T, 1);
    expect(by.has('p1')).toBe(false);
  });

  it('drops a guessed code in another symbol than the set’s wall tags use', () => {
    // A confirmed partition tag in a diamond, and a window tag W12 in a hexagon beside a wall.
    const hex = poly(0.43, [3.9, 2], [4.1, 1.7], [4.9, 1.7], [5.1, 2], [4.9, 2.3], [4.1, 2.3], [3.9, 2]);
    const segs = [...lShape(), ...solidDiamond(2.5, 0.8), ...poly(0.43, ...diamond(2.5, 0.8)), ...hex];
    const res = wallTakeoff(lShape(), segs, [text('px7', 2.5, 0.8, { confirmed: true }), text('W12', 4.5, 2)], MPP);
    expect(res.tags.map((t) => t.code)).toEqual(['px7']);
    expect(lengthsByType(res.runs, MPP).has('W12')).toBe(false);
  });

  it('keeps a partition type off an exterior wall and the other way round', () => {
    const ew = { segs: [...poly(0.51, ...diamond(2.5, 1.5)), ...poly(0.51, [2.5, 1.5 - R], [2.5, T])], text: text('EW1', 2.5, 1.5) };
    const w = { segs: [...poly(0.51, ...diamond(1.5, 2.5)), ...poly(0.51, [1.5 - R, 2.5], [T, 2.5])], text: text('W1', 1.5, 2.5) };
    const res = wallTakeoff(lShape(), [...lShape(), ...ew.segs, ...w.segs], [ew.text, w.text], MPP);
    expect(res.runs.some((r) => r.tags.includes('EW1') && r.tags.includes('W1'))).toBe(false);
    const by = lengthsByType(res.runs, MPP);
    expect(by.get('EW1')?.length).toBeCloseTo(5 - T / 2, 2);
    expect(by.get('W1')?.length).toBeCloseTo(4 - T / 2, 2);
  });

  it('gives an exterior tag landing on the lining of a thick wall to the wall itself', () => {
    // A 0.3 m wall with a 0.08 m lining against its inside face; the tag's leader stops on the lining.
    const lines = [...wall([0, 0], [6, 0]), ...wall([0, 0.3], [6, 0.3]), ...wall([0, 0.38], [6, 0.38]), ...wall([0, 0], [0, 0.38]), ...wall([6, 0], [6, 0.38])];
    const t = { segs: [...poly(0.51, ...diamond(3, 1.5)), ...poly(0.51, [3, 1.5 - R], [3, 0.38])], text: text('EW1', 3, 1.5) };
    const res = wallTakeoff(lines, [...lines, ...t.segs], [t.text], MPP);
    const tagged = res.runs.filter((r) => r.tags.includes('EW1'));
    expect(tagged.length).toBeGreaterThan(0);
    for (const r of tagged) expect(r.thickness * MPP).toBeCloseTo(0.3, 2);
  });
});
