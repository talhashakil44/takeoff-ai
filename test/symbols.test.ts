import { describe, expect, it } from 'vitest';
import { findSymbols } from '../src/fill/symbols';
import type { Segment } from '../src/fill/vectors';

const seg = (x1: number, y1: number, x2: number, y2: number, width = 0.3): Segment => ({ x1, y1, x2, y2, width, filled: false });

/** A light fixture: a 6 x 3 rectangle with a cross, placed at (x, y), turned a quarter turn when `turned`. */
function fixture(x: number, y: number, turned = false): Segment[] {
  const pts: [number, number, number, number][] = [
    [-3, -1.5, 3, -1.5],
    [3, -1.5, 3, 1.5],
    [3, 1.5, -3, 1.5],
    [-3, 1.5, -3, -1.5],
    [-3, -1.5, 3, 1.5],
    [-3, 1.5, 3, -1.5],
    [0, -1.5, 0, -2.5],
  ];
  return pts.map(([a, b, c, d]) => (turned ? seg(x - b, y + a, x - d, y + c) : seg(x + a, y + b, x + c, y + d)));
}
/** Same outline, no cross: a different symbol. */
const plain = (x: number, y: number) => fixture(x, y).slice(0, 4);

describe('count by symbol', () => {
  const segs = [
    ...fixture(100, 100),
    ...fixture(200, 100),
    ...fixture(300, 250, true),
    ...plain(400, 100),
    // A wall line running past one fixture does not stop it matching.
    seg(150, 104, 260, 104, 0.6),
    // Its mirror image (the tail on the other side, flipped top to bottom) still counts.
    ...fixture(600, 100).map((x) => ({ ...x, y1: 200 - x.y1, y2: 200 - x.y2 })),
    // The same fixture drawn in a heavier pen is a different symbol.
    ...fixture(500, 100).map((s) => ({ ...s, width: 0.6 })),
  ];

  it('finds every copy of the sample, turned, mirrored or not, and nothing else', () => {
    const found = findSymbols(segs, [95, 95, 105, 105]);
    const at = found.map((f) => [Math.round(f.at[0]), Math.round(f.at[1])]).sort((a, b) => a[0] - b[0]);
    expect(at).toEqual([
      [100, 100],
      [200, 100],
      // Marks land on the symbol's linework: this turned copy's tail pushes its centre half a point over.
      [301, 250],
      [600, 100],
    ]);
    expect(found.find((f) => Math.round(f.at[0]) === 301)?.turn).toBe(1);
  });

  it('needs a few lines to go on', () => {
    expect(findSymbols(segs, [0, 0, 10, 10])).toEqual([]);
  });
});

describe('count by symbol on a busy sheet', () => {
  let nextSub = 1;
  /** One drawn shape: its lines share a subpath, as a PDF draws them. */
  const shape = (pts: [number, number][], closed: boolean, extra: Partial<Segment> = {}): Segment[] => {
    const sub = nextSub++;
    const out: Segment[] = [];
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
      const [a, b] = pts[i];
      const [c, d] = pts[(i + 1) % pts.length];
      out.push({ ...seg(a, b, c, d), sub, ...extra });
    }
    return out;
  };
  const tri = (x: number, y: number): [number, number][] => [
    [x - 4, y + 3.5],
    [x + 4, y + 3.5],
    [x, y - 3.5],
  ];
  /** A sidewall head: a triangle, its fill drawn over it as a second shape unless `bare`. */
  const head = (x: number, y: number, bare = false) => [...shape(tri(x, y), true), ...(bare ? [] : shape(tri(x, y), true, { width: 0, filled: true }))];
  const ring = (x: number, y: number, r = 3.4) =>
    shape(
      Array.from({ length: 16 }, (_, i) => [x + r * Math.cos((i * Math.PI) / 8), y + r * Math.sin((i * Math.PI) / 8)] as [number, number]),
      true,
      { curve: true },
    );
  /** A solid dot, filled with scanlines as some CAD exports draw it. */
  const dot = (x: number, y: number) => Array.from({ length: 8 }, (_, i) => ({ ...seg(x - 1, y - 1 + i * 0.28, x + 1, y - 1 + i * 0.28, 0), filled: true, sub: nextSub++ }));

  it('counts a symbol boxed with bits of pipe and wall that differ at every copy', () => {
    const segs = [
      ...[100, 200, 300, 400, 500].flatMap((x, i) => [
        ...head(x, 100),
        // A drop pipe from the head, a different length and way at each copy.
        ...shape(
          [
            [x, 96.5],
            [x + (i - 2) * 3, 90 - i * 2],
          ],
          false,
        ),
        // A wall line just behind it.
        ...shape(
          [
            [x - 20, 104 + i * 0.5],
            [x + 20, 104 + i * 0.5],
          ],
          false,
          { width: 0.6 },
        ),
      ]),
    ];
    // Dragged loosely, catching the pipe and the wall with the head.
    const found = findSymbols(segs, [92, 88, 108, 106]);
    expect(found.map((f) => Math.round(f.at[0])).sort((a, b) => a - b)).toEqual([100, 200, 300, 400, 500]);
  });

  it('counts a solid head once, and the copies drawn without their fill too', () => {
    const segs = [...head(100, 100), ...head(200, 100), ...head(300, 100, true), ...head(400, 100)];
    const found = findSymbols(segs, [94, 94, 106, 106]);
    expect(found.map((f) => Math.round(f.at[0])).sort((a, b) => a - b)).toEqual([100, 200, 300, 400]);
  });

  it('tells an open circle from one with a dot in it', () => {
    const open = [100, 200, 300];
    const dotted = [150, 250];
    const segs = [...open.flatMap((x) => ring(x, 100)), ...dotted.flatMap((x) => [...ring(x, 100), ...dot(x, 100)])];
    const xs = (box: [number, number, number, number]) =>
      findSymbols(segs, box)
        .map((f) => Math.round(f.at[0]))
        .sort((a, b) => a - b);
    expect(xs([95, 95, 105, 105])).toEqual(open);
    expect(xs([145, 95, 155, 105])).toEqual(dotted);
  });
});
