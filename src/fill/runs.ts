import type { Pt } from '../model';
import type { PageText } from '../pageText';
import type { Segment } from './vectors';

/**
 * Runs of ductwork, piping and conduit read off a trade plan's linework, as an estimator scales
 * them: a pipe or conduit is drawn as one line along its run, a duct as two lines its width
 * apart, labelled with its size (24x12, 10"ø) somewhere along it.
 */

const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const key = (x: number, y: number, q: number) => `${Math.round(x / q)},${Math.round(y / q)}`;

/**
 * The lines as runs: pieces meeting end to end joined into polylines (a pipe drawn as many
 * short strokes, or broken round its fittings, is one run). Runs shorter than `minLength`
 * (a valve's ticks, a cleanout) are left out.
 */
export function chainRuns(segs: Segment[], minLength: number, tol = 0.75): Pt[][] {
  const lines = segs.filter((s) => !s.filled && len(s) > 0.05);
  const ends = new Map<string, number[]>();
  const add = (k: string, i: number) => {
    const l = ends.get(k);
    if (l) l.push(i);
    else ends.set(k, [i]);
  };
  // Ends snapped to a grid (and its half-offset twin, so two ends just across a cell edge still meet).
  const keys = (x: number, y: number) => [key(x, y, tol * 2), key(x + tol, y + tol, tol * 2)];
  lines.forEach((s, i) => {
    for (const k of keys(s.x1, s.y1)) add(k, i);
    for (const k of keys(s.x2, s.y2)) add(k, i);
  });
  const used = new Uint8Array(lines.length);
  const near = (x: number, y: number, self: number): number | null => {
    for (const k of keys(x, y))
      for (const j of ends.get(k) ?? []) {
        if (used[j] || j === self) continue;
        const s = lines[j];
        if (Math.hypot(s.x1 - x, s.y1 - y) <= tol || Math.hypot(s.x2 - x, s.y2 - y) <= tol) return j;
      }
    return null;
  };
  const out: Pt[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = lines[i];
    const pts: Pt[] = [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ];
    // Grow from both ends.
    for (const front of [false, true]) {
      for (;;) {
        const [x, y] = front ? pts[0] : pts[pts.length - 1];
        const j = near(x, y, -1);
        if (j === null) break;
        used[j] = 1;
        const t = lines[j];
        const far: Pt = Math.hypot(t.x1 - x, t.y1 - y) <= tol ? [t.x2, t.y2] : [t.x1, t.y1];
        if (front) pts.unshift(far);
        else pts.push(far);
      }
    }
    let total = 0;
    for (let k = 1; k < pts.length; k++) total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    if (total >= minLength) out.push(straighten(pts));
  }
  return out;
}

/** Drops points along a straight stretch (a run drawn as many strokes): its corners are enough. */
function straighten(pts: Pt[]): Pt[] {
  if (pts.length <= 2) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    if (Math.abs(cross) / d > 0.3) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Small closed shapes drawn on a run's layer (a diffuser, a grille, a cleanout, a valve body):
 * symbols on the run, not the run. Shapes up to `maxSpan` across that close on themselves.
 */
export function withoutSymbols(segs: Segment[], maxSpan: number): Segment[] {
  const subs = new Map<number, Segment[]>();
  for (const s of segs) if (s.sub !== undefined) subs.set(s.sub, [...(subs.get(s.sub) ?? []), s]);
  const drop = new Set<number>();
  for (const [k, list] of subs) {
    if (list.length < 3) continue;
    const xs = list.flatMap((s) => [s.x1, s.x2]);
    const ys = list.flatMap((s) => [s.y1, s.y2]);
    if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > maxSpan) continue;
    const a = list[0];
    const z = list[list.length - 1];
    if (Math.hypot(a.x1 - z.x2, a.y1 - z.y2) <= 0.5) drop.add(k);
  }
  return drop.size ? segs.filter((s) => s.sub === undefined || !drop.has(s.sub)) : segs;
}

/** A stretch of duct (or wall) between two lines drawn side by side: its centreline and width, in sheet points. */
export interface PairedRun {
  a: Pt;
  b: Pt;
  width: number;
}

