import type { Pt } from '../model';
import type { PageText } from '../pageText';
import { matchSymbol, sampleSymbol, type SymbolSample } from './symbols';
import type { Segment } from './vectors';

type Box = [number, number, number, number];

/** How a line is drawn: its pen width and ink. */
export interface PenStyle {
  width: number;
  color?: string;
}

/** One straight piece of pipe, with the size it was given. */
export interface PipePiece {
  a: Pt;
  b: Pt;
  /** Nominal size as printed ("25", "100", '1-1/4"'); null when none could be given. */
  size: string | null;
  /** The size was not printed along this piece: it was carried on from a labelled one or taken as the smallest. */
  assumed: boolean;
}

export type FittingKind = 'tee' | 'elbow' | 'cross' | 'cap';

export interface Fitting {
  kind: FittingKind;
  at: Pt;
  /** The largest pipe size meeting there. */
  size: string | null;
}

export interface PipeNetwork {
  style: PenStyle;
  pieces: PipePiece[];
  fittings: Fitting[];
}

const len = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const segLen = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const samePen = (s: Segment, p: PenStyle) => Math.abs(s.width - p.width) <= 0.01 + p.width * 0.03 && s.color === p.color;
const keyOf = (s: Segment) => `${s.width.toFixed(2)}|${s.color ?? ''}`;

function distToSeg([px, py]: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2));
  return { d: Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy)), t };
}

