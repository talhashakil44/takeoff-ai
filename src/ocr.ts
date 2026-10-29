import type { PDFPageProxy } from './pdf';

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
export function tidySetNumbers(found: { page: number; number?: string }[]): Map<number, string> {
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
  const [prefix, n] = [...count].sort((a, b) => b[1] - a[1])[0];
  const sep = parsed.find((p) => p.prefix === prefix)!.sep;
  // The run: number = page + offset, when the pages that read agree on one offset.
  const offsets = new Map<number, number>();
  for (const p of parsed) offsets.set(p.n - p.page, (offsets.get(p.n - p.page) ?? 0) + 1);
  const [offset, agree] = [...offsets].sort((a, b) => b[1] - a[1])[0];
  for (const f of found) {
    const p = parsed.find((x) => x.page === f.page);
    if (p) {
      const odd = n > parsed.length / 2 && p.prefix !== prefix && p.prefix.length === prefix.length;
      const inRun = agree >= 3 && agree >= parsed.length * 0.6;
      // A misread letter (F for E) in the run: the set's letter; misread digits too (F1 on page 10 of E1…E12): the run's number.
      out.set(f.page, odd ? `${prefix}${sep}${p.n - p.page === offset || !inRun ? p.n : f.page + offset}` : `${p.prefix}${p.sep}${p.n}`);
    } else if (f.number) out.set(f.page, f.number);
    else if (agree >= 3 && agree >= parsed.length * 0.6) out.set(f.page, `${prefix}${sep}${f.page + offset}`);
  }
  return out;
}
