export type SourceBox = [number, number, number, number];
/** PDF point coordinates; retain nearby context and bound the raster allocation. */
export function sourceRegion(box: SourceBox, width: number, height: number) {
  if (![...box, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || box[2] <= box[0] || box[3] <= box[1]) return null;
  const x0 = Math.max(0, box[0]), y0 = Math.max(0, box[1]);
  const x1 = Math.min(width, box[2]), y1 = Math.min(height, box[3]);
  if (x1 <= x0 || y1 <= y0) return null;
  const pad = Math.max(30, Math.max(x1 - x0, y1 - y0) * .15);
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
  const right = Math.min(width, x1 + pad), bottom = Math.min(height, y1 + pad);
  return { left, top, width: right - left, height: bottom - top,
    scale: Math.min(4, 1800 / Math.max(right - left, bottom - top)) };
}

export interface SourceTile {
  page: HTMLCanvasElement;
  box: SourceBox;
  pageWidth: number;
  pageHeight: number;
}
