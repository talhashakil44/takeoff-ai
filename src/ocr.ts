import type { PDFPageProxy } from './pdf';
import type { OcrWord } from './ocrText';
import { mosaicLayout, tagBoxes, withTagWords, wordsFromMosaic, type Box } from './ocrTags';
import { segmentsOf } from './fill/sheetWalls';

/**
 * Reading a title block that has no text layer (the words drawn as linework, or a scan): the
 * corner of the sheet rendered and read by OCR, offline. The sheet number is the biggest
 * number-like word there (E2, A101, M-201); the title, the lines under DRAWING TITLE.
 */

type Worker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let worker: Promise<Worker> | null = null;

function ocrWorker(): Promise<Worker> {
  if (!worker) {
    const base = new URL('ocr/', document.baseURI).href;
    worker = import('tesseract.js').then(({ createWorker }) =>
      createWorker('eng', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base.replace(/\/$/, ''), gzip: true, workerBlobURL: false }),
    );
    worker.catch(() => (worker = null));
  }
  return worker;
}

export interface OcrLine {
  text: string;
  /** Height of the line's letters, in rendered pixels. */
  h: number;
  y: number;
  x: number;
}

/** Sheet number and title from a title block's OCR'd lines. */
export function readTitleLines(lines: OcrLine[]): { number?: string; title?: string } {
  const NUMBER = /^[A-Z]{1,3}[-.]?\d{1,3}(?:[.-]\d{1,2})?[A-Z]?$/;
  const words = lines.flatMap((l) => l.text.split(/\s+/).map((w) => ({ w: w.replace(/[^A-Z0-9.-]/gi, '').toUpperCase(), h: l.h, line: l })));
  const heights = lines.map((l) => l.h).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 0;
  const numbers = words.filter((x) => NUMBER.test(x.w) && /\d/.test(x.w) && !/^\d/.test(x.w) && !/^[A-Z]\d[A-Z]$/.test(x.w) && x.h >= median * 1.25).sort((a, b) => b.h - a.h);
  const number = numbers[0]?.w;
  let title: string | undefined;
  const at = lines.findIndex((l) => /\b(drawing|sheet)\s*title\b|^title\s*:?$/i.test(l.text));
  if (at >= 0) {
    const LABEL = /\b(drawn|checked|scale|date|project|drawing\s*n|sheet\s*n|job|no\.|designed|approved|reviewed|revision)\b/i;
    const parts: string[] = [];
    let first = 0;
    const left = lines[at].x;
    for (const l of lines.slice(at + 1, at + 7)) {
      // A line from the drawing beside the title block (left of the label) is not the title.
      if (l.x < left - 40) continue;
      if (LABEL.test(l.text) || (first && (l.h < first * 0.7 || l.h > first * 1.5)) || l.text.replace(/[^A-Za-z]/g, '').length < 3 || /^[A-Z]\.\s?[A-Z]\./.test(l.text)) break;
      if (!first) first = l.h;
      parts.push(l.text.trim().replace(/[\s=—–-]+$/, ''));
    }
    if (parts.length) title = parts.join(' ').replace(/\s*[—–]\s*/g, ' - ').replace(/\s+/g, ' ').trim();
  }
  return { number, title };
}

