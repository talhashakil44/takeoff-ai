import type { PDFPageProxy } from './pdf';

/** A run of text on the sheet: its centre and size in sheet points. */
export interface PageText {
  str: string;
  cx: number;
  cy: number;
  /** Width along the baseline and the height of its capitals. */
  w: number;
  h: number;
  /** The baseline's direction on the sheet, in radians (0 reads left to right). */
  angle?: number;
}

/** Every text run on the page, trimmed, positioned by its centre. */
export async function pageTexts(page: PDFPageProxy): Promise<PageText[]> {
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const out: PageText[] = [];
  // Some files carry their text twice in the same place (an OCR layer over the original): once is enough.
  const seen = new Set<string>();
  const key = (str: string, x: number, y: number) => `${str}|${Math.round(x / 2)}|${Math.round(y / 2)}`;
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const str = item.str.trim();
    if (!str) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    const n = Math.hypot(a, b) || 1;
    const size = Math.hypot(c, d) || 1;
    // Centre: half the width along the baseline, a third of the size up.
    const [cx, cy] = vp.convertToViewportPoint(e + (a / n) * (item.width / 2) + (c / size) * size * 0.35, f + (b / n) * (item.width / 2) + (d / size) * size * 0.35);
    const [x0, y0] = vp.convertToViewportPoint(e, f);
    const [x1, y1] = vp.convertToViewportPoint(e + a / n, f + b / n);
    const k = key(str, cx, cy);
    if (seen.has(k) || seen.has(key(str, cx + 1, cy)) || seen.has(key(str, cx - 1, cy)) || seen.has(key(str, cx, cy + 1)) || seen.has(key(str, cx, cy - 1))) continue;
    seen.add(k);
    out.push({ str, cx, cy, w: item.width, h: size * 0.7, angle: Math.atan2(y1 - y0, x1 - x0) });
  }
  return out;
}
