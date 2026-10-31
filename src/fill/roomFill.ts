import { gridLines } from './dimensions';
import type { Pt } from '../model';
import { drawSegments, fillHoles, floodFill, makeGrid, simplify, toSheet, traceBoundary, type Grid } from './raster';
import type { Segment } from './vectors';
import { SegmentIndex } from '../walls/bands';
import { bridgeGaps, detectWallPens, penStats, symbolShapes, wallShapedFills, widthKey, type PenStats } from './walls';

export interface WallModel {
  /** Wall linework plus the lines that close door and window openings. */
  lines: Segment[];
  pens: string[];
  stats: PenStats[];
  bridges: number;
  /** The floor strip across each closed opening, between the bridges on its two wall faces. */
  openings: Pt[][];
  /**
   * The same sheet with the next lighter pen that also draws in wall-like pairs taken as
   * wall too (walls drawn lighter: existing walls on a renovation, thin partitions), or
   * null when there is none. For rooms that do not close, or swallow another room's tag,
   * with the pens chosen for the whole sheet. `skip` passes over pens known not to be
   * walls (the pen the room tags are drawn in).
   */
  lighter?: (skip?: (pen: string) => boolean) => WallModel | null;
  /** The range of wall thicknesses looked for, in sheet points. */
  thickness?: [number, number];
  /** Small symbols in the wall pens (keynote triangles, tag diamonds), left out of `lines`. */
  symbols?: Segment[];
}

/**
 * Pens that also draw in wall-like pairs but were not taken as the sheet's walls, heaviest
 * first: candidates for walls drawn lighter. Solid fills shaped like walls (poché) first.
 */
export function lighterPens(stats: PenStats[], chosen: string[]): string[] {
  const most = Math.max(0, ...stats.map((s) => s.paired));
  const lightest = Math.min(...chosen.map(Number).filter((n) => !Number.isNaN(n)));
  const paired = stats.filter((s) => !chosen.includes(s.key) && s.length > 0 && s.paired >= most * 0.05 && s.paired / s.length >= 0.4);
  const fill = paired.filter((s) => s.key === 'fill').map((s) => s.key);
  const stroked = paired
    .filter((s) => s.key !== 'fill' && Number(s.key) < lightest && Number(s.key) > 0)
    .sort((a, b) => Number(b.key) - Number(a.key))
    .map((s) => s.key);
  return [...fill, ...stroked].slice(0, 3);
}

/**
 * Lines by direction (bins of π/64 centred on the right angles) and, within a direction, by
 * where their start crosses its normal: the lines running about a line's way a given distance
 * to one side of it, without looking at every line of the sheet.
 */
class ParallelIndex {
  private static BINS = 64;
  private bins = new Map<number, { rho: Float64Array; idx: Int32Array }>();
  private t: Float64Array;
  private bin: Int32Array;
  private reach: number;
  constructor(
    private lines: Segment[],
    lens: number[],
  ) {
    const n = ParallelIndex.BINS;
    const w = Math.PI / n;
    this.t = new Float64Array(lines.length);
    this.bin = new Int32Array(lines.length);
    const raw = new Map<number, number[]>();
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    lines.forEach((s, i) => {
      x0 = Math.min(x0, s.x1);
      y0 = Math.min(y0, s.y1);
      x1 = Math.max(x1, s.x1);
      y1 = Math.max(y1, s.y1);
      if (!(lens[i] > 0)) return;
      let t = Math.atan2((s.y2 - s.y1) / lens[i], (s.x2 - s.x1) / lens[i]);
      if (t < 0) t += Math.PI;
      if (t >= Math.PI) t -= Math.PI;
      const b = Math.round(t / w) % n;
      this.t[i] = t;
      this.bin[i] = b;
      // Found from its own bin and the two beside it (2° either way can cross into one).
      for (const q of new Set([b, (b + 1) % n, (b + n - 1) % n])) {
        const list = raw.get(q);
        if (list) list.push(i);
        else raw.set(q, [i]);
      }
    });
    // The farthest two starts can be apart.
    this.reach = Number.isFinite(x0) ? Math.hypot(x1 - x0, y1 - y0) : 0;
    for (const [q, ids] of raw) {
      const [nx, ny] = [-Math.sin(q * w), Math.cos(q * w)];
      const rho = ids.map((i) => lines[i].x1 * nx + lines[i].y1 * ny);
      const order = ids.map((_, m) => m).sort((a, b) => rho[a] - rho[b]);
      this.bins.set(q, { rho: Float64Array.from(order, (m) => rho[m]), idx: Int32Array.from(order, (m) => ids[m]) });
    }
  }
  /** Indices (ascending) of lines that may run within 2° of line `of` with their start `lo` to `hi` to its left (along its normal): every such line, and others. */
  near(of: number, lo: number, hi: number): number[] {
    const a = this.lines[of];
    const w = Math.PI / ParallelIndex.BINS;
    const q = this.bin[of];
    const entry = this.bins.get(q);
    if (!entry) return [];
    // The bin's normal is turned from the line's by up to half a bin: offsets across the sheet differ by up to its reach times that.
    const dt = Math.abs(this.t[of] - q * w);
    const slack = this.reach * Math.min(dt, Math.PI - dt) * 1.001 + 1e-6 * (1 + this.reach);
    const [nx, ny] = [-Math.sin(q * w), Math.cos(q * w)];
    const rho = a.x1 * nx + a.y1 * ny;
    // The line's normal may point either way along the bin's.
    const out: number[] = [];
    for (const [from, to] of [
      [rho + lo - slack, rho + hi + slack],
      [rho - hi - slack, rho - lo + slack],
    ]) {
      let l = 0;
      let h = entry.rho.length;
      while (l < h) {
        const m = (l + h) >> 1;
        if (entry.rho[m] < from) l = m + 1;
        else h = m;
      }
      for (let m = l; m < entry.rho.length && entry.rho[m] <= to; m++) out.push(entry.idx[m]);
    }
    return [...new Set(out)].sort((x, y) => x - y);
  }
}

