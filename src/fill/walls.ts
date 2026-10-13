import type { Segment } from './vectors';

const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** Line weights rounded to 0.01 pt; architects draw walls with one or two pens. */
export const widthKey = (s: Segment) => (s.filled ? 'fill' : s.width.toFixed(2));

export interface PenStats {
  key: string;
  segments: number;
  length: number;
  /** Length of this pen's lines that run parallel to another of its lines a wall-thickness away. */
  paired: number;
}

/** Spatial hash of segment midpoints, for neighbour queries. */
class Grid {
  private cells = new Map<string, Segment[]>();
  constructor(
    segs: Segment[],
    private size: number,
  ) {
    for (const s of segs) {
      const k = this.key((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
      const list = this.cells.get(k);
      if (list) list.push(s);
      else this.cells.set(k, [s]);
    }
  }
  private key(x: number, y: number) {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
  }
  near(x: number, y: number, radius: number): Segment[] {
    const out: Segment[] = [];
    const r = Math.ceil(radius / this.size);
    const cx = Math.floor(x / this.size);
    const cy = Math.floor(y / this.size);
    for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) out.push(...(this.cells.get(`${i},${j}`) ?? []));
    return out;
  }
}

/** How much of a lies alongside b: overlap of their projections on a's direction. */
function overlap(a: Segment, b: Segment, ux: number, uy: number): number {
  const p = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const a1 = 0;
  const a2 = len(a);
  const [b1, b2] = [p(b.x1, b.y1), p(b.x2, b.y2)].sort((m, n) => m - n);
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/**
 * Scores each pen by how much of its linework comes in parallel pairs a wall
 * thickness apart. Wall-type tag diamonds also have parallel sides, so a pair
 * only counts where the shared run is at least twice the gap (walls are long
 * and thin; tags are about as long as they are wide).
 */
export function penStats(segs: Segment[], minGap: number, maxGap: number, join = false): PenStats[] {
  const byPen = new Map<string, Segment[]>();
  const wallFill = wallShapedFills(segs, minGap, maxGap);
  for (const s of segs) {
    // Wall-shaped filled shapes count together as one "pen": walls drawn as solid poché
    // with no outline. Broad fills (panels, shaded areas) are not walls.
    if (len(s) < 1 || (s.filled && !wallFill.has(s))) continue;
    const k = widthKey(s);
    const list = byPen.get(k);
    if (list) list.push(s);
    else byPen.set(k, [s]);
  }
  const out: PenStats[] = [];
  for (const [key, pieces] of byPen) {
    // Some exports break lines at every crossing: then score the joined runs, not the pieces.
    // Only as a fallback: joined hatch rows pair like walls too.
    const list = join && pieces.length <= 50000 ? joinCollinear(pieces) : pieces;
    // Against the pieces' length: joining overlapping duplicates must not raise the share.
    const length = pieces.reduce((n, s) => n + len(s), 0);
    if (pieces.length < 20 || list.length > 50000) {
      out.push({ key, segments: list.length, length, paired: 0 });
      continue;
    }
    const grid = new Grid(list, Math.max(16, maxGap * 2));
    let paired = 0;
    for (const a of list) {
      const L = len(a);
      if (L < 2 * minGap) continue;
      const ux = (a.x2 - a.x1) / L;
      const uy = (a.y2 - a.y1) / L;
      let best = 0;
      for (const b of grid.near((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2, L / 2 + maxGap)) {
        if (b === a) continue;
        const Lb = len(b);
        const vx = (b.x2 - b.x1) / Lb;
        const vy = (b.y2 - b.y1) / Lb;
        if (Math.abs(ux * vy - uy * vx) > 0.035) continue;
        const d = Math.abs((b.x1 - a.x1) * -uy + (b.y1 - a.y1) * ux);
        if (d < minGap || d > maxGap) continue;
        const ov = overlap(a, b, ux, uy);
        if (ov >= 2 * d) best = Math.max(best, ov);
      }
      paired += best;
    }
    out.push({ key, segments: list.length, length, paired });
  }
  return out.sort((a, b) => b.paired - a.paired);
}

/** Collinear pieces that touch or overlap, joined into one segment each (for scoring only). */
export function joinCollinear(segs: Segment[]): Segment[] {
  const groups = new Map<string, { t0: number; t1: number; s: Segment }[]>();
  const out: Segment[] = [];
  for (const s of segs) {
    const L = len(s);
    if (L === 0) continue;
    let ux = (s.x2 - s.x1) / L;
    let uy = (s.y2 - s.y1) / L;
    // One direction per line: the angle in [0, π).
    if (uy < 0 || (uy === 0 && ux < 0)) {
      ux = -ux;
      uy = -uy;
    }
    const off = -s.x1 * uy + s.y1 * ux;
    const key = `${Math.round(Math.atan2(uy, ux) * 2000)},${Math.round(off * 10)}`;
    const a = s.x1 * ux + s.y1 * uy;
    const b = s.x2 * ux + s.y2 * uy;
    const list = groups.get(key);
    const item = { t0: Math.min(a, b), t1: Math.max(a, b), s };
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0].s);
      continue;
    }
    list.sort((p, q) => p.t0 - q.t0);
    let run = { ...list[0] };
    const flush = () => {
      const { s } = run;
      const L = len(s);
      let ux = (s.x2 - s.x1) / L;
      let uy = (s.y2 - s.y1) / L;
      if (uy < 0 || (uy === 0 && ux < 0)) {
        ux = -ux;
        uy = -uy;
      }
      // Back along the line from the first piece's start to the run's ends.
      const base = s.x1 * ux + s.y1 * uy;
      const at = (t: number) => [s.x1 + (t - base) * ux, s.y1 + (t - base) * uy];
      const [x1, y1] = at(run.t0);
      const [x2, y2] = at(run.t1);
      out.push({ ...s, x1, y1, x2, y2 });
    };
    for (const next of list.slice(1)) {
      if (next.t0 <= run.t1 + 0.2) run.t1 = Math.max(run.t1, next.t1);
      else {
        flush();
        run = { ...next };
      }
    }
    flush();
  }
  return out;
}

