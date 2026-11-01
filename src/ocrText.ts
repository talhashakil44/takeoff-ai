import type { PDFDocumentProxy, PDFPageProxy } from './pdf';

/**
 * A text layer for drawings that have none: sets "flattened" in Bluebeam or printed to PDF draw
 * every letter as linework, so the tags, schedules, room names and scales every takeoff reads are
 * not there as text. Such pages are read by OCR, and the words found are handed to the rest of the
 * app as if the PDF carried them: the same text items pdf.js gives, so every reader works unchanged.
 *
 * The OCR itself is pluggable (Tesseract in the app, the tesseract command in the benchmark); this
 * file turns its words into text runs and decides which pages need it.
 */

/** A word OCR found, in sheet points (top-left origin, as the page is shown). */
export interface OcrWord {
  text: string;
  /** Its box on the sheet as shown. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Confidence, 0-100. */
  conf: number;
  /** Words with the same line key were read as one line. */
  line: string;
  /** Reading direction: 0 left to right, 90 bottom to top (text along a vertical wall). */
  rot: 0 | 90;
}

/** OCR for one page: its words in sheet points. */
export type PageOcr = (page: PDFPageProxy) => Promise<OcrWord[]>;

/** Pages with fewer words than this in their own text layer are read by OCR too (a title block alone has about 100). */
export const OCR_BELOW_WORDS = 150;

/** OCR words below this confidence are noise (hatching, linework read as letters). */
const MIN_CONF = 55;

/** A run of words on one line, in sheet points: start of its baseline, reading direction, size. */
export interface OcrRun {
  str: string;
  /** Start of the baseline on the sheet as shown. */
  x: number;
  y: number;
  /** Height of the letters (capitals) and length along the baseline. */
  h: number;
  w: number;
  rot: 0 | 90;
}

/**
 * A word as the drawing wrote it, from the usual misreadings of drafting lettering: curly quotes
 * and primes for inch and foot marks, dashes for hyphens, a tag's hyphen read as "=" (FT=1 is
 * FT-1), and a scale whose "1'-0"" came out as noise after "1/8"=1".
 */
export function ocrNormal(text: string): string {
  const t = text
    .trim()
    .replace(/[”“″]/g, '"')
    .replace(/[’‘′]/g, "'")
    .replace(/[—–]/g, '-')
    // A symbol's outline read along with its tag: <P3>, (05), \01, A1.03/.
    .replace(/^[<(\[{|\\/]+(?=[A-Z0-9])/i, '')
    .replace(/(?<=[A-Z0-9])[>)\]}|\\/]+$/i, '');
  // A number's 0 read as the letter O (O4A is room 04A).
  if (/^O\d{1,3}[A-Z]?$/.test(t)) return `0${t.slice(1)}`;
  const tag = /^\[?([A-Z]{1,4})[=_]([0-9]{1,3}[A-Z]?)\]?$/.exec(t);
  if (tag) return `${tag[1]}-${tag[2]}`;
  const scale = /^(\d+(?:\/\d+)?|\d+-\d+\/\d+)"\s*=\s*1(?:['-]\S*)?$/.exec(t);
  if (scale) return `${scale[1]}" = 1'-0"`;
  return t;
}

/** Shapes worth keeping even when OCR is unsure of them: a scale, a type tag. */
const STRONG = /^(\d+(?:\/\d+)?|\d+-\d+\/\d+)" = 1'-0"$|^1:\d{2,4}$|^[A-Z]{1,4}-\d{1,3}[A-Z]?$/;

/** Is this word worth keeping: confident, and not a lone mark that linework reads as (|, -, l). */
function keep(w: OcrWord): boolean {
  const t = w.text.trim();
  if (!t || (w.conf < MIN_CONF && !(w.conf >= 5 && STRONG.test(t)))) return false;
  if (!/[A-Z0-9]/i.test(t)) return false;
  // A single letter is linework far more often than a word, except a grid or detail letter on its own.
  if (t.length === 1 && !/[A-Z0-9]/.test(t)) return false;
  return true;
}

/**
 * The words as runs: words on one OCR line and close together (a gap under the letters' height)
 * join into one run, as a PDF's text layer would carry "3/16" = 1'-0"" or "MEETING ROOM"; a wider
 * gap (schedule columns) starts a new run.
 */
