import type { Segment } from './fill/vectors';
import type { OcrWord } from './ocrText';

/**
 * Tags in their symbols, read one by one: a drawing's room numbers in ovals, wall types in
 * hexagons, door numbers in boxes are lettered small, and a whole-sheet OCR pass loses them to
 * the outline around them. Each small closed shape on the sheet is cut out at high resolution,
 * its outline whited out, and all of them are laid side by side in one picture (a mosaic) that is
 * read in one go; each word read is put back where its shape is on the sheet.
 */

export type Box = [number, number, number, number];

/** Small closed shapes on the sheet, in sheet points: the symbols tags are written in. */
export function tagBoxes(segs: Segment[], min = 6, max = 48): Box[] {
  const subs = new Map<number, Segment[]>();
  for (const s of segs) if (!s.filled && s.sub !== undefined) (subs.get(s.sub) ?? subs.set(s.sub, []).get(s.sub)!).push(s);
  const out: Box[] = [];
  for (const list of subs.values()) {
    if (list.length < 3) continue;
    const xs = list.flatMap((s) => [s.x1, s.x2]);
    const ys = list.flatMap((s) => [s.y1, s.y2]);
    const b: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const [w, h] = [b[2] - b[0], b[3] - b[1]];
    if (w < min || h < min * 0.5 || w > max * 2 || h > max || w / h > 6 || h / w > 3) continue;
    // Closed: it ends where it starts.
    const first = list[0]!;
    const last = list[list.length - 1]!;
    if (Math.hypot(first.x1 - last.x2, first.y1 - last.y2) > Math.max(w, h) * 0.08) continue;
    out.push(b);
  }
  // A box inside another not much bigger (a tag's double outline) is the same tag: keep the outer.
  const area = (b: Box) => (b[2] - b[0]) * (b[3] - b[1]);
  const kept: Box[] = [];
  for (const b of out.sort((p, q) => area(q) - area(p)))
    if (!kept.some((o) => o[0] <= b[0] + 0.5 && o[1] <= b[1] + 0.5 && o[2] >= b[2] - 0.5 && o[3] >= b[3] - 0.5 && area(o) < area(b) * 2.5)) kept.push(b);
  return kept;
}

/** Where each shape's cut-out goes in the mosaic, in its pixels. */
export interface Tile {
  box: Box;
  /** Top-left of the tile in the mosaic, and its size. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Shapes laid out in rows, `gap` pixels apart, at `k` pixels per point, at most `width` wide. */
export function mosaicLayout(boxes: Box[], k: number, gap: number, width: number): { tiles: Tile[]; width: number; height: number } {
  const tiles: Tile[] = [];
  let x = gap;
  let y = gap;
  let row = 0;
  let wide = 0;
  for (const box of boxes) {
    const w = Math.ceil((box[2] - box[0]) * k);
    const h = Math.ceil((box[3] - box[1]) * k);
    if (x + w + gap > width && x > gap) {
      x = gap;
      y += row + gap;
      row = 0;
    }
    tiles.push({ box, x, y, w, h });
    x += w + gap;
    row = Math.max(row, h);
    wide = Math.max(wide, x);
  }
  return { tiles, width: Math.max(wide, gap * 2), height: y + row + gap };
}

/** Words read off the mosaic (its pixels), back on the sheet: each in the shape whose tile holds it. */
export function wordsFromMosaic(words: { text: string; conf: number; x0: number; y0: number; x1: number; y1: number }[], tiles: Tile[], k: number): OcrWord[] {
  const out: OcrWord[] = [];
  for (const w of words) {
    const [cx, cy] = [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2];
    const i = tiles.findIndex((t) => cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h);
    if (i < 0) continue;
    const t = tiles[i]!;
    const at = (px: number, py: number): [number, number] => [t.box[0] + (px - t.x) / k, t.box[1] + (py - t.y) / k];
    const [x0, y0] = at(w.x0, w.y0);
    const [x1, y1] = at(w.x1, w.y1);
    out.push({ text: w.text, conf: w.conf, x0, y0, x1, y1, line: `tag${i}`, rot: 0 });
  }
  return out;
}

/** The page's words with each shape's own reading in place of what the page pass made of it. */
export function withTagWords(page: OcrWord[], tags: OcrWord[], boxes: Box[]): OcrWord[] {
  const read = new Set(tags.map((t) => t.line));
  const inRead = (w: OcrWord) => {
    const [cx, cy] = [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2];
    return boxes.some((b, i) => read.has(`tag${i}`) && cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]);
  };
  return [...page.filter((w) => !inRead(w)), ...tags];
}