/**
 * Pairs of parallel lines between `minWidth` and `maxWidth` apart, overlapping along their
 * length: the centreline of each overlap and the distance between (a duct's plan width, a
 * wall's thickness). Each stretch of a line is used once, by its nearest partner, so a duct
 * side broken by branches pairs piece by piece with the other side.
 */
export function pairParallels(segs: Segment[], minWidth: number, maxWidth: number, minLength: number): PairedRun[] {
  type L = { s: Segment; ax: number; ay: number; ux: number; uy: number; len: number; th: number; used: [number, number][] };
  const lines: L[] = [];
  for (const s of segs) {
    if (s.filled || s.curve) continue;
    const l = len(s);
    if (l < minLength) continue;
    let ux = (s.x2 - s.x1) / l;
    let uy = (s.y2 - s.y1) / l;
    let [ax, ay] = [s.x1, s.y1];
    // One direction for both sides of a duct, whichever way each was drawn.
    if (ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uy < 0)) {
      ux = -ux;
      uy = -uy;
      [ax, ay] = [s.x2, s.y2];
    }
    lines.push({ s, ax, ay, ux, uy, len: l, th: Math.atan2(uy, ux), used: [] });
  }
  // A grid over the lines' bounds, cells a duct's width or more across.
  const cell = Math.max(maxWidth, 24);
  const grid = new Map<string, number[]>();
  lines.forEach((l, i) => {
    const x0 = Math.min(l.s.x1, l.s.x2) - maxWidth;
    const x1 = Math.max(l.s.x1, l.s.x2) + maxWidth;
    const y0 = Math.min(l.s.y1, l.s.y2) - maxWidth;
    const y1 = Math.max(l.s.y1, l.s.y2) + maxWidth;
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++)
      for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
        const k = `${gx},${gy}`;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
  });
  type Cand = { i: number; j: number; d: number; t0: number; t1: number };
  const cands: Cand[] = [];
  const seen = new Set<string>();
  lines.forEach((p, i) => {
    const gx0 = Math.floor(Math.min(p.s.x1, p.s.x2) / cell);
    const gx1 = Math.floor(Math.max(p.s.x1, p.s.x2) / cell);
    const gy0 = Math.floor(Math.min(p.s.y1, p.s.y2) / cell);
    const gy1 = Math.floor(Math.max(p.s.y1, p.s.y2) / cell);
    for (let gx = gx0; gx <= gx1; gx++)
      for (let gy = gy0; gy <= gy1; gy++)
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (j <= i) continue;
          const pk = `${i},${j}`;
          if (seen.has(pk)) continue;
          seen.add(pk);
          const q = lines[j];
          // Parallel within about a degree.
          if (Math.abs(p.ux * q.uy - p.uy * q.ux) > 0.02) continue;
          // Across: q's start from p's line.
          const d = Math.abs((q.ax - p.ax) * -p.uy + (q.ay - p.ay) * p.ux);
          if (d < minWidth || d > maxWidth) continue;
          // Along p: where q runs beside it.
          const q0 = (q.ax - p.ax) * p.ux + (q.ay - p.ay) * p.uy;
          const q1 = q0 + q.len * (q.ux * p.ux + q.uy * p.uy);
          const t0 = Math.max(0, Math.min(q0, q1));
          const t1 = Math.min(p.len, Math.max(q0, q1));
          if (t1 - t0 < minLength) continue;
          cands.push({ i, j, d, t0, t1 });
        }
  });
  // Nearest partners first: a duct's two sides before the next duct over.
  cands.sort((a, b) => a.d - b.d);
  const free = (used: [number, number][], t0: number, t1: number): [number, number][] => {
    let parts: [number, number][] = [[t0, t1]];
    for (const [u0, u1] of used)
      parts = parts.flatMap(([a, b]) => {
        if (u1 <= a || u0 >= b) return [[a, b]] as [number, number][];
        const out: [number, number][] = [];
        if (u0 > a) out.push([a, u0]);
        if (u1 < b) out.push([u1, b]);
        return out;
      });
    return parts;
  };
  const out: PairedRun[] = [];
  for (const c of cands) {
    const p = lines[c.i];
    const q = lines[c.j];
    // q's own stretch over [t0, t1] of p, in q's terms.
    const toQ = (t: number) => {
      const x = p.ax + p.ux * t;
      const y = p.ay + p.uy * t;
      return (x - q.ax) * q.ux + (y - q.ay) * q.uy;
    };
    for (const [a, b] of free(p.used, c.t0, c.t1)) {
      const qa = toQ(a);
      const qb = toQ(b);
      for (const [u, v] of free(q.used, Math.min(qa, qb), Math.max(qa, qb))) {
        if (v - u < minLength) continue;
        // Back onto p, and the centreline half the width over.
        const back = (tq: number) => {
          const x = q.ax + q.ux * tq;
          const y = q.ay + q.uy * tq;
          return (x - p.ax) * p.ux + (y - p.ay) * p.uy;
        };
        const s0 = Math.min(back(u), back(v));
        const s1 = Math.max(back(u), back(v));
        const side = Math.sign((q.ax - p.ax) * -p.uy + (q.ay - p.ay) * p.ux) || 1;
        const ox = -p.uy * side * (c.d / 2);
        const oy = p.ux * side * (c.d / 2);
        out.push({ a: [p.ax + p.ux * s0 + ox, p.ay + p.uy * s0 + oy], b: [p.ax + p.ux * s1 + ox, p.ay + p.uy * s1 + oy], width: c.d });
        p.used.push([s0, s1]);
        q.used.push([u, v]);
      }
    }
  }
  return out;
}