/**
 * Pairs the bridges on the two faces of one opening into the strip between them,
 * so Shift+click can join the spaces either side of it.
 */
export function openingStrips(bridges: Segment[], maxThickness: number): Pt[][] {
  const out: Pt[][] = [];
  const lens = bridges.map((b) => Math.hypot(b.x2 - b.x1, b.y2 - b.y1));
  const facing = new ParallelIndex(bridges, lens);
  for (let i = 0; i < bridges.length; i++) {
    const a = bridges[i];
    const La = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
    if (La < 0.5) continue;
    const ux = (a.x2 - a.x1) / La;
    const uy = (a.y2 - a.y1) / La;
    let best: { d: number; t1: number; t2: number; b: Segment } | null = null;
    for (const j of facing.near(i, 0.2, maxThickness)) {
      const b = bridges[j];
      if (j === i) continue;
      const Lb = lens[j];
      if (Lb < 0.5 || Math.abs(ux * (b.y2 - b.y1) - uy * (b.x2 - b.x1)) / Lb > 0.035) continue;
      const d = (b.x1 - a.x1) * -uy + (b.y1 - a.y1) * ux;
      if (d <= 0.2 || d > maxThickness) continue; // one side only, so each strip is made once
      const t1 = (b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy;
      const t2 = (b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy;
      const ov = Math.min(La, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
      if (ov < 0.5 * Math.min(La, Lb)) continue;
      if (!best || d < best.d) best = { d, t1, t2, b };
    }
    if (!best) continue;
    const lo = Math.max(0, Math.min(best.t1, best.t2));
    const hi = Math.min(La, Math.max(best.t1, best.t2));
    const at = (t: number, off: number): Pt => [a.x1 + ux * t - uy * off, a.y1 + uy * t + ux * off];
    out.push([at(lo, 0), at(hi, 0), at(hi, best.d), at(lo, best.d)]);
  }
  return out;
}

/**
 * Door leaves: straight lines from a swing's centre (the hinge) to one end of the arc.
 * Their far end is as far from both ends of the arc (the radius), which a wall line
 * meeting the arc at the jamb is not.
 */
export function doorLeaves(segs: Segment[]): Set<Segment> {
  const arcs = new Map<number, Segment[]>();
  for (const s of segs) {
    if (!s.curve || s.filled || s.sub === undefined) continue;
    const list = arcs.get(s.sub);
    if (list) list.push(s);
    else arcs.set(s.sub, [s]);
  }
  const ends: [Pt, Pt][] = [...arcs.values()].map((pieces) => [
    [pieces[0].x1, pieces[0].y1],
    [pieces[pieces.length - 1].x2, pieces[pieces.length - 1].y2],
  ]);
  const out = new Set<Segment>();
  if (!ends.length) return out;
  const d = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  for (const s of segs) {
    if (s.curve || s.filled) continue;
    const p: Pt = [s.x1, s.y1];
    const q: Pt = [s.x2, s.y2];
    const len = d(p, q);
    if (len < 3) continue;
    for (const [a, b] of ends) {
      for (const [touch, far] of [
        [p, q],
        [q, p],
      ] as const) {
        const atA = d(touch, a) < 1 ? b : d(touch, b) < 1 ? a : null;
        if (atA && Math.abs(d(far, atA) - len) < 0.1 * len) out.add(s);
      }
    }
  }
  return out;
}

/**
 * Picks the wall linework out of a sheet's segments and closes openings.
 * Wall thickness and the widest opening to close are real-world sizes, so the
 * sheet scale is used when known.
 */
export function buildWallModel(
  segs: Segment[],
  metersPerPoint: number | null,
  options: { pens?: string[]; maxOpening?: number; stats?: PenStats[]; extra?: string[]; keepGrid?: boolean } = {},
): WallModel {
  const { pens, maxOpening = 3.0 } = options;
  // Grid lines bound no room (a lobby filled to one stops halfway across). (Dimension lines are left
  // in: taking them out helped the dev sets no more than this alone and cost the sealed set an item.)
  const pt = (m: number, fallback: number) => (metersPerPoint ? m / metersPerPoint : fallback);
  // (`keepGrid`: a plan whose walls are drawn on its grid lines, tried for rooms that leak without them.)
  const grid = options.keepGrid ? new Set<Segment>() : gridLines(segs, { min: pt(0.06, 1.5), max: pt(0.7, 20) });
  if (grid.size) segs = segs.filter((s) => !grid.has(s));
  let stats = options.stats ?? penStats(segs, pt(0.06, 1.5), pt(0.7, 20));
  let chosen = pens?.length ? pens : detectWallPens(stats);
  if (!chosen.length && !options.stats) {
    // Walls exploded into short pieces pair poorly piece by piece: score joined runs.
    // Strictly: a sheet of details joined into runs can pair nearly as well as walls.
    stats = penStats(segs, pt(0.06, 1.5), pt(0.7, 20), true);
    chosen = detectWallPens(stats, [0.5]);
  }
  const wallFill = chosen.includes('fill') ? wallShapedFills(segs, pt(0.06, 1.5), pt(0.7, 20)) : null;
  // Dots (a carpet stipple in the wall pen) are no part of a wall, and nor are doors: a swing
  // drawn in the wall pen, and its leaf, would otherwise cut the swing out of the room.
  const leaves = doorLeaves(segs);
  const symbols = symbolShapes(segs, pt(1.5, 42));
  const walls = segs.filter(
    (s) => chosen.includes(widthKey(s)) && !s.curve && !leaves.has(s) && !symbols.has(s) && (!s.filled || wallFill?.has(s)) && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= 0.3,
  );
  // Glazing and frames are drawn with lighter pens than walls, but heavier than hatching.
  const wallWidth = Math.min(...chosen.map(Number).filter((n) => !Number.isNaN(n)));
  const glazingLines = segs.filter((s) => !s.filled && !chosen.includes(widthKey(s)) && s.width >= wallWidth * 0.6);
  // Openings up to maxOpening metres (doors, including entrance pairs with frames) close
  // regardless; longer ones close only where glazing runs along them (windows,
  // storefronts). Wider open archways stay open.
  const bridges = bridgeGaps(walls, pt(maxOpening, maxOpening * 28), {
    lines: glazingLines,
    maxGap: pt(Math.max(10, maxOpening), 280),
    band: pt(0.7, 20),
  });
  // Walls drawn lighter, tried room by room. Only from the sheet's own pick (pens given by
  // the caller are taken as they are).
  const extra = options.extra ?? (pens?.length ? [] : chosen.length ? lighterPens(stats, chosen) : []);
  const next = new Map<string, WallModel>();
  return {
    lines: [...walls, ...bridges],
    pens: chosen,
    stats,
    bridges: bridges.length,
    openings: openingStrips(bridges, pt(0.7, 20)),
    thickness: [pt(0.06, 1.5), pt(0.7, 20)],
    symbols: [...symbols].filter((s) => chosen.includes(widthKey(s))),
    lighter: (skip) => {
      const i = extra.findIndex((p) => !skip?.(p));
      if (i < 0) return null;
      let m = next.get(extra[i]);
      if (!m) next.set(extra[i], (m = buildWallModel(segs, metersPerPoint, { maxOpening, pens: [...chosen, extra[i]], stats, extra: extra.slice(i + 1), keepGrid: options.keepGrid })));
      return m;
    },
  };
}

export type RoomFill =
  /** `openings`: how much of the outline runs across closed openings (doors), in sheet points. */
  | { ok: true; points: Pt[]; openings: number }
  | { ok: false; reason: 'on-wall' | 'not-closed' | 'no-walls' | 'not-connected' };

/** Max pixels per raster; keeps memory and time bounded on full sheets. */
const MAX_PIXELS = 20e6;

function gridAround(cx: number, cy: number, half: number, sheetW: number, sheetH: number): Grid {
  const x0 = Math.max(0, cx - half);
  const y0 = Math.max(0, cy - half);
  const w = Math.min(sheetW, cx + half) - x0;
  const h = Math.min(sheetH, cy + half) - y0;
  const res = Math.min(2, Math.sqrt(MAX_PIXELS / (w * h)));
  return makeGrid(x0, y0, w, h, res);
}

/** Nearest free pixel to a click that landed on a line. */
function freePixelNear(g: Grid, x: number, y: number): [number, number] | null {
  for (let r = 0; r <= 4; r++) {
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const px = x + i;
        const py = y + j;
        if (px >= 0 && py >= 0 && px < g.w && py < g.h && !g.data[py * g.w + px]) return [px, py];
      }
    }
  }
  return null;
}

/** Morphological closing (dilate then erode) by r pixels: joins regions split by thin lines. */
function close(region: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const pass = (src: Uint8Array, grow: boolean) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let j = -r; j <= r && v === (grow ? 0 : 1); j++) {
          for (let i = -r; i <= r; i++) {
            const px = x + i;
            const py = y + j;
            const s = px >= 0 && py >= 0 && px < w && py < h ? src[py * w + px] : 0;
            if (grow && s) {
              v = 1;
              break;
            }
            if (!grow && !s) {
              v = 0;
              break;
            }
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  return pass(pass(region, true), false);
}

const toGrid = (g: Grid, poly: Pt[]): Pt[] => poly.map(([x, y]) => [(x - g.x0) * g.res, (y - g.y0) * g.res]);

/** Adds a strip's pixels to the region when the strip borders two different labelled spaces. */
function addStripBetween(g: Grid, quad: Pt[], label: Uint8Array, region: Uint8Array) {
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const pad = 3;
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad);
  const x1 = Math.min(g.w - 1, Math.ceil(Math.max(...xs)) + pad);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
  const y1 = Math.min(g.h - 1, Math.ceil(Math.max(...ys)) + pad);
  if (x0 > x1 || y0 > y1) return;
  const seen = new Set<number>();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (label[y * g.w + x]) seen.add(label[y * g.w + x]);
  if (seen.size < 2) return;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (insidePoly(quad, x + 0.5, y + 0.5)) region[y * g.w + x] = 1;
  }
}

