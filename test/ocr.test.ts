import { describe, expect, it } from 'vitest';
import { readTitleLines } from '../src/ocr';

describe('title block by OCR', () => {
  it('finds the sheet number and the drawing title', () => {
    const L = (h: number, text: string) => ({ h, text, x: 0, y: 0 });
    const lines = [L(21, 'REVISION DATE'), L(11, 'PROJECT TITLE:'), L(21, 'ROW — 84 FREDERICK ST.'), L(21, 'RENOVATION & RENEWAL'), L(14, 'KITCHENER, ON'), L(11, 'DRAWING TITLE:'), L(21, 'LIGHTING'), L(21, 'GROUND FLOOR — RCP'), L(14, 'D.Z. —'), L(11, 'CHECKED BY: MIGHTON PROJECT No.'), L(12, 'SCALE'), L(39, 'E2')];
    expect(readTitleLines(lines)).toEqual({ number: 'E2', title: 'LIGHTING GROUND FLOOR - RCP' });
  });
});

describe('a set of OCR numbers', () => {
  it('takes the set letter and fills a missed page from the run', async () => {
    const { tidySetNumbers } = await import('../src/ocr');
    const got = tidySetNumbers([
      { page: 1 },
      { page: 2, number: 'E2' },
      { page: 3, number: 'F3' },
      { page: 4, number: 'F4' },
      { page: 5 },
      { page: 6, number: 'E6' },
      { page: 8, number: 'E8' },
      { page: 9, number: 'E9' },
    ]);
    expect([...got]).toEqual([
      [1, 'E1'],
      [2, 'E2'],
      [3, 'E3'],
      [4, 'E4'],
      [5, 'E5'],
      [6, 'E6'],
      [8, 'E8'],
      [9, 'E9'],
    ]);
  });
});