/** Points bucketed on a grid for quick lookups. */
class Grid<T> {
  private cells = new Map<string, T[]>();
  constructor(readonly cell: number) {}
  private k(x: number, y: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }
  add(x: number, y: number, v: T) {
    const k = this.k(x, y);
    (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(v);
  }
  near(x: number, y: number, r = 1): T[] {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const out: T[] = [];
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (const v of this.cells.get(`${cx + i},${cy + j}`) ?? []) out.push(v);
    return out;
  }
}

/** Small closed shapes in a pen (heads, valves drawn in the pipe's pen): their lines are not pipe. */
function symbolLines(lines: Segment[], pen: number): Set<Segment> {
  const shapes = new Map<number, Segment[]>();
  for (const s of lines) if (s.sub !== undefined) (shapes.get(s.sub) ?? shapes.set(s.sub, []).get(s.sub)!).push(s);
  const out = new Set<Segment>();
  const small = Math.max(16, pen * 20);
  for (const g of shapes.values()) {
    if (g.length < 3) continue;
    const xs = g.flatMap((s) => [s.x1, s.x2]);
    const ys = g.flatMap((s) => [s.y1, s.y2]);
    const closed = Math.hypot(g[0].x1 - g[g.length - 1].x2, g[0].y1 - g[g.length - 1].y2) < 0.5;
    if (closed && Math.max(...xs) - Math.min(...xs) <= small && Math.max(...ys) - Math.min(...ys) <= small) for (const s of g) out.add(s);
  }
  return out;
}

/** The straight lines of one pen and ink, less its symbols, the sheet's frame and what lies in `avoid`. */
export function linesOfStyle(segs: Segment[], style: PenStyle, sheet: { width: number; height: number }, avoid: Box[] = []): Segment[] {
  const same = segs.filter((s) => !s.filled && !s.curve && s.width > 0 && segLen(s) > 0.2 && samePen(s, style));
  const symbol = symbolLines(same, style.width);
  const { width, height } = sheet;
  const edge = Math.min(width, height) * 0.03;
  const onFrame = (s: Segment) =>
    (Math.max(s.x1, s.x2) < edge || Math.min(s.x1, s.x2) > width - edge || Math.max(s.y1, s.y2) < edge || Math.min(s.y1, s.y2) > height - edge) && segLen(s) > width * 0.2;
  const inside = (x: number, y: number) => avoid.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  // A curve drawn as a chain of short straight pieces (a break mark, a swirl) is not pipe.
  const shapes = new Map<number, Segment[]>();
  for (const s of same) if (s.sub !== undefined) (shapes.get(s.sub) ?? shapes.set(s.sub, []).get(s.sub)!).push(s);
  const wiggle = new Set<Segment>();
  for (const g of shapes.values()) if (g.length >= 4 && g.reduce((n, s) => n + segLen(s), 0) / g.length < 1.5) for (const s of g) wiggle.add(s);
  // The same line drawn twice counts once.
  const seen = new Set<string>();
  const key = (s: Segment) => {
    const a = `${Math.round(s.x1 * 2)},${Math.round(s.y1 * 2)}`;
    const b = `${Math.round(s.x2 * 2)},${Math.round(s.y2 * 2)}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  return same.filter((s) => {
    if (symbol.has(s) || wiggle.has(s) || onFrame(s) || inside(s.x1, s.y1) || inside(s.x2, s.y2)) return false;
    const k = key(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The pen the sprinkler pipe is drawn in: of the straight lines on the sheet, the pen and ink
 * whose line ends land on the most sprinkler heads. Null when no pen reaches a few of them.
 */
export function pipeStyle(segs: Segment[], heads: Pt[], sheet: { width: number; height: number }, avoid: Box[] = []): PenStyle | null {
  if (!heads.length) return null;
  const grid = new Grid<Pt>(16);
  for (const h of heads) grid.add(h[0], h[1], h);
  const near = (x: number, y: number) => grid.near(x, y).some((h) => Math.hypot(h[0] - x, h[1] - y) <= 8);
  const score = new Map<string, { style: PenStyle; heads: Set<Pt>; length: number }>();
  for (const s of segs) {
    if (s.filled || s.curve || s.width <= 0 || segLen(s) < 1) continue;
    const k = keyOf(s);
    const e = score.get(k) ?? score.set(k, { style: { width: s.width, color: s.color }, heads: new Set(), length: 0 }).get(k)!;
    e.length += segLen(s);
    for (const [x, y] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ])
      if (near(x, y)) for (const h of grid.near(x, y)) if (Math.hypot(h[0] - x, h[1] - y) <= 8) e.heads.add(h);
  }
  const best = [...score.values()].sort((a, b) => b.heads.size - a.heads.size || b.length - a.length)[0];
  if (!best || best.heads.size < Math.min(5, Math.ceil(heads.length * 0.3))) return null;
  // Only the lines that are pipe: those left once its symbols, frame and title block are off.
  return linesOfStyle(segs, best.style, sheet, avoid).length ? best.style : null;
}

/** Nominal pipe sizes, as printed: millimetres or inches. */
const MM = new Set([15, 20, 25, 32, 40, 50, 65, 80, 90, 100, 125, 150, 200, 250, 300]);
const INCH = /^(\d(?:[- ]\d\/\d)?|\d\/\d)\s*(?:"|''|IN\.?)\s*(?:Ø|DIA\.?)?$/i;

/** A pipe size from a label ("25", "25Ø", "100 mm", '1-1/4"'), or null when it is not one. */
export function pipeSizeOf(str: string): string | null {
  const s = str.trim().replace(/\s+/g, ' ');
  const mm = s.match(/^(\d{2,3})\s*(?:Ø|MM|mm|DIA\.?)?\s*(?:Ø)?$/);
  if (mm && MM.has(Number(mm[1]))) return mm[1];
  const inch = s.match(INCH);
  if (inch) return `${inch[1].replace(' ', '-')}"`;
  return null;
}

/** Sorts sizes smallest first: mm by number, inches by value. */
export function sizeValue(size: string): number {
  if (!size.endsWith('"')) return Number(size);
  const s = size.slice(0, -1);
  const [whole, frac] = s.includes('-') ? s.split('-') : s.includes('/') ? ['0', s] : [s, ''];
  const [n, d] = frac ? frac.split('/').map(Number) : [0, 1];
  return (Number(whole) + n / d) * 25.4;
}

/**
 * The sprinkler pipe network on a sheet: its pieces, each sized from the labels printed
 * along it (carried straight on through joints and reducers to the next label, the
 * smallest size where none reaches), and its fittings: tees, crosses, elbows and capped ends.
 */
export function sprinklerNetwork(segs: Segment[], texts: PageText[], heads: Pt[], style: PenStyle, sheet: { width: number; height: number }, avoid: Box[] = []): PipeNetwork {
  const lines = linesOfStyle(segs, style, sheet, avoid);
  // Join tolerance: line ends this close meet, and a line ending on another's side is a tee.
  const tol = Math.max(0.6, style.width);

  // Pieces, split where another line ends on their side so every joint is a shared point.
  let pieces: [Pt, Pt][] = lines.map((s) => [
    [s.x1, s.y1],
    [s.x2, s.y2],
  ]);
  const ends = new Grid<Pt>(8);
  for (const [a, b] of pieces) {
    ends.add(a[0], a[1], a);
    ends.add(b[0], b[1], b);
  }
  const split: [Pt, Pt][] = [];
  for (const [a, b] of pieces) {
    const cuts: { t: number; p: Pt }[] = [];
    const L = len(a, b);
    const reach = Math.ceil(L / 16) + 1;
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const p of ends.near(mid[0], mid[1], reach)) {
      if (p === a || p === b) continue;
      const { d, t } = distToSeg(p, a, b);
      if (d <= tol && t * L > tol && (1 - t) * L > tol) cuts.push({ t, p });
    }
    cuts.sort((x, y) => x.t - y.t);
    let from = a;
    for (const c of cuts) {
      const at: Pt = [a[0] + c.t * (b[0] - a[0]), a[1] + c.t * (b[1] - a[1])];
      split.push([from, at]);
      from = at;
    }
    split.push([from, b]);
  }
  pieces = split.filter(([a, b]) => len(a, b) > 0.05);

  // Joints: line ends within the tolerance are one node.
  const nodes: { at: Pt; pieces: number[] }[] = [];
  const nodeGrid = new Grid<number>(8);
  const nodeOf = (p: Pt) => {
    for (const n of nodeGrid.near(p[0], p[1])) if (len(nodes[n].at, p) <= tol) return n;
    nodes.push({ at: p, pieces: [] });
    nodeGrid.add(p[0], p[1], nodes.length - 1);
    return nodes.length - 1;
  };
  const ends2 = pieces.map(([a, b], i) => {
    const na = nodeOf(a);
    const nb = nodeOf(b);
    nodes[na].pieces.push(i);
    nodes[nb].pieces.push(i);
    return [na, nb] as const;
  });

  // Sizes: each label goes to the piece it is printed along (parallel, close, within its length).
  const sizes: (string | null)[] = pieces.map(() => null);
  const pieceGrid = new Grid<number>(16);
  pieces.forEach(([a, b], i) => {
    const n = Math.max(1, Math.ceil(len(a, b) / 16));
    for (let k = 0; k <= n; k++) pieceGrid.add(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, i);
  });
  for (const t of texts) {
    const size = pipeSizeOf(t.str);
    if (!size) continue;
    const ang = t.angle ?? 0;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    let best: { i: number; d: number } | null = null;
    for (const i of new Set(pieceGrid.near(t.cx, t.cy))) {
      const [a, b] = pieces[i];
      const L = len(a, b);
      // Printed along the pipe: its baseline runs the pipe's way.
      if (Math.abs(((b[0] - a[0]) * ux + (b[1] - a[1]) * uy) / L) < 0.9) continue;
      const { d, t: along } = distToSeg([t.cx, t.cy], a, b);
      if (along <= 0 || along >= 1) continue;
      if (d <= t.h * 2.5 + style.width && (!best || d < best.d)) best = { i, d };
    }
    if (best) sizes[best.i] = size;
  }
  const printed = sizes.map((s) => s !== null);

  // Carried on: straight through a joint, from labelled pieces outward, nearest label first.
  const dir = (i: number, from: number): [number, number] => {
    const [a, b] = pieces[i];
    const [p, q] = ends2[i][0] === from ? [a, b] : [b, a];
    const L = len(p, q) || 1;
    return [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
  };
  const queue: { i: number; d: number }[] = sizes.flatMap((s, i) => (s ? [{ i, d: 0 }] : []));
  const dist = pieces.map((_, i) => (sizes[i] ? 0 : Infinity));
  while (queue.length) {
    queue.sort((x, y) => x.d - y.d);
    const { i, d } = queue.shift()!;
    if (d > dist[i]) continue;
    for (const end of ends2[i]) {
      const out = dir(i, end);
      for (const j of nodes[end].pieces) {
        if (j === i || printed[j]) continue;
        // Straight on only: a branch off a tee is its own size.
        const [jx, jy] = dir(j, end);
        if (out[0] * jx + out[1] * jy > -0.97) continue;
        const nd = d + len(...pieces[j]);
        if (nd < dist[j]) {
          dist[j] = nd;
          sizes[j] = sizes[i];
          queue.push({ i: j, d: nd });
        }
      }
    }
  }
  // Pieces no label reaches: branch lines and arm-overs, drawn the smallest size on the sheet.
  const smallest = [...new Set(sizes.filter((s): s is string => !!s))].sort((a, b) => sizeValue(a) - sizeValue(b))[0] ?? null;
  const out: PipePiece[] = pieces.map(([a, b], i) => ({ a, b, size: sizes[i] ?? smallest, assumed: !printed[i] }));

  // Fittings at the joints.
  const headGrid = new Grid<Pt>(16);
  for (const h of heads) headGrid.add(h[0], h[1], h);
  const atHead = (p: Pt) => headGrid.near(p[0], p[1]).some((h) => len(h, p) <= 10);
  const biggest = (ids: number[]) => ids.map((i) => out[i].size).filter((s): s is string => !!s).sort((a, b) => sizeValue(b) - sizeValue(a))[0] ?? null;
  const fittings: Fitting[] = [];
  const loose = nodes.map((n, k) => (n.pieces.length === 1 ? k : -1)).filter((k) => k >= 0);
  const looseGrid = new Grid<number>(16);
  for (const k of loose) looseGrid.add(nodes[k].at[0], nodes[k].at[1], k);
  for (const [k, n] of nodes.entries()) {
    const deg = n.pieces.length;
    if (deg >= 4) fittings.push({ kind: 'cross', at: n.at, size: biggest(n.pieces) });
    else if (deg === 3) fittings.push({ kind: 'tee', at: n.at, size: biggest(n.pieces) });
    else if (deg === 2) {
      const [d1, d2] = n.pieces.map((i) => dir(i, k));
      if (d1[0] * d2[0] + d1[1] * d2[1] > -0.9) fittings.push({ kind: 'elbow', at: n.at, size: biggest(n.pieces) });
    } else if (deg === 1) {
      // An end at a head is its outlet; an end facing another end across a gap is a break in the drawing (a pipe passing over another).
      if (atHead(n.at)) continue;
      if (looseGrid.near(n.at[0], n.at[1]).some((m) => m !== k && len(nodes[m].at, n.at) <= 12)) continue;
      fittings.push({ kind: 'cap', at: n.at, size: biggest(n.pieces) });
    }
  }
  return { style, pieces: out, fittings };
}

/** What a head symbol looks like, which names the head type. */
export type HeadShape = 'triangle' | 'open circle' | 'circle with dot' | 'circle with slash' | 'other';

export interface HeadGroup {
  shape: HeadShape;
  sample: SymbolSample;
  at: Pt[];
}

/** Circles and triangles a few points across: what sprinkler heads are drawn as. */
function headCandidates(segs: Segment[], avoid: Box[]): { at: Pt; box: Box }[] {
  const shapes = new Map<number, Segment[]>();
  for (const s of segs) if (s.sub !== undefined && !s.filled) (shapes.get(s.sub) ?? shapes.set(s.sub, []).get(s.sub)!).push(s);
  const inside = (x: number, y: number) => avoid.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  const out: { at: Pt; box: Box }[] = [];
  for (const g of shapes.values()) {
    const circle = g.length >= 8 && g.every((s) => s.curve);
    // A leader's arrowhead is a hairline; a head is drawn in a pen.
    const triangle = g.length === 3 && g.every((s) => !s.curve && s.width > 0);
    if (!circle && !triangle) continue;
    const xs = g.flatMap((s) => [s.x1, s.x2]);
    const ys = g.flatMap((s) => [s.y1, s.y2]);
    const box: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const w = box[2] - box[0];
    const h = box[3] - box[1];
    // Heads print a few millimetres across; connection dots and valve handles are smaller.
    if (w < 4.5 || h < 4.5 || w > 16 || h > 16 || Math.max(w, h) / Math.min(w, h) > (triangle ? 1.35 : 1.2)) continue;
    if (Math.hypot(g[0].x1 - g[g.length - 1].x2, g[0].y1 - g[g.length - 1].y2) > 0.6) continue;
    const at: Pt = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    if (!inside(at[0], at[1])) out.push({ at, box });
  }
  return out;
}

/** Names a head symbol by its drawing: ▲, ○, ◉ or ⊘. */
function shapeOf(sample: SymbolSample, segs: Segment[], box: Box): HeadShape {
  const inBox = segs.filter((s) => s.x1 >= box[0] - 0.5 && s.x2 >= box[0] - 0.5 && s.x1 <= box[2] + 0.5 && s.x2 <= box[2] + 0.5 && s.y1 >= box[1] - 0.5 && s.y2 >= box[1] - 0.5 && s.y1 <= box[3] + 0.5 && s.y2 <= box[3] + 0.5);
  if (!inBox.some((s) => s.curve)) return 'triangle';
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  const r = (box[2] - box[0]) / 2;
  // A slash: a line in a pen right across the ring, through its middle (the pipe running in
  // to a head ends at the middle, so it is not one).
  const near = segs.filter((s) => !s.curve && s.width > 0 && Math.hypot((s.x1 + s.x2) / 2 - cx, (s.y1 + s.y2) / 2 - cy) < r);
  const across = near.some((s) => {
    const a = [s.x1 - cx, s.y1 - cy];
    const b = [s.x2 - cx, s.y2 - cy];
    const opposite = a[0] * b[0] + a[1] * b[1] < 0;
    const far = Math.hypot(a[0], a[1]) > r * 0.6 && Math.hypot(b[0], b[1]) > r * 0.6;
    return opposite && far && distToSeg([cx, cy], [s.x1, s.y1], [s.x2, s.y2]).d < r * 0.3;
  });
  if (across) return 'circle with slash';
  const ring = inBox.filter((s) => s.curve && Math.abs(Math.hypot((s.x1 + s.x2) / 2 - cx, (s.y1 + s.y2) / 2 - cy) - r) < r * 0.25);
  const inner = inBox.filter((s) => !ring.includes(s) && Math.hypot((s.x1 + s.x2) / 2 - cx, (s.y1 + s.y2) / 2 - cy) < r * 0.6);
  return inner.length >= 3 ? 'circle with dot' : sample.lines.length ? 'open circle' : 'other';
}

/** Whether a point sits on a pipe: at a line's end or along it. */
function onPipe(at: Pt, lines: Segment[], reach: number): boolean {
  return lines.some((s) => distToSeg(at, [s.x1, s.y1], [s.x2, s.y2]).d <= reach);
}

/**
 * The sprinkler heads on a sheet, found with nothing marked: the circles and triangles the
 * pipe runs to, each kind counted everywhere it is drawn (on the pipe or not).
 */
export function findHeads(segs: Segment[], pipe: Segment[], avoid: Box[] = []): HeadGroup[] {
  const grid = new Grid<Segment>(24);
  for (const s of pipe) grid.add((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, s);
  const candidates = headCandidates(segs, avoid).filter((c) => {
    const reach = (c.box[2] - c.box[0]) / 2 + 3;
    return onPipe(c.at, grid.near(c.at[0], c.at[1], 2), reach);
  });
  const inside = (x: number, y: number) => avoid.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  const taken = new Grid<Pt>(16);
  const isTaken = (p: Pt) => taken.near(p[0], p[1]).some((q) => len(p, q) <= 5);
  const groups: HeadGroup[] = [];
  for (const c of candidates) {
    if (isTaken(c.at)) continue;
    const pad = 1;
    const box: Box = [c.box[0] - pad, c.box[1] - pad, c.box[2] + pad, c.box[3] + pad];
    const sample = sampleSymbol(segs, box);
    if (!sample) continue;
    // One copy per place: matches closer than the symbol's own size are the same head.
    const size = Math.max(c.box[2] - c.box[0], c.box[3] - c.box[1]);
    const at: Pt[] = [];
    for (const m of matchSymbol(sample, segs)) {
      const p = m.at;
      if (inside(p[0], p[1]) || isTaken(p) || at.some((q) => len(p, q) < size)) continue;
      at.push(p);
    }
    // A kind is a head when most of its copies sit on the pipe.
    const piped = at.filter((p) => onPipe(p, grid.near(p[0], p[1], 2), (c.box[2] - c.box[0]) / 2 + 3)).length;
    // A head's linework is about as wide as it is tall.
    const xs = sample.lines.flatMap((l) => [l.x1, l.x2]);
    const ys = sample.lines.flatMap((l) => [l.y1, l.y2]);
    const [sw, sh] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    if (at.length < 3 || piped < at.length * 0.5 || Math.max(sw, sh) / Math.max(0.1, Math.min(sw, sh)) > 1.5) {
      taken.add(c.at[0], c.at[1], c.at);
      continue;
    }
    for (const p of at) taken.add(p[0], p[1], p);
    groups.push({ shape: shapeOf(sample, segs, c.box), sample, at });
  }
  return groups;
}

/** Everything on a sprinkler sheet: the pipe network and the heads, or null when there is no pipe to find. */
export function readSprinklerSheet(segs: Segment[], texts: PageText[], sheet: { width: number; height: number }, avoid: Box[] = []): { network: PipeNetwork; heads: HeadGroup[] } | null {
  const candidates = headCandidates(segs, avoid).map((c) => c.at);
  const style = pipeStyle(segs, candidates, sheet, avoid);
  if (!style) return null;
  const pipe = linesOfStyle(segs, style, sheet, avoid);
  const heads = findHeads(segs, pipe, avoid);
  const network = sprinklerNetwork(segs, texts, heads.flatMap((g) => g.at), style, sheet, avoid);
  return { network, heads };
}

/** Pieces of one size joined end to end into runs (a measurement each), broken at fittings. */
export function runsOf(pieces: PipePiece[]): { size: string | null; points: Pt[] }[] {
  const bySize = new Map<string, PipePiece[]>();
  for (const p of pieces) (bySize.get(p.size ?? '') ?? bySize.set(p.size ?? '', []).get(p.size ?? '')!).push(p);
  const runs: { size: string | null; points: Pt[] }[] = [];
  const k = (p: Pt) => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}`;
  for (const [size, list] of bySize) {
    const at = new Map<string, number[]>();
    list.forEach((p, i) => {
      for (const e of [p.a, p.b]) (at.get(k(e)) ?? at.set(k(e), []).get(k(e))!).push(i);
    });
    const used = new Set<number>();
    for (let i = 0; i < list.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      const grow = (from: Pt): Pt[] => {
        const pts: Pt[] = [];
        let here = from;
        for (let guard = 0; guard < 100000; guard++) {
          const next = (at.get(k(here)) ?? []).filter((j) => !used.has(j));
          if ((at.get(k(here)) ?? []).length !== 2 || next.length !== 1) break;
          used.add(next[0]);
          const p = list[next[0]];
          here = k(p.a) === k(here) ? p.b : p.a;
          pts.push(here);
        }
        return pts;
      };
      const p = list[i];
      runs.push({ size: size || null, points: [...grow(p.a).reverse(), p.a, p.b, ...grow(p.b)] });
    }
  }
  return runs;
}
