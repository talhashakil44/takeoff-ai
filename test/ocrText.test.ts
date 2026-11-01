import { describe, expect, it } from 'vitest';
import { ocrRuns, runsAsItems, withOcrText, type OcrWord } from '../src/ocrText';
import type { PDFDocumentProxy, PDFPageProxy } from '../src/pdf';

const word = (text: string, x0: number, y0: number, x1: number, y1: number, line = '1.1.1', rot: 0 | 90 = 0, conf = 90): OcrWord => ({ text, x0, y0, x1, y1, conf, line, rot });

// A page 1000 × 800 points, not turned: PDF y runs up from the bottom.
const viewport = {
  width: 1000,
  height: 800,
  convertToPdfPoint: (x: number, y: number) => [x, 800 - y],
  convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
};

describe('OCR text layer', () => {
  it('joins close words on a line into one run and splits at a column gap', () => {
    const runs = ocrRuns([
      word('MEETING', 100, 90, 160, 100),
      word('ROOM', 165, 90, 200, 100),
      word('P101', 400, 90, 430, 100),
    ]);
    expect(runs.map((r) => r.str).sort()).toEqual(['MEETING ROOM', 'P101']);
    const r = runs.find((x) => x.str === 'MEETING ROOM')!;
    expect([r.x, r.y, r.w, r.h]).toEqual([100, 100, 100, 10]);
  });

  it('drops unsure words and linework read as marks', () => {
    expect(ocrRuns([word('|', 0, 0, 2, 10), word('—', 10, 0, 20, 10), word('P1', 50, 0, 60, 10, '1.1.1', 0, 30)])).toEqual([]);
  });

  it('reads text up the sheet as a run along it, its baseline on the right', () => {
    const [r] = ocrRuns([word('W1', 300, 400, 310, 430, '2.1.1', 90)]);
    expect(r).toMatchObject({ str: 'W1', x: 310, y: 430, w: 30, h: 10, rot: 90 });
    // As a pdf.js item: turned a quarter anticlockwise, size from the letters' height.
    const [item] = runsAsItems([r!], viewport);
    const [a, b, c, d, e, f] = item!.transform;
    expect(a).toBeCloseTo(0);
    expect(b).toBeCloseTo(10 / 0.7);
    expect(c).toBeCloseTo(-10 / 0.7);
    expect(d).toBeCloseTo(0);
    expect([e, f]).toEqual([310, 370]);
  });

  it('adds OCR text only to pages without their own and only where the page has none', async () => {
    const own = [{ str: 'A2.1', dir: 'ltr', width: 30, height: 14, transform: [14, 0, 0, 14, 900, 50], fontName: 'f', hasEOL: false }];
    let reads = 0;
    const page = {
      pageNumber: 1,
      getViewport: () => viewport,
      getTextContent: async () => ({ items: own, styles: {} }),
    } as unknown as PDFPageProxy;
    const pdf = { numPages: 1, getPage: async () => page } as unknown as PDFDocumentProxy;
    withOcrText(pdf, async () => {
      reads++;
      // The sheet number again (already in the text layer) and a wall tag.
      return [word('A2.1', 900, 740, 930, 750), word('P101', 400, 300, 430, 310)];
    });
    const p = await pdf.getPage(1);
    const content = await p.getTextContent();
    await p.getTextContent();
    expect(reads).toBe(1);
    expect(content.items.map((i) => ('str' in i ? i.str : ''))).toEqual(['A2.1', 'P101']);
  });
  it('in the app, leaves a vector set to its own text and never waits long on one sheet', async () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => ({ str: `NOTE${i}`, dir: 'ltr', width: 30, height: 10, transform: [10, 0, 0, 10, 10 * i, 50], fontName: 'f', hasEOL: false }));
    const pageOf = (k: number, n: number) =>
      ({ pageNumber: k, getViewport: () => viewport, getTextContent: async () => ({ items: words(n), styles: {} }) }) as unknown as PDFPageProxy;
    // A vector set: one sparse elevation among sheets full of notes.
    const vector = [pageOf(1, 400), pageOf(2, 20), pageOf(3, 300), pageOf(4, 500)];
    let reads = 0;
    const set = { numPages: 4, getPage: async (k: number) => vector[k - 1]! } as unknown as PDFDocumentProxy;
    withOcrText(set, async () => (reads++, [word('P101', 400, 300, 430, 310)]), { flattenedOnly: true });
    expect((await (await set.getPage(2)).getTextContent()).items).toHaveLength(20);
    expect(reads).toBe(0);
    // A flattened set is read, but a sheet whose OCR hangs gives its own text after the timeout.
    const flat = [pageOf(1, 10), pageOf(2, 12)];
    const scan = { numPages: 2, getPage: async (k: number) => flat[k - 1]! } as unknown as PDFDocumentProxy;
    withOcrText(scan, () => new Promise<OcrWord[]>(() => {}), { flattenedOnly: true, timeoutMs: 20 });
    expect((await (await scan.getPage(1)).getTextContent()).items).toHaveLength(10);
    // ...and the rest of that set is not tried again.
    expect((await (await scan.getPage(2)).getTextContent()).items).toHaveLength(12);
  });
});

describe('Tesseract words as sheet words', () => {
  it('maps level and quarter-turned readings back onto the sheet', async () => {
    const { wordsOfRecognized } = await import('../src/ocr');
    const page = { blocks: [{ paragraphs: [{ lines: [{ words: [{ text: 'P101', confidence: 91, bbox: { x0: 100, y0: 50, x1: 160, y1: 70 } }] }] }] }] };
    expect(wordsOfRecognized(page, 0.5)[0]).toMatchObject({ x0: 50, y0: 25, x1: 80, y1: 35, rot: 0 });
    // Turned from a level image 1000 px high: u 100–160 along, v 50–70 across.
    expect(wordsOfRecognized(page, 0.5, 1000)[0]).toMatchObject({ x0: 25, x1: 35, y0: 420, y1: 450, rot: 90 });
  });
});

describe('OCR misreadings of drafting lettering', () => {
  it('reads tags, quotes and a broken scale as drawn', async () => {
    const { ocrNormal } = await import('../src/ocrText');
    expect(ocrNormal('FT=1')).toBe('FT-1');
    expect(ocrNormal('[FT=4]')).toBe('FT-4');
    expect(ocrNormal('7-1/2”')).toBe('7-1/2"');
    expect(ocrNormal('1/8"=1—')).toBe('1/8" = 1\'-0"');
    expect(ocrNormal('MEETING')).toBe('MEETING');
  });

  it('keeps an unsure word when it reads as a scale', () => {
    const runs = ocrRuns([word('1/8"=1—', 100, 90, 160, 100, '1.1.1', 0, 10), word('ROOM', 300, 90, 340, 100, '1.1.2', 0, 10)]);
    expect(runs.map((r) => r.str)).toEqual(['1/8" = 1\'-0"']);
  });
});

describe('tags read with their outline', () => {
  it('drops the outline marks around a tag', async () => {
    const { ocrNormal } = await import('../src/ocrText');
    expect(['<P3>', '(05)', '\\01', 'A1.03/', '05)'].map(ocrNormal)).toEqual(['P3', '05', '01', 'A1.03', '05']);
    expect(ocrNormal('O4A')).toBe('04A');
  });
});