export function ocrRuns(words: OcrWord[]): OcrRun[] {
  const lines = new Map<string, OcrWord[]>();
  for (const raw of words) {
    const w = { ...raw, text: ocrNormal(raw.text) };
    if (!keep(w)) continue;
    lines.set(`${w.rot}|${w.line}`, [...(lines.get(`${w.rot}|${w.line}`) ?? []), w]);
  }
  const out: OcrRun[] = [];
  for (const ws of lines.values()) {
    const rot = ws[0]!.rot;
    // Along the reading direction: x for level text, up the sheet (−y) for text reading upwards.
    const along = (w: OcrWord) => (rot === 0 ? [w.x0, w.x1] : [-w.y1, -w.y0]) as [number, number];
    const across = (w: OcrWord) => (rot === 0 ? w.y1 - w.y0 : w.x1 - w.x0);
    ws.sort((a, b) => along(a)[0] - along(b)[0]);
    let run: OcrWord[] = [];
    const flush = () => {
      if (!run.length) return;
      const h = Math.max(...run.map(across));
      const s = Math.min(...run.map((w) => along(w)[0]));
      const e = Math.max(...run.map((w) => along(w)[1]));
      const str = run.map((w) => w.text.trim()).join(' ');
      if (rot === 0) out.push({ str, x: s, y: Math.max(...run.map((w) => w.y1)), h, w: e - s, rot });
      else out.push({ str, x: Math.max(...run.map((w) => w.x1)), y: -s, h, w: e - s, rot });
      run = [];
    };
    for (const w of ws) {
      const last = run[run.length - 1];
      if (last && along(w)[0] - along(last)[1] > Math.max(across(last), across(w)) * 1.0) flush();
      run.push(w);
    }
    flush();
  }
  return out;
}

/** Do two boxes overlap (with a little slack)? */
const overlaps = (a: [number, number, number, number], b: [number, number, number, number], pad: number) =>
  a[0] < b[2] + pad && b[0] < a[2] + pad && a[1] < b[3] + pad && b[1] < a[3] + pad;

/** A run's box on the sheet as shown. */
export function runBox(r: OcrRun): [number, number, number, number] {
  return r.rot === 0 ? [r.x, r.y - r.h, r.x + r.w, r.y] : [r.x - r.h, r.y - r.w, r.x, r.y];
}

interface TextItemLike {
  str: string;
  dir: string;
  width: number;
  height: number;
  transform: number[];
  fontName: string;
  hasEOL: boolean;
}

/**
 * The runs as pdf.js text items in the page's own (PDF) space: the transform carries the
 * baseline's start and direction, its size the letters' height (a font's capitals are about 0.7
 * of its size, as `pageTexts` assumes).
 */
export function runsAsItems(runs: OcrRun[], viewport: { convertToPdfPoint(x: number, y: number): number[] }): TextItemLike[] {
  return runs.map((r) => {
    const [ex, ey] = viewport.convertToPdfPoint(r.x, r.y) as [number, number];
    const step = r.rot === 0 ? [1, 0] : [0, -1];
    const [fx, fy] = viewport.convertToPdfPoint(r.x + step[0]!, r.y + step[1]!) as [number, number];
    const n = Math.hypot(fx - ex, fy - ey) || 1;
    const [dx, dy] = [(fx - ex) / n, (fy - ey) / n];
    const size = r.h / 0.7;
    return { str: r.str, dir: 'ltr', width: r.w, height: size, transform: [size * dx, size * dy, -size * dy, size * dx, ex, ey], fontName: 'ocr', hasEOL: false };
  });
}

/** Words in a page's own text layer: a page with only its title block in text needs OCR for the rest. */
const wordCount = (items: { str?: string }[]) => items.reduce((n, it) => n + (it.str?.trim() ? it.str.trim().split(/\s+/).length : 0), 0);

/**
 * The document with OCR'd text on pages whose own text layer is (nearly) empty: their text
 * content is the PDF's own items plus the OCR runs that are not already there. Each page is read
 * once. Pages with text of their own are left as they are.
 */
