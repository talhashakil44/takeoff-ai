import { del, get, set } from 'idb-keyval';
import type { PDFPageProxy } from 'pdfjs-dist';

/**
 * Rendered sheets, kept so a sheet opened before shows at once: the last few in memory, more of
 * them on this computer (a WebP each), the oldest dropped. A drawing set's pages never change
 * (a reissue is a new document), so a sheet's picture is good for as long as it is kept.
 */

export const BASE_MAX_PX = 4096;
const MEMORY = 4;
const DISK = 120;
const INDEX = 'sheetbmp:index';
const key = (docId: string, page: number) => `sheetbmp:${docId}:${page}:${BASE_MAX_PX}`;

const memory = new Map<string, CanvasImageSource & { width: number; height: number }>();
const remember = (k: string, img: CanvasImageSource & { width: number; height: number }) => {
  memory.delete(k);
  memory.set(k, img);
  while (memory.size > MEMORY) memory.delete(memory.keys().next().value!);
};

/** The scale a sheet's base picture is drawn at. */
export const baseScale = (w: number, h: number) => Math.min(BASE_MAX_PX / Math.max(w, h), 2);

/** A sheet's picture kept from before, if there is one. */
export async function cachedSheet(docId: string, page: number): Promise<(CanvasImageSource & { width: number; height: number }) | null> {
  const k = key(docId, page);
  const m = memory.get(k);
  if (m) {
    remember(k, m);
    return m;
  }
  try {
    const blob = await get<Blob>(k);
    if (!blob || typeof createImageBitmap === 'undefined') return null;
    const bmp = await createImageBitmap(blob);
    remember(k, bmp);
    return bmp;
  } catch {
    return null;
  }
}

let writes: Promise<unknown> = Promise.resolve();
/** Keeps a sheet's freshly rendered picture: in memory now, on this computer when the browser is idle. */
export function keepSheet(docId: string, page: number, canvas: HTMLCanvasElement) {
  const k = key(docId, page);
  remember(k, canvas);
  if (typeof indexedDB === 'undefined') return;
  const idle = (f: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 4000 }) : setTimeout(f, 800));
  idle(() => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        writes = writes
          .then(async () => {
            await set(k, blob);
            const list = ((await get<string[]>(INDEX)) ?? []).filter((x) => x !== k);
            list.push(k);
            while (list.length > DISK) await del(list.shift()!);
            await set(INDEX, list);
          })
          .catch(() => undefined);
      },
      'image/webp',
      0.82,
    );
  });
}

/** Renders a sheet's base picture (the whole sheet, up to 4096 px). */
export function renderSheet(page: PDFPageProxy, w: number, h: number) {
  const viewport = page.getViewport({ scale: baseScale(w, h) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const task = page.render({ canvas, viewport });
  return { canvas, task };
}

/** Whether a sheet's picture is kept already (memory or this computer). */
export async function hasSheet(docId: string, page: number) {
  const k = key(docId, page);
  if (memory.has(k)) return true;
  try {
    return !!(await get<Blob>(k));
  } catch {
    return false;
  }
}
