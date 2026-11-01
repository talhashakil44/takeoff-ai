import { mergeTessellated } from './tessellation';
import type { Sheet } from '../model';
import type { PDFPageProxy } from '../pdf';
import { buildWallModel, type WallModel } from './roomFill';
import { extractSegments, type Segment } from './vectors';

/**
 * Wall models per sheet. Reading a sheet's linework takes a few seconds on a dense
 * plan, so segments are kept per page and the model is rebuilt only when the scale
 * or the opening size changes.
 */
// A dense sheet's linework runs to hundreds of thousands of segments, and pdf.js keeps
// page objects alive, so only the last few sheets used are kept.
const KEEP = 4;
const segmentCache = new Map<PDFPageProxy, Promise<Segment[]>>();
const modelCache = new Map<PDFPageProxy, Map<string, WallModel>>();

function touch(page: PDFPageProxy) {
  const p = segmentCache.get(page);
  if (!p) return;
  segmentCache.delete(page);
  segmentCache.set(page, p);
  while (segmentCache.size > KEEP) {
    const oldest = segmentCache.keys().next().value!;
    segmentCache.delete(oldest);
    modelCache.delete(oldest);
  }
}

export function segmentsOf(page: PDFPageProxy): Promise<Segment[]> {
  let p = segmentCache.get(page);
  if (!p) {
    p = page.getOperatorList().then((ops) => {
      const vp = page.getViewport({ scale: 1 });
      return mergeTessellated(extractSegments(ops.fnArray, ops.argsArray, vp.transform as [number, number, number, number, number, number]));
    });
    // A failed read is not kept, so the next try reads again.
    p.catch(() => segmentCache.delete(page));
    segmentCache.set(page, p);
  }
  touch(page);
  return p;
}

/** A page's segments read once without keeping them (for scanning every sheet); frees the page after. */
export async function segmentsOnce(page: PDFPageProxy): Promise<Segment[]> {
  const cached = segmentCache.get(page);
  if (cached) return cached;
  const ops = await page.getOperatorList();
  const vp = page.getViewport({ scale: 1 });
  const segs = mergeTessellated(extractSegments(ops.fnArray, ops.argsArray, vp.transform as [number, number, number, number, number, number]));
  page.cleanup();
  return segs;
}

export async function wallModelFor(page: PDFPageProxy, sheet: Sheet, maxOpening: number, keepGrid = false): Promise<WallModel> {
  const key = `${sheet.metersPerPoint ?? 'none'}|${maxOpening}|${keepGrid}`;
  let byKey = modelCache.get(page);
  if (!byKey) modelCache.set(page, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const model = buildWallModel(await segmentsOf(page), sheet.metersPerPoint, { maxOpening, keepGrid });
  byKey.set(key, model);
  return model;
}