function insidePoly(poly: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a region is one 4-connected piece. */
function connected(region: Uint8Array, w: number, h: number): boolean {
  const first = region.indexOf(1);
  if (first < 0) return true;
  const g: Grid = { w, h, x0: 0, y0: 0, res: 1, data: region.map((v) => 1 - v) };
  const reached = floodFill(g, first % w, Math.floor(first / w)).pixels;
  let total = 0;
  for (const v of region) total += v;
  return reached === total;
}

/**
 * Fills the room(s) containing the given points, bounded only by walls (furniture,
 * text and door swings do not count), and returns its outline on the inside face of
 * the walls. Several points join adjacent spaces split by a closed opening.
 */
/**
 * How much of an outline runs along the lines that close openings (doorways): the part
 * of a room's perimeter with no wall, which base and wall finishes skip.
 */
export function openingLength(points: Pt[], model: WallModel): number {
  // Doorways only: under a window the wall (and its base and finish) carries on.
  const bridges = model.lines.filter((s) => s.bridge && !s.window);
  if (!bridges.length) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1) continue;
    // Opening lines running the same way as this edge.
    const along = bridges.filter((s) => {
      const Ls = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      return Ls > 0 && Math.abs(((bx - ax) * (s.y2 - s.y1) - (by - ay) * (s.x2 - s.x1)) / (L * Ls)) < 0.1;
    });
    if (!along.length) continue;
    // Sample the edge every point or so; a sample beside an opening line (not past its ends) counts.
    const steps = Math.max(2, Math.ceil(L));
    let near = 0;
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      if (along.some((s) => besideSegment(x, y, s) <= 1.5)) near++;
    }
    total += (L * near) / steps;
  }
  return total;
}