/** Reads the page's title block: the bottom-right corner, then the bottom strip, until a sheet number turns up. */
export async function ocrTitleBlock(page: PDFPageProxy): Promise<{ number?: string; title?: string }> {
  const w = await ocrWorker();
  const { width, height } = page.getViewport({ scale: 1 });
  const regions: [number, number, number, number][] = [
    [width * 0.84, height * 0.55, width, height],
    [width * 0.55, height * 0.82, width, height],
    [width * 0.84, 0, width, height * 0.55],
  ];
  let found: { number?: string; title?: string } = {};
  for (const [x0, y0, x1, y1] of regions) {
    const scale = Math.min(150 / 72, 2600 / Math.max(x1 - x0, y1 - y0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((x1 - x0) * scale);
    canvas.height = Math.ceil((y1 - y0) * scale);
    await page.render({ canvas, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -x0 * scale, -y0 * scale], background: '#ffffff' }).promise;
    const { data } = await w.recognize(canvas, {}, { blocks: true });
    const lines: OcrLine[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) if (l.text.trim()) lines.push({ text: l.text.trim(), h: l.bbox.y1 - l.bbox.y0, y: l.bbox.y0, x: l.bbox.x0 });
    const r = readTitleLines(lines);
    found = { number: found.number ?? r.number, title: found.title ?? r.title };
    if (found.number) break;
  }
  return found;
}

/**
 * One set's OCR'd numbers made consistent: a letter misread in a few (F3 among E2, E6, E8) takes
 * the set's letter, and a page OCR missed takes its number from its neighbours' run (E5 between
 * E4 on page 4 and E6 on page 6).
 */
export function tidySetNumbers(found: { page: number; number?: string }[], hint?: string): Map<number, string> {
  const out = new Map<number, string>();
  const parsed = found.flatMap((f) => {
    const m = f.number ? /^([A-Z]{1,3})([-.]?)(\d+)$/.exec(f.number) : null;
    return m ? [{ page: f.page, prefix: m[1], sep: m[2], n: Number(m[3]) }] : [];
  });
  if (!parsed.length) {
    for (const f of found) if (f.number) out.set(f.page, f.number);
    return out;
  }
  const count = new Map<string, number>();
  for (const p of parsed) count.set(p.prefix, (count.get(p.prefix) ?? 0) + 1);
  // The set's letter: the file's discipline when its name says (Electrical: E) and some pages agree, else the most read.
  const ranked = [...count].sort((a, b) => b[1] - a[1]);
  const [prefix, n] = hint && count.has(hint) ? [hint, count.get(hint)!] : ranked[0];
  const sep = parsed.find((p) => p.prefix === prefix)!.sep;
  // The run: number = page + offset, when the pages that read agree on one offset.
  const offsets = new Map<number, number>();
  for (const p of parsed) offsets.set(p.n - p.page, (offsets.get(p.n - p.page) ?? 0) + 1);
  const [offset, agree] = [...offsets].sort((a, b) => b[1] - a[1])[0];
  for (const f of found) {
    const p = parsed.find((x) => x.page === f.page);
    if (p) {
      const inRun = agree >= 3 && agree >= parsed.length * 0.6;
      // A misread letter: when the set's letter is most of it, or the pages run in order (E2 … E11, page = number).
      const odd = p.prefix !== prefix && p.prefix.length === prefix.length && (n > parsed.length / 2 || (inRun && n > (count.get(p.prefix) ?? 0)));
      // A misread letter (F for E) in the run: the set's letter; misread digits too (F1 on page 10 of E1…E12): the run's number.
      out.set(f.page, odd ? `${prefix}${sep}${p.n - p.page === offset || !inRun ? p.n : f.page + offset}` : `${p.prefix}${p.sep}${p.n}`);
    } else if (f.number) out.set(f.page, f.number);
    else if (agree >= 3 && agree >= parsed.length * 0.6) out.set(f.page, `${prefix}${sep}${f.page + offset}`);
  }
  return out;
}

/** Tesseract's page result, as far as page OCR reads it. */
interface RecognizedPage {
  blocks?: { paragraphs: { lines: { words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }[] | null;
}

/**
 * The words of one Tesseract reading as sheet words: `k` sheet points per pixel; `turnedFrom`
 * the height in pixels of the level image when this one was it turned a quarter clockwise (text
 * reading up the sheet then reads level: pixel (u, v) here is (v, H − u) on the level image).
 */
export function wordsOfRecognized(page: RecognizedPage, k: number, turnedFrom?: number): OcrWord[] {
  const out: OcrWord[] = [];
  let line = 0;
  for (const b of page.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines) {
        line++;
        for (const w of l.words) {
          const { x0, y0, x1, y1 } = w.bbox;
          out.push(
            turnedFrom === undefined
              ? { text: w.text, x0: x0 * k, y0: y0 * k, x1: x1 * k, y1: y1 * k, conf: w.confidence, line: String(line), rot: 0 }
              : { text: w.text, x0: y0 * k, x1: y1 * k, y0: (turnedFrom - x1) * k, y1: (turnedFrom - x0) * k, conf: w.confidence, line: String(line), rot: 90 },
          );
        }
      }
  return out;
}

let pageWorker: Promise<Worker> | null = null;
/** A worker of its own for whole pages: sparse text (labels scattered over a drawing), not a title block's lines. */
function pageOcrWorker(): Promise<Worker> {
  if (!pageWorker) {
    const base = new URL('ocr/', document.baseURI).href;
    pageWorker = import('tesseract.js').then(async ({ createWorker, PSM }) => {
      const w = await createWorker('eng', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base.replace(/\/$/, ''), gzip: true, workerBlobURL: false });
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      return w;
    });
    pageWorker.catch(() => (pageWorker = null));
  }
  return pageWorker;
}

/** Page OCR resolution: small lettering (3/32" on a 1/8" plan) still a dozen pixels high. */
const PAGE_DPI = 200;

/**
 * OCR of a whole sheet in the app (see src/ocrText.ts): rendered at 200 dpi and read level, then
 * turned a quarter for the text along vertical walls. A sheet takes a while, so the app reads only
 * the pages that have no text of their own, once each.
 */
export async function pageOcr(page: PDFPageProxy): Promise<OcrWord[]> {
  const w = await pageOcrWorker();
  const scale = PAGE_DPI / 72;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvas, viewport: vp, background: '#ffffff' }).promise;
  const k = 1 / scale;
  const words = wordsOfRecognized((await w.recognize(canvas, {}, { blocks: true })).data, k);
  const turned = document.createElement('canvas');
  turned.width = canvas.height;
  turned.height = canvas.width;
  const ctx = turned.getContext('2d')!;
  ctx.translate(turned.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(canvas, 0, 0);
  canvas.width = canvas.height = 0;
  for (const word of wordsOfRecognized((await w.recognize(turned, {}, { blocks: true })).data, k, vp.height)) {
    // Level text read again sideways: keep the level reading.
    if (!words.some((o) => o.x0 < word.x1 && word.x0 < o.x1 && o.y0 < word.y1 && word.y0 < o.y1)) words.push(word);
  }
  turned.width = turned.height = 0;
  // Tags in their symbols, read off a mosaic of the symbols at high resolution (src/ocrTags.ts).
  const boxes = tagBoxes(await segmentsOf(page)).slice(0, 2500);
  return boxes.length ? withTagWords(words, await mosaicWords(page, w, boxes), boxes) : words;
}

/** Symbols are cut out at this resolution, from the sheet rendered a strip at a time. */
const TAG_DPI = 360;
const STRIP = 600;

async function mosaicWords(page: PDFPageProxy, w: Worker, boxes: Box[]): Promise<OcrWord[]> {
  const k = TAG_DPI / 72;
  const layout = mosaicLayout(boxes, k, Math.round(4 * k), 3000);
  const mosaic = document.createElement('canvas');
  mosaic.width = layout.width;
  mosaic.height = layout.height;
  const out = mosaic.getContext('2d')!;
  out.fillStyle = '#ffffff';
  out.fillRect(0, 0, mosaic.width, mosaic.height);
  const { width, height } = page.getViewport({ scale: 1 });
  const strip = document.createElement('canvas');
  const band = Math.round(0.9 * k);
  for (let y0 = 0; y0 < height; y0 += STRIP)
    for (let x0 = 0; x0 < width; x0 += STRIP) {
      // The symbols whose top-left corner is in this strip, each cut out whole (strips overlap by a symbol's size).
      const here = layout.tiles.filter((t) => t.box[0] >= x0 && t.box[0] < x0 + STRIP && t.box[1] >= y0 && t.box[1] < y0 + STRIP);
      if (!here.length) continue;
      const [x1, y1] = [Math.min(width, x0 + STRIP + 100), Math.min(height, y0 + STRIP + 60)];
      strip.width = Math.ceil((x1 - x0) * k);
      strip.height = Math.ceil((y1 - y0) * k);
      await page.render({ canvas: strip, viewport: page.getViewport({ scale: k }), transform: [1, 0, 0, 1, -x0 * k, -y0 * k], background: '#ffffff' }).promise;
      for (const t of here) {
        const [sx, sy] = [Math.round((t.box[0] - x0) * k), Math.round((t.box[1] - y0) * k)];
        // Inside the outline only: the outline whited out. An upright symbol goes in turned a quarter clockwise.
        const [bw, bh] = t.turned ? [t.h, t.w] : [t.w, t.h];
        out.save();
        out.translate(t.x, t.y);
        if (t.turned) {
          out.translate(t.w, 0);
          out.rotate(Math.PI / 2);
        }
        out.drawImage(strip, sx + band, sy + band, bw - 2 * band, bh - 2 * band, band, band, bw - 2 * band, bh - 2 * band);
        out.restore();
      }
    }
  strip.width = strip.height = 0;
  const read = wordsOfRecognized((await w.recognize(mosaic, {}, { blocks: true })).data, 1);
  mosaic.width = mosaic.height = 0;
  return wordsFromMosaic(read, layout.tiles, k);
}
