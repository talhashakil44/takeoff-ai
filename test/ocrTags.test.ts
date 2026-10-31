import { describe, expect, it } from 'vitest';
import type { Segment } from '../src/fill/vectors';
import { mosaicLayout, tagBoxes, withTagWords, wordsFromMosaic } from '../src/ocrTags';

const loop = (sub: number, x: number, y: number, w: number, h: number): Segment[] => {
  const p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  return p.slice(1).map(([x2, y2], i) => ({ x1: p[i]![0]!, y1: p[i]![1]!, x2: x2!, y2: y2!, width: 0.5, filled: false, sub }));
};

describe('tags read in their symbols', () => {
  it('finds small closed shapes, the outer of a double outline', () => {
    const segs = [...loop(1, 100, 100, 20, 10), ...loop(2, 101, 101, 18, 8), ...loop(3, 0, 0, 500, 300)];
    // An open line is no symbol.
    segs.push({ x1: 300, y1: 300, x2: 320, y2: 300, width: 0.5, filled: false, sub: 4 }, { x1: 320, y1: 300, x2: 320, y2: 310, width: 0.5, filled: false, sub: 4 }, { x1: 320, y1: 310, x2: 330, y2: 310, width: 0.5, filled: false, sub: 4 });
    expect(tagBoxes(segs)).toEqual([[100, 100, 120, 110]]);
  });

  it('puts each word read off the mosaic back in its symbol on the sheet', () => {
    const boxes: [number, number, number, number][] = [
      [100, 100, 120, 110],
      [500, 40, 516, 56],
    ];
    const { tiles } = mosaicLayout(boxes, 5, 20, 3000);
    // "WT-2" read in the first tile, 10–90 px across, 15–35 down.
    const [w] = wordsFromMosaic([{ text: 'WT-2', conf: 90, x0: tiles[0]!.x + 10, y0: tiles[0]!.y + 15, x1: tiles[0]!.x + 90, y1: tiles[0]!.y + 35 }], tiles, 5);
    expect(w).toMatchObject({ text: 'WT-2', x0: 102, y0: 103, x1: 118, y1: 107, line: 'tag0' });
    // The page pass's misreading inside that symbol gives way to it.
    const page = [{ text: 'WT=2|', conf: 40, x0: 101, y0: 102, x1: 119, y1: 108, line: '1', rot: 0 as const }];
    expect(withTagWords(page, [w!], boxes).map((x) => x.text)).toEqual(['WT-2']);
  });
});

describe('upright tags', () => {
  it('lays an upright symbol in turned and puts its word back reading up the sheet', () => {
    const box: [number, number, number, number] = [200, 300, 210, 340];
    const { tiles } = mosaicLayout([box], 5, 20, 3000);
    expect(tiles[0]).toMatchObject({ turned: true, w: 200, h: 50 });
    // Read level in the turned tile: u 20–180 along, v 10–40 across.
    const [w] = wordsFromMosaic([{ text: 'WT-4', conf: 90, x0: tiles[0]!.x + 20, y0: tiles[0]!.y + 10, x1: tiles[0]!.x + 180, y1: tiles[0]!.y + 40 }], tiles, 5);
    expect(w).toMatchObject({ text: 'WT-4', x0: 202, x1: 208, y0: 304, y1: 336, rot: 90 });
  });
});