export interface OcrTextOptions {
  /**
   * Read only flattened documents: a sample of the document's pages is checked first, and a set
   * whose sheets mostly carry their own text (a vector set with a few sparse elevations) is left
   * to its own text. The app uses this so a drawing set opens without minutes of OCR.
   */
  flattenedOnly?: boolean;
  /** Give up on a page's OCR after this long and use its own text (the app must never stall on a read). */
  timeoutMs?: number;
}

/** Pages sampled to decide whether a document is flattened. */
const SAMPLE_PAGES = 8;

export function withOcrText<D extends PDFDocumentProxy>(pdf: D, ocr: PageOcr, opts: OcrTextOptions = {}): D {
  const done = new Map<number, Promise<unknown>>();
  const getPage = pdf.getPage.bind(pdf);
  let flattened: Promise<boolean> | null = null;
  const isFlattened = () =>
    (flattened ??= (async () => {
      const n = pdf.numPages;
      const picks = [...new Set(Array.from({ length: Math.min(SAMPLE_PAGES, n) }, (_, i) => 1 + Math.floor((i * n) / Math.min(SAMPLE_PAGES, n))))];
      let sparse = 0;
      for (const k of picks) {
        try {
          const pg = await getPage(k);
          // Its own text: a page already given OCR text must not wait on this check.
          const own = (pg as { ownTextContent?: PDFPageProxy['getTextContent'] }).ownTextContent ?? pg.getTextContent.bind(pg);
          if (wordCount((await own()).items as TextItemLike[]) < OCR_BELOW_WORDS) sparse++;
        } catch {
          sparse++;
        }
      }
      return sparse * 2 > picks.length;
    })());
  // After one sheet runs out of time the document is left to its own text: the reader is too slow
  // for this set here, and every further sheet would only queue behind it.
  let gaveUp = false;
  const timed = (page: PDFPageProxy): Promise<OcrWord[]> =>
    opts.timeoutMs
      ? Promise.race([
          ocr(page),
          new Promise<OcrWord[]>((_, no) =>
            setTimeout(() => {
              gaveUp = true;
              no(new Error('OCR timed out'));
            }, opts.timeoutMs),
          ),
        ])
      : ocr(page);
  const patched = async (n: number) => {
    const page = await getPage(n);
    if ((page as { __ocr?: boolean }).__ocr) return page;
    const own = page.getTextContent.bind(page);
    (page as { __ocr?: boolean }).__ocr = true;
    // The page's own text, without OCR (its title block's sheet number as the PDF has it).
    (page as { ownTextContent?: typeof own }).ownTextContent = own;
    page.getTextContent = ((params?: Parameters<PDFPageProxy['getTextContent']>[0]) => {
      if (!done.has(n))
        done.set(
          n,
          (async () => {
            const content = await own(params);
            const items = content.items as TextItemLike[];
            if (wordCount(items) >= OCR_BELOW_WORDS) return content;
            if (gaveUp || (opts.flattenedOnly && !(await isFlattened()))) return content;
            let words: OcrWord[] = [];
            try {
              if (gaveUp) return content;
              words = await timed(page);
            } catch {
              return content;
            }
            const vp = page.getViewport({ scale: 1 });
            // The page's own text, as boxes on the sheet, so OCR does not add it twice.
            const ownBoxes = items
              .filter((it) => it.str?.trim())
              .map((it) => {
                const [x, y] = vp.convertToViewportPoint(it.transform[4]!, it.transform[5]!) as [number, number];
                const s = Math.hypot(it.transform[2]!, it.transform[3]!) || 1;
                return [x, y - s, x + Math.max(it.width, s), y] as [number, number, number, number];
              });
            const runs = ocrRuns(words).filter((r) => !ownBoxes.some((b) => overlaps(runBox(r), b, 1)));
            if (runs.length) (page as { ocrRead?: boolean }).ocrRead = true;
            return { ...content, items: [...content.items, ...runsAsItems(runs, vp)] };
          })(),
        );
      return done.get(n) as ReturnType<PDFPageProxy['getTextContent']>;
    }) as PDFPageProxy['getTextContent'];
    return page;
  };
  pdf.getPage = patched as D['getPage'];
  return pdf;
}