/** A duct size as written: rectangular W x H, or round D, in the drawing's units (inches, or mm). */
export interface DuctSize {
  text: string;
  w: number;
  h: number | null;
  at: Pt;
}

const RECT = /^(\d{1,4})\s*["”]?\s*[xX×]\s*(\d{1,4})\s*["”]?$/;
const ROUND = /^(\d{1,4})\s*["”]?\s*(?:ø|Ø|⌀|DIA\.?|RD\.?)$/i;

/** Duct size labels on a sheet (a label inside a tag with more text, "24x12 UP", is read too). */
export function ductSizes(texts: PageText[]): DuctSize[] {
  const out: DuctSize[] = [];
  for (const t of texts) {
    for (const word of t.str.trim().split(/\s{1,}(?=\d)|\s+(?=[A-Za-z])/)) {
      const w = word.trim();
      const r = RECT.exec(w);
      if (r) {
        out.push({ text: `${r[1]}x${r[2]}`, w: +r[1], h: +r[2], at: [t.cx, t.cy] });
        continue;
      }
      const o = ROUND.exec(w);
      if (o) out.push({ text: `${o[1]}"ø`, w: +o[1], h: null, at: [t.cx, t.cy] });
    }
  }
  return out.filter((s) => s.w > 0 && (s.h === null || s.h > 0));
}

const distToSeg = ([px, py]: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
};

/**
 * Each duct stretch's size: the nearest label whose width (either side of a rectangular size,
 * or a round duct's diameter) is the stretch's plan width, give or take; stretches with no such
 * label take the size of a sized stretch of the same width they join or run near.
 * `unit` is the size's unit in sheet points (an inch, or a mm when `metric`, at the sheet's scale).
 */
export function sizeRuns(runs: PairedRun[], sizes: DuctSize[], unit: number, metric = false): (DuctSize | null)[] {
  const fits = (r: PairedRun, s: DuctSize) => {
    const wide = r.width / unit;
    const slack = Math.max(metric ? 60 : 2.5, wide * 0.18);
    const near = (n: number) => Math.abs(n - wide) <= slack;
    return near(s.w) || (s.h !== null && near(s.h));
  };
  const out: (DuctSize | null)[] = runs.map((r) => {
    // Within a few widths of it, or five feet (1.5 m).
    const reach = Math.max(r.width * 4, unit * (metric ? 1500 : 60));
    let best: DuctSize | null = null;
    let bestD = Infinity;
    for (const s of sizes) {
      if (!fits(r, s)) continue;
      const d = distToSeg(s.at, r.a, r.b);
      if (d <= reach && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  });
  // Unlabelled stretches: the size of a sized stretch of the same width they meet or run on from.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    runs.forEach((r, i) => {
      if (out[i]) return;
      let best: DuctSize | null = null;
      let bestD = Infinity;
      runs.forEach((o, j) => {
        const s = out[j];
        if (!s || Math.abs(o.width - r.width) > Math.max(1, r.width * 0.06)) return;
        const d = Math.min(distToSeg(r.a, o.a, o.b), distToSeg(r.b, o.a, o.b), distToSeg(o.a, r.a, r.b), distToSeg(o.b, r.a, r.b));
        if (d <= r.width * 1.5 && d < bestD) {
          best = s;
          bestD = d;
        }
      });
      if (best) {
        out[i] = best;
        changed = true;
      }
    });
    if (!changed) break;
  }
  return out;
}

