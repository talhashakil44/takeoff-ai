import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

/**
 * The OCR engine's files (worker, the WebAssembly core, English data) served from the app
 * itself, so reading a scanned title block works offline and from the desktop app.
 */
export function ocrAssets() {
  const copy = () => {
    const req = createRequire(import.meta.url);
    const out = join(process.cwd(), 'public', 'ocr');
    mkdirSync(out, { recursive: true });
    const tjs = dirname(req.resolve('tesseract.js/package.json'));
    const core = dirname(req.resolve('tesseract.js-core/package.json'));
    const eng = dirname(req.resolve('@tesseract.js-data/eng/package.json'));
    const files = [
      [join(tjs, 'dist/worker.min.js'), 'worker.min.js'],
      ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [join(core, f), f]),
      [join(eng, '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
    ];
    for (const [from, to] of files) if (!existsSync(join(out, to))) copyFileSync(from, join(out, to));
  };
  return { name: 'ocr-assets', config: copy };
}