const faceIndex = new WeakMap<WallModel, SegmentIndex>();

/**
 * How much of an outline runs along the face of a wall: a drawn line with another line
 * parallel to it a wall thickness further out (the wall's other face), or a closed
 * opening. A room is bounded by walls; a space cut out by a door swing or the edge of a
 * table is not, for most of its outline.
 */
export function wallFaceShare(points: Pt[], model: WallModel): number {
  const [minGap, maxGap] = model.thickness ?? [1.5, 20];
  let index = faceIndex.get(model);
  if (!index) faceIndex.set(model, (index = new SegmentIndex(model.lines, 16)));
  const lines = model.lines;
  // Outward normal: the ring's winding decides which side is out.
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    twice += ax * by - bx * ay;
  }
  const sign = twice > 0 ? 1 : -1;
  let total = 0;
  let face = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 0.5) continue;
    const ux = (bx - ax) / L;
    const uy = (by - ay) / L;
    // Outward normal for a counter-clockwise ring in y-down sheet space.
    const nx = sign * uy;
    const ny = sign * -ux;
    const steps = Math.max(1, Math.round(L / 2));
    for (let k = 0; k < steps; k++) {
      const t = ((k + 0.5) / steps) * L;
      const x = ax + ux * t;
      const y = ay + uy * t;
      total += L / steps;
      const r = maxGap + 2;
      let onFace = false;
      let opening = false;
      const out: number[] = [];
      for (const j of index.query(x - r, y - r, x + r, y + r)) {
        const s = lines[j];
        const Ls = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        if (Ls < 0.3 || Math.abs(ux * (s.y2 - s.y1) - uy * (s.x2 - s.x1)) / Ls > 0.05) continue;
        const ts = ((x - s.x1) * (s.x2 - s.x1) + (y - s.y1) * (s.y2 - s.y1)) / (Ls * Ls);
        if (ts < -0.02 || ts > 1.02) continue;
        const off = (s.x1 + (s.x2 - s.x1) * ts - x) * nx + (s.y1 + (s.y2 - s.y1) * ts - y) * ny;
        if (Math.abs(off) <= 1.5) {
          onFace = true;
          if (s.bridge) opening = true;
        } else if (off > 0) out.push(off);
      }
      if (opening || (onFace && out.some((d) => d >= minGap && d <= maxGap + 1.5))) face += L / steps;
    }
  }
  return total ? face / total : 0;
}