/**
 * Lines drawn dashed as separate strokes (a CAD export draws each dash on its own): short
 * pieces in one pen lying end to end along one line, a dash's length or so apart, joined into
 * one dashed line. Lines drawn with a dash pattern are returned as they are.
 */
export function dashLines(segs: Segment[], maxDash: number): Segment[] {
  const out: Segment[] = segs.filter((s) => s.dashed && !s.filled);
  type P = { s: Segment; t0: number; t1: number };
  const groups = new Map<string, { ux: number; uy: number; pieces: P[] }>();
  for (const s of segs) {
    if (s.dashed || s.filled || s.curve) continue;
    const l = len(s);
    if (l < 0.5 || l > maxDash) continue;
    let ux = (s.x2 - s.x1) / l;
    let uy = (s.y2 - s.y1) / l;
    if (ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uy < 0)) {
      ux = -ux;
      uy = -uy;
    }
    const ang = Math.round(Math.atan2(uy, ux) * 180);
    const off = -uy * s.x1 + ux * s.y1;
    const k = `${ang}|${Math.round(off * 2)}|${s.width.toFixed(2)}`;
    const g = groups.get(k) ?? { ux, uy, pieces: [] };
    const a = s.x1 * ux + s.y1 * uy;
    const b = s.x2 * ux + s.y2 * uy;
    g.pieces.push({ s, t0: Math.min(a, b), t1: Math.max(a, b) });
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    if (g.pieces.length < 3) continue;
    g.pieces.sort((p, q) => p.t0 - q.t0);
    let run: P[] = [];
    const flush = () => {
      if (run.length >= 3) {
        const first = run[0];
        const last = run[run.length - 1];
        // The line through the run: from the first dash's start to the last's end.
        const pick = (p: P, t: number): [number, number] => {
          const d1 = Math.abs(p.s.x1 * g.ux + p.s.y1 * g.uy - t);
          const d2 = Math.abs(p.s.x2 * g.ux + p.s.y2 * g.uy - t);
          return d1 <= d2 ? [p.s.x1, p.s.y1] : [p.s.x2, p.s.y2];
        };
        const [x1, y1] = pick(first, first.t0);
        const [x2, y2] = pick(last, last.t1);
        out.push({ x1, y1, x2, y2, width: first.s.width, filled: false, dashed: true, color: first.s.color });
      }
      run = [];
    };
    for (const p of g.pieces) {
      const prev = run[run.length - 1];
      if (prev && (p.t0 - prev.t1 > Math.max(prev.t1 - prev.t0, p.t1 - p.t0) * 1.2 + 0.5 || p.t0 - prev.t1 < -0.5)) flush();
      run.push(p);
    }
    flush();
  }
  return out;
}

/**
 * Runs broken where the drawing breaks them (a label laid over a pipe, a fitting, a duct size
 * tag) joined back up: a run whose end lines up with another's start (in line within `maxOff`,
 * the gap no longer than `maxGap`) is one run. Only runs drawn along one line join end to end;
 * a branch meeting a run at a corner stays its own.
 */