/**
 * The pens that draw walls. Hatching and furniture also come in parallel lines, so
 * pairing alone is not enough; by drafting convention cut walls get the heaviest pen.
 * Among pens with plenty of paired linework, take the heaviest, plus any pen at least
 * as heavy that pairs as well (some offices draw exterior walls heavier still).
 */
/**
 * Filled shapes shaped like a run of wall: the narrow side a wall thickness, the long
 * side at least three times it. A poché wall plan is mostly these; panels, shaded areas
 * and lettering are not.
 */
export function wallShapedFills(segs: Segment[], minGap: number, maxGap: number): Set<Segment> {
  const bySub = new Map<number, Segment[]>();
  for (const s of segs) {
    if (!s.filled || s.sub === undefined) continue;
    const list = bySub.get(s.sub);
    if (list) list.push(s);
    else bySub.set(s.sub, [s]);
  }
  const out = new Set<Segment>();
  let shaped = 0;
  let all = 0;
  for (const list of bySub.values()) {
    const xs = list.flatMap((s) => [s.x1, s.x2]);
    const ys = list.flatMap((s) => [s.y1, s.y2]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const [narrow, long] = w < h ? [w, h] : [h, w];
    const edge = list.reduce((n, s) => n + len(s), 0);
    all += edge;
    if (narrow >= minGap && narrow <= maxGap && long >= 3 * narrow) {
      shaped += edge;
      for (const s of list) out.add(s);
    }
  }
  // A poché plan's fills are mostly walls; an elevation of shaded panels has a few
  // narrow strips (joints) among broad fills, and is not a wall plan.
  if (shaped < all * 0.5) return new Set();
  // Panels and cladding strips tile, edge against edge; a wall's long sides face open
  // room. Most long edges shared with a neighbouring fill means tiling, not walls.
  // Edges bucketed by line (to half a point); a neighbour within 1.5 pt counts (a joint gap).
  const lines = new Map<string, { a: number; b: number; sub: number }[]>();
  const edges: { dir: string; at: number; a: number; b: number; sub: number }[] = [];
  for (const s of out) {
    const L = len(s);
    const horizontal = Math.abs(s.y2 - s.y1) < 0.1;
    const vertical = Math.abs(s.x2 - s.x1) < 0.1;
    if (L < 4 || (!horizontal && !vertical)) continue;
    const dir = horizontal ? 'h' : 'v';
    const at = Math.round((horizontal ? s.y1 : s.x1) * 2);
    const key = `${dir}${at}`;
    const [a, b] = horizontal ? [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)] : [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)];
    const e = { dir, at, a, b, sub: s.sub ?? -1 };
    edges.push(e);
    const list = lines.get(key);
    if (list) list.push(e);
    else lines.set(key, [e]);
  }
  let total = 0;
  let shared = 0;
  for (const e of edges) {
    total += e.b - e.a;
    let along = 0;
    for (let d = -3; d <= 3; d++)
      for (const o of lines.get(`${e.dir}${e.at + d}`) ?? []) if (o.sub !== e.sub) along += Math.max(0, Math.min(e.b, o.b) - Math.max(e.a, o.a));
    shared += Math.min(e.b - e.a, along);
  }
  return total && shared > total * 0.5 ? new Set() : out;
}