/** Distance from a point to a segment, when the point lies beside it (between its ends); else infinite. */
function besideSegment(x: number, y: number, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const L2 = dx * dx + dy * dy;
  const t = L2 ? ((x - s.x1) * dx + (y - s.y1) * dy) / L2 : -1;
  if (t < 0 || t > 1) return Infinity;
  return Math.hypot(x - (s.x1 + dx * t), y - (s.y1 + dy * t));
}

export function fillRoom(model: WallModel, seeds: Pt[], sheetW: number, sheetH: number, attempts = 3): RoomFill {
  if (!model.lines.length) return { ok: false, reason: 'no-walls' };
  const xs = seeds.map((p) => p[0]);
  const ys = seeds.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
  const halves = [300, 700, Math.max(sheetW, sheetH)].slice(0, attempts).map((h) => h + spread);

  for (let attempt = 0; attempt < halves.length; attempt++) {
    const g = gridAround(cx, cy, halves[attempt], sheetW, sheetH);
    drawSegments(g, model.lines);
    // Each seed's space, labelled by the first seed that reached it.
    const label = new Uint8Array(g.w * g.h);
    let spaces = 0;
    let touchesEdge = false;
    for (const [px, py] of seeds) {
      const start = freePixelNear(g, Math.floor((px - g.x0) * g.res), Math.floor((py - g.y0) * g.res));
      if (!start) return { ok: false, reason: 'on-wall' };
      if (label[start[1] * g.w + start[0]]) continue;
      const f = floodFill(g, start[0], start[1]);
      touchesEdge ||= f.touchesEdge;
      spaces++;
      for (let i = 0; i < label.length; i++) if (f.region[i]) label[i] = Math.min(spaces, 255);
    }
    const whole = attempt === halves.length - 1;
    const atSheetEdge = g.x0 <= 0 && g.y0 <= 0 && g.x0 + g.w / g.res >= sheetW - 1 && g.y0 + g.h / g.res >= sheetH - 1;
    if (touchesEdge && !(whole || atSheetEdge)) continue;
    if (touchesEdge) return { ok: false, reason: 'not-closed' };
    let region: Uint8Array = label.map((v) => (v ? 1 : 0));
    if (spaces > 1) {
      // Take in the strip across each opening that lies between two of the spaces.
      for (const quad of model.openings) addStripBetween(g, toGrid(g, quad), label, region);
      region = close(region, g.w, g.h, 2);
      // Spaces on either side of a solid wall stay apart; one outline can't cover both.
      if (!connected(region, g.w, g.h)) return { ok: false, reason: 'not-connected' };
    }
    region = fillHoles(region, g.w, g.h);
    const corners = simplify(traceBoundary(region, g.w, g.h), 1.0);
    const outline = snapToLines(toSheet(g, corners), model.lines, 2.5 / g.res);
    return outline.length >= 3 ? { ok: true, points: outline, openings: openingLength(outline, model) } : { ok: false, reason: 'not-closed' };
  }
  return { ok: false, reason: 'not-closed' };
}