export function joinRuns(runs: Pt[][], maxGap: number, maxOff: number): Pt[][] {
  const out = runs.map((r) => r.slice());
  const dir = (a: Pt, b: Pt): Pt => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  // How run `p`'s last stretch continues into `q` from its first point: in line, a short gap ahead.
  const continues = (p: Pt[], q: Pt[]): boolean => {
    const a = p[p.length - 2];
    const b = p[p.length - 1];
    const c = q[0];
    const d = q[1];
    const u = dir(a, b);
    const v = dir(c, d);
    if (u[0] * v[0] + u[1] * v[1] < 0.995) return false;
    const along = (c[0] - b[0]) * u[0] + (c[1] - b[1]) * u[1];
    const off = Math.abs((c[0] - b[0]) * -u[1] + (c[1] - b[1]) * u[0]);
    return along >= -maxOff && along <= maxGap && off <= maxOff;
  };
  // Ends on a grid a gap across, so each end only looks at the runs near it.
  const cell = Math.max(maxGap, 1);
  const alive = out.map(() => true);
  const grid = new Map<string, Set<number>>();
  const key = (p: Pt) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
  const index = (i: number) => {
    for (const p of [out[i][0], out[i][out[i].length - 1]]) {
      const k = key(p);
      if (!grid.has(k)) grid.set(k, new Set());
      grid.get(k)!.add(i);
    }
  };
  const near = (p: Pt) => {
    const [cx, cy] = [Math.floor(p[0] / cell), Math.floor(p[1] / cell)];
    const found = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (alive[i]) found.add(i);
    return found;
  };
  out.forEach((_, i) => index(i));
  for (let i = 0; i < out.length; i++) {
    if (!alive[i]) continue;
    for (let grown = true; grown; ) {
      grown = false;
      for (const flip of [false, true]) {
        // Grow from its end, then (turned round) from its start.
        const p = flip ? out[i].slice().reverse() : out[i];
        for (const j of near(p[p.length - 1])) {
          if (j === i) continue;
          const q = [out[j], out[j].slice().reverse()].find((c) => continues(p, c));
          if (!q) continue;
          out[i] = [...p.slice(0, -1), ...q.slice(1)];
          alive[j] = false;
          index(i);
          grown = true;
          break;
        }
        if (grown) break;
      }
    }
  }
  return out.filter((_, i) => alive[i]);
}

/**
 * Lines of one type traced twice (two bands read off one drawn run, a run picked up from two
 * labels): each stretch counted once. Taken longest first, a line keeps only the parts no line
 * already kept lies along (in line within `tol`); what is left shorter than `minLen` is dropped.
 * The result is the kept stretches as straight two-point lines, to be joined up again.
 */
export function uncover(lines: Pt[][], tol: number, minLen: number): Pt[][] {
  const segs: [Pt, Pt][] = [];
  for (const l of lines) for (let i = 1; i < l.length; i++) segs.push([l[i - 1], l[i]]);
  segs.sort((a, b) => Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]) - Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]));
  const kept: [Pt, Pt][] = [];
  for (const [a, b] of segs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) continue;
    const ux = (b[0] - a[0]) / L;
    const uy = (b[1] - a[1]) / L;
    // Stretches of this line (0..L along it) that kept lines already lie along.
    const covered: [number, number][] = [];
    for (const [c, d] of kept) {
      const off = (p: Pt) => Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux);
      if (off(c) > tol || off(d) > tol) continue;
      const t = (p: Pt) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
      const lo = Math.max(0, Math.min(t(c), t(d)));
      const hi = Math.min(L, Math.max(t(c), t(d)));
      if (hi > lo) covered.push([lo, hi]);
    }
    covered.sort((x, y) => x[0] - y[0]);
    let from = 0;
    const at = (t: number): Pt => [a[0] + ux * t, a[1] + uy * t];
    for (const [lo, hi] of [...covered, [L, L] as [number, number]]) {
      if (lo - from >= minLen) kept.push([at(from), at(lo)]);
      from = Math.max(from, hi);
    }
  }
  return kept.map(([a, b]) => [a, b]);
}