/** The pens that draw walls; `shares` are the paired shares accepted, strictest first. */
export function detectWallPens(stats: PenStats[], shares = [0.5, 0.4]): string[] {
  const stroked = detectStrokedPens(stats, shares);
  if (stroked.length) return stroked;
  // No outlined walls: walls drawn as solid fills only (poché), when the fills pair like walls.
  const fill = stats.find((s) => s.key === 'fill');
  return fill && fill.paired > 0 && fill.paired / fill.length >= 0.4 ? ['fill'] : [];
}

function detectStrokedPens(stats: PenStats[], shares: number[]): string[] {
  const most = Math.max(0, ...stats.filter((s) => s.key !== 'fill').map((s) => s.paired));
  if (most === 0) return [];
  // Wall pens draw mostly in parallel pairs. A sheet border or title block in the same pen
  // can pull its share down, so a looser share is accepted when no pen passes.
  for (const share of shares) {
    const candidates = stats.filter((s) => s.key !== 'fill' && s.paired >= most * 0.05 && s.paired / s.length >= share);
    if (!candidates.length) continue;
    const heaviest = candidates.reduce((a, b) => (Number(b.key) > Number(a.key) ? b : a));
    // Exterior walls are often drawn heavier than partitions: both count.
    return candidates.filter((s) => Number(s.key) >= Number(heaviest.key) * 0.55).map((s) => s.key);
  }
  return [];
}

/** Window openings: longer gaps are closed when other linework (glazing, frames) runs along them. */
export interface GlazingRule {
  lines: Segment[];
  maxGap: number;
  /** How far from the wall line glazing may sit (about a wall thickness). */
  band: number;
}

/**
 * Closes openings in walls (doors, windows) by joining wall lines that continue
 * on the same line across a gap no wider than `maxGap`. Joining the room-side
 * face lines puts the closure exactly on the inside face of the wall.
 */