type Line = { px: number; py: number; ux: number; uy: number };

const intersect = (a: Line, b: Line): Pt | null => {
  const det = a.ux * b.uy - a.uy * b.ux;
  if (Math.abs(det) < 0.05) return null;
  const t = ((b.px - a.px) * b.uy - (b.py - a.py) * b.ux) / det;
  return [a.px + a.ux * t, a.py + a.uy * t];
};

/**
 * Moves each outline edge onto the drawn line it runs along, then rebuilds the
 * corners as intersections of neighbouring edges. The traced outline sits about a
 * pixel off the linework; snapping puts it exactly on the wall face.
 */
export function snapToLines(poly: Pt[], lines: Segment[], tol: number): Pt[] {
  const n = poly.length;
  if (n < 3) return poly;
  const edgeLines: Line[] = [];
  const snapped: boolean[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / L;
    const uy = (b[1] - a[1]) / L;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    let best: Line | null = null;
    let bestD = Infinity;
    for (const s of lines) {
      const Ls = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      if (Ls < 0.5) continue;
      const vx = (s.x2 - s.x1) / Ls;
      const vy = (s.y2 - s.y1) / Ls;
      if (Math.abs(ux * vy - uy * vx) > 0.05) continue; // ~3°
      const d = Math.abs((mx - s.x1) * -vy + (my - s.y1) * vx);
      if (d > tol + s.width / 2 || d >= bestD) continue;
      // The edge must run alongside the segment for part of its length.
      const t1 = (a[0] - s.x1) * vx + (a[1] - s.y1) * vy;
      const t2 = (b[0] - s.x1) * vx + (b[1] - s.y1) * vy;
      const ov = Math.min(Ls, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
      if (ov < Math.min(L, Ls) * 0.3) continue;
      bestD = d;
      best = { px: s.x1, py: s.y1, ux: vx, uy: vy };
    }
    edgeLines.push(best ?? { px: a[0], py: a[1], ux, uy });
    snapped.push(!!best);
    lengths.push(L);
  }
  // A very short edge that found no line is a simplification kink at a corner: drop it
  // so its neighbours meet directly, when they do meet nearby.
  const keep = edgeLines.map(() => true);
  for (let i = 0; i < n; i++) {
    if (snapped[i] || lengths[i] > tol * 8) continue;
    const prev = edgeLines[(i - 1 + n) % n];
    const next = edgeLines[(i + 1) % n];
    const p = intersect(prev, next);
    if (p && Math.hypot(p[0] - poly[i][0], p[1] - poly[i][1]) < tol * 10) keep[i] = false;
  }
  const kept = edgeLines.map((l, i) => ({ l, start: poly[i] })).filter((_, i) => keep[i]);
  const out: Pt[] = [];
  for (let i = 0; i < kept.length; i++) {
    const prev = kept[(i - 1 + kept.length) % kept.length].l;
    const cur = kept[i].l;
    out.push(intersect(prev, cur) ?? kept[i].start);
  }
  // Drop corners that ended up on a straight line (two edges snapped to the same wall).
  return out.filter((p, i) => {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[(i + 1) % out.length];
    return Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1])) > 1e-3 * Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
}
