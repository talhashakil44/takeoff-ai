import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
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
  const cache = join(process.env.OCR_CACHE ?? join(tmpdir(), 'takeoff-ocr'), createHash('sha1').update(`${path}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16));
  return async (page) => {
    const n = page.pageNumber;
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
}