export function bridgeGaps(walls: Segment[], maxGap: number, glazing?: GlazingRule): Segment[] {
  const lines = walls.filter((s) => len(s) >= 0.5);
  const reach = glazing ? Math.max(maxGap, glazing.maxGap) : maxGap;
  const grid = new Grid(lines, Math.max(16, reach));
  const other = glazing ? new Grid(glazing.lines, 32) : null;
  /** Share of the gap a→b covered by other linework running along it (window glazing, frames). */
  const glazed = (ax: number, ay: number, bx: number, by: number): number => {
    if (!other || !glazing) return 0;
    const L = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / L;
    const uy = (by - ay) / L;
    const spans: [number, number][] = [];
    for (const s of other.near((ax + bx) / 2, (ay + by) / 2, L / 2 + glazing.band + 32)) {
      const Ls = len(s);
      if (Ls < 0.5) continue;
      if (Math.abs(ux * (s.y2 - s.y1) - uy * (s.x2 - s.x1)) / Ls > 0.035) continue;
      if (Math.abs((s.x1 - ax) * -uy + (s.y1 - ay) * ux) > glazing.band) continue;
      const t1 = (s.x1 - ax) * ux + (s.y1 - ay) * uy;
      const t2 = (s.x2 - ax) * ux + (s.y2 - ay) * uy;
      // A line running far past both ends of the gap (a grid or section line across the
      // plan) is passing by, not glazing in the opening.
      if (Math.min(t1, t2) < -glazing.band && Math.max(t1, t2) > L + glazing.band) continue;
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(L, Math.max(t1, t2));
      if (hi > lo) spans.push([lo, hi]);
    }
    spans.sort((m, n) => m[0] - n[0]);
    let covered = 0;
    let end = 0;
    for (const [lo, hi] of spans) {
      if (hi <= end) continue;
      covered += hi - Math.max(lo, end);
      end = hi;
    }
    return covered / L;
  };
  const bridges: Segment[] = [];
  const seen = new Set<string>();
  for (const a of lines) {
    const La = len(a);
    const ux = (a.x2 - a.x1) / La;
    const uy = (a.y2 - a.y1) / La;
    for (const [ex, ey] of [
      [a.x1, a.y1],
      [a.x2, a.y2],
    ] as const) {
      // Nearest collinear segment beyond this end, on the far side of a gap. A line
      // that carries on from this end (CAD often splits walls into pieces) is no gap.
      let best: { x: number; y: number; d: number } | null = null;
      let continues = false;
      for (const b of grid.near(ex, ey, reach + 32)) {
        if (b === a) continue;
        const Lb = len(b);
        const vx = (b.x2 - b.x1) / Lb;
        const vy = (b.y2 - b.y1) / Lb;
        if (Math.abs(ux * vy - uy * vx) > 0.0175) continue; // 1°
        const off = Math.abs((b.x1 - a.x1) * -uy + (b.y1 - a.y1) * ux);
        if (off > 0.3) continue;
        // Must lie beyond this end along the line, not overlapping a.
        const t1 = (b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy;
        const t2 = (b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy;
        const atStart = ex === a.x1 && ey === a.y1;
        const near = atStart ? Math.max(t1, t2) : Math.min(t1, t2) - La;
        const gap = atStart ? -near : near;
        if (gap <= 0.2) {
          const lo = Math.min(t1, t2);
          const hi = Math.max(t1, t2);
          if (atStart ? lo < 0 : hi > La) {
            continues = true;
            break;
          }
          continue;
        }
        if (gap > reach) continue;
        if (best && gap >= best.d) continue;
        const t = atStart ? Math.max(t1, t2) : Math.min(t1, t2);
        const bx = a.x1 + ux * t;
        const by = a.y1 + uy * t;
        // Doors: any gap up to maxGap. Windows: longer gaps with glazing drawn along the wall.
        if (gap > maxGap && glazed(ex, ey, bx, by) < 0.7) continue;
        best = { x: bx, y: by, d: gap };
      }
      if (best && !continues) {
        const key = [ex, ey, best.x, best.y].map((v) => v.toFixed(2)).sort().join(',');
        if (!seen.has(key)) {
          seen.add(key);
          const window = glazed(ex, ey, best.x, best.y) >= 0.5;
          bridges.push({ x1: ex, y1: ey, x2: best.x, y2: best.y, width: 0, filled: false, bridge: true, ...(window ? { window } : {}) });
        }
      }
    }
  }
  return bridges;
}
