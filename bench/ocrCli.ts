import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { segmentsOf } from '../src/fill/sheetWalls';
import { mosaicLayout, tagBoxes, withTagWords, wordsFromMosaic, type Box } from '../src/ocrTags';
import type { OcrWord, PageOcr } from '../src/ocrText';

/**
 * OCR in the benchmark: the page rendered by pdftoppm and read by the tesseract command, level and
 * turned a quarter (text along vertical walls), cached outside the job (OCR_CACHE, else the system's
 * temp folder) by the file's path, size and date, so a set is read once and its folder never written to.
 * The app reads pages with Tesseract in the browser instead (src/ocr.ts); both hand words to
 * src/ocrText.ts. Off with OCR=0, or when the commands are missing.
 */

const run = promisify(execFile);
const DPI = 200;

let available: boolean | null = null;
async function haveCommands(): Promise<boolean> {
  if (available === null)
    available = await Promise.all([run('tesseract', ['--version']), run('pdftoppm', ['-v'])]).then(
      () => true,
      () => false,
    );
  return available;
}

/** Tesseract's TSV words (pixels of the image it read). */
function tsvWords(tsv: string): { text: string; l: number; t: number; w: number; h: number; conf: number; line: string }[] {
  const out = [];
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5' || !c[11]!.trim()) continue;
    out.push({ text: c[11]!, l: +c[6]!, t: +c[7]!, w: +c[8]!, h: +c[9]!, conf: +c[10]!, line: `${c[2]}.${c[3]}.${c[4]}` });
  }
  return out;
}

async function tesseract(png: Buffer): Promise<string> {
  const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
    const p = execFile('tesseract', ['stdin', 'stdout', '--psm', '11', 'tsv'], { maxBuffer: 64 << 20 }, (err, stdout) => (err ? reject(err) : resolve({ stdout })));
    p.stdin!.end(png);
  });
  return stdout;
}

/** OCR for pages of the PDF at `path`, or null when OCR is off or not installed. */
export async function cliOcr(path: string): Promise<PageOcr | null> {
  if (process.env.OCR === '0' || !(await haveCommands())) return null;
  const st = statSync(path);
  const cache = join(process.env.OCR_CACHE ?? join(tmpdir(), 'takeoff-ocr'), createHash('sha1').update(`${realpathSync(path)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16));
  const pageWords = async (n: number): Promise<OcrWord[]> => {
    const file = join(cache, `${n}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as OcrWord[];
    const { stdout: png } = await run('pdftoppm', ['-f', String(n), '-l', String(n), '-r', String(DPI), '-gray', '-png', '-singlefile', path], { encoding: 'buffer', maxBuffer: 256 << 20 });
    const k = 72 / DPI;
    const meta = await sharp(png).metadata();
    const H = meta.height!;
    const words: OcrWord[] = tsvWords(await tesseract(png)).map((w) => ({ text: w.text, x0: w.l * k, y0: w.t * k, x1: (w.l + w.w) * k, y1: (w.t + w.h) * k, conf: w.conf, line: w.line, rot: 0 }));
    // Turned a quarter clockwise, text reading up the sheet reads level: (u, v) there is (v, H − u) here.
    const turned = await sharp(png).rotate(90).png().toBuffer();
    for (const w of tsvWords(await tesseract(turned))) {
      const word: OcrWord = { text: w.text, x0: w.t * k, x1: (w.t + w.h) * k, y0: (H - (w.l + w.w)) * k, y1: (H - w.l) * k, conf: w.conf, line: w.line, rot: 90 };
      // Level text read again sideways: keep the level reading.
      if (!words.some((o) => o.rot === 0 && o.x0 < word.x1 && word.x0 < o.x1 && o.y0 < word.y1 && word.y0 < o.y1)) words.push(word);
    }
    mkdirSync(cache, { recursive: true });
    writeFileSync(file, JSON.stringify(words));
    return words;
  };
  // Tags in their symbols, read off a mosaic of the symbols cut out at high resolution (src/ocrTags.ts).
  const tagWords = async (n: number, boxes: Box[]): Promise<OcrWord[]> => {
    // Keyed by the symbols cut out, so a change in which shapes count reads them again.
    const file = join(cache, `${n}.tags-${createHash('sha1').update(JSON.stringify(boxes.map((b) => b.map((v) => Math.round(v))))).digest('hex').slice(0, 10)}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as OcrWord[];
    let out: OcrWord[] = [];
    if (boxes.length) {
      const k = TAG_DPI / 72;
      const { stdout: png } = await run('pdftoppm', ['-f', String(n), '-l', String(n), '-r', String(TAG_DPI), '-gray', '-png', '-singlefile', path], { encoding: 'buffer', maxBuffer: 512 << 20 });
      const { data: page, info } = await sharp(png, { limitInputPixels: false }).raw().toBuffer({ resolveWithObject: true });
      const layout = mosaicLayout(boxes, k, Math.round(4 * k), 3000);
      const mosaic = Buffer.alloc(layout.width * layout.height, 255);
      const band = Math.round(0.9 * k);
      for (const t of layout.tiles) {
        const [sx, sy] = [Math.round(t.box[0] * k), Math.round(t.box[1] * k)];
        for (let y = band; y < t.h - band; y++)
          for (let x = band; x < t.w - band; x++) {
            // A turned tile's (x, y) is the symbol's (y, H − x), H its height in pixels (= the tile's width).
            const [px, py] = t.turned ? [sx + y, sy + t.w - 1 - x] : [sx + x, sy + y];
            if (px < 0 || py < 0 || px >= info.width || py >= info.height) continue;
            mosaic[(t.y + y) * layout.width + t.x + x] = page[py * info.width * info.channels + px * info.channels]!;
          }
      }
      const img = await sharp(mosaic, { raw: { width: layout.width, height: layout.height, channels: 1 } }).png().toBuffer();
      out = wordsFromMosaic(
        tsvWords(await tesseract(img)).map((w) => ({ text: w.text, conf: w.conf, x0: w.l, y0: w.t, x1: w.l + w.w, y1: w.t + w.h })),
        layout.tiles,
        k,
      );
    }
    mkdirSync(cache, { recursive: true });
    writeFileSync(file, JSON.stringify(out));
    return out;
  };
  return async (page) => {
    const n = page.pageNumber;
    const words = await pageWords(n);
    if (process.env.OCR_TAGS === '0') return words;
    const boxes = tagBoxes(await segmentsOf(page)).slice(0, MAX_TAGS);
    return withTagWords(words, await tagWords(n, boxes), boxes);
  };
}

/** Tags are read at this resolution, and at most this many symbols per sheet. */
const TAG_DPI = 360;
const MAX_TAGS = 2500;
