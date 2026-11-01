import type { Segment } from './fill/vectors';
import type { PageText } from './pageText';
import { drawingTitles, scaleNotes, textLinesOf } from './sheetScale';
import { parseScale } from './units';

/** An axis-aligned box on the sheet: [x0, y0, x1, y1]. */
export type Box = [number, number, number, number];

/**
 * One drawing on a sheet that holds several at different scales (Kelso S2.1: the low and high
 * roof framing plans at 1:100, the canopy framing plan at 1:50): where its linework lies, and the
 * scale noted under its title.
 */
export interface SheetView {
  title: string;
  box: Box;
  scaleLabel: string;
  metersPerPoint: number;
}

const CELL = 8;

/**
 * The drawings on a sheet with their own scales. Each drawing is a body of linework set apart
 * from the others by blank paper; its title (with the scale noted beside it) sits under or within
 * it. A body whose titles note different scales, or none, is left out, and so is the sheet's
 * border and title block (lines spanning most of the sheet are not part of any drawing).
 */
export function sheetViews(texts: PageText[], segs: Segment[], width: number, height: number): SheetView[] {
  const lines = textLinesOf(texts);
  const notes = scaleNotes(texts, lines);
  // Drawings only: a schedule, legend or assembly list notes no scale of its own (a scale beside one is a detail's).
  const titled = drawingTitles(texts, lines).filter((t) => !/SCHEDULE|LEGEND|ASSEMBL|TYPES|NOTES/i.test(t.str)).flatMap((t) => {
    const near = notes
      .map((n) => ({ n, d: Math.hypot(Math.max(0, n.box[0] - t.box[2], t.box[0] - n.box[2]), Math.max(0, n.box[1] - t.box[3], t.box[1] - n.box[3])) }))
      .sort((a, b) => a.d - b.d)[0];
    return near && near.d <= Math.max(t.h, near.n.h) * 6 ? [{ t, label: near.n.label }] : [];
  });
  if (!titled.length) return [];

  // The linework, rasterised to cells of CELL points.
  const cols = Math.ceil(width / CELL) + 1;
  const rows = Math.ceil(height / CELL) + 1;
  const ink = new Uint8Array(cols * rows);
  for (const s of segs) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    if (Math.abs(dx) > width * 0.75 || Math.abs(dy) > height * 0.75) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (CELL / 2)));
    for (let i = 0; i <= n; i++) {
      const x = Math.floor((s.x1 + (dx * i) / n) / CELL);
      const y = Math.floor((s.y1 + (dy * i) / n) / CELL);
      if (x >= 0 && y >= 0 && x < cols && y < rows) ink[y * cols + x] = 1;
    }
  }
  // Bodies of linework: cells within `join` cells of each other join, inside `within`.
  const bodies = (within: Box | null, join: number): Box[] => {
    const label = new Int32Array(cols * rows).fill(-1);
    const found: Box[] = [];
    const stack: number[] = [];
    const [x0, y0, x1, y1] = within ? [within[0] / CELL, within[1] / CELL, within[2] / CELL - 1, within[3] / CELL - 1] : [0, 0, cols - 1, rows - 1];
    const inside = (cx: number, cy: number) => cx >= x0 && cy >= y0 && cx <= x1 && cy <= y1;
    for (let start = 0; start < ink.length; start++) {
      if (!ink[start] || label[start] >= 0 || !inside(start % cols, Math.floor(start / cols))) continue;
      const id = found.length;
      const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
      label[start] = id;
      stack.push(start);
      while (stack.length) {
        const c = stack.pop()!;
        const cx = c % cols;
        const cy = (c - cx) / cols;
        b[0] = Math.min(b[0], cx * CELL);
        b[1] = Math.min(b[1], cy * CELL);
        b[2] = Math.max(b[2], (cx + 1) * CELL);
        b[3] = Math.max(b[3], (cy + 1) * CELL);
        for (let oy = -join; oy <= join; oy++)
          for (let ox = -join; ox <= join; ox++) {
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !inside(nx, ny)) continue;
            const k = ny * cols + nx;
            if (ink[k] && label[k] < 0) {
              label[k] = id;
              stack.push(k);
            }
          }
      }
      found.push(b);
    }
    return found;
  };

  // The emptiest band across a body between two of its titles: [the part before, the part after].
  const gutter = (b: Box, titles: Box[]): [Box, Box] | null => {
    let best: { n: number; across: number; cut: [Box, Box] } | null = null;
    for (const axis of [0, 1] as const) {
      const lo = axis === 0 ? b[0] : b[1];
      const hi = axis === 0 ? b[2] : b[3];
      const centres = titles.map((t) => (axis === 0 ? (t[0] + t[2]) / 2 : (t[1] + t[3]) / 2)).sort((p, q) => p - q);
      for (let i = 1; i < centres.length; i++) {
        // Between the two titles' extents along this axis.
        const from = Math.ceil(centres[i - 1] / CELL);
        const to = Math.floor(centres[i] / CELL);
        for (let c = from + 1; c < to; c++) {
          let n = 0;
          const [a0, a1] = axis === 0 ? [b[1] / CELL, b[3] / CELL] : [b[0] / CELL, b[2] / CELL];
          for (let k = a0; k < a1; k++) if (ink[axis === 0 ? k * cols + c : c * cols + k]) n++;
          const x = c * CELL;
          if (x - lo < 80 || hi - x < 80) continue;
          if (!best || n < best.n)
            best = { n, across: a1 - a0, cut: axis === 0 ? [[b[0], b[1], x, b[3]], [x + CELL, b[1], b[2], b[3]]] : [[b[0], b[1], b[2], x], [b[0], x + CELL, b[2], b[3]]] };
        }
      }
    }
    // A gutter is blank paper crossed by a few lines, not a drawing's middle.
    return best && best.n <= Math.max(4, best.across * 0.06) ? best.cut : null;
  };

  const out: SheetView[] = [];
  const take = (b: Box, split: boolean) => {
    if (b[2] - b[0] < 80 || b[3] - b[1] < 80) return;
    // Its titles: within it, or just under it.
    const mine = titled.filter(({ t }) => {
      const cx = (t.box[0] + t.box[2]) / 2;
      const top = t.box[1];
      return cx >= b[0] && cx <= b[2] && top >= b[1] && top <= b[3] + Math.max(30, t.h * 4);
    });
    const labels = new Set(mine.map((x) => x.label));
    // Drawings at different scales joined by a line running from one into the other (Kelso
    // Addendum 5 S2.0: the elevator plan and the main plan): split at the emptiest column or row
    // of the body between their titles, where only a few lines cross, once.
    if (labels.size > 1) {
      const cut = split ? gutter(b, mine.map((x) => x.t.box)) : null;
      if (cut) for (const half of cut) for (const sub of bodies(half, 2)) take(sub, false);
      return;
    }
    if (labels.size !== 1) return;
    const scaleLabel = [...labels][0];
    const mpp = parseScale(scaleLabel);
    if (!mpp) return;
    out.push({ title: mine.map((x) => x.t.str).join(' / '), box: b, scaleLabel, metersPerPoint: mpp });
  };
  for (const b of bodies(null, 2)) take(b, true);
  return out;
}

/** The scale of the one view all these points lie in; null when they lie in none, or span views. */
export function viewScaleAt(views: SheetView[] | undefined, points: [number, number][]): SheetView | null {
  if (!views?.length || !points.length) return null;
  const inside = views.filter((v) => points.every(([x, y]) => x >= v.box[0] && x <= v.box[2] && y >= v.box[1] && y <= v.box[3]));
  const labels = new Set(inside.map((v) => v.scaleLabel));
  return labels.size === 1 ? inside[0] : null;
}
