import type { Pt } from '../model';
import type { Segment } from './vectors';

export interface SymbolMatch {
  /** Centre of the matched symbol, in sheet points. */
  at: Pt;
  /** Quarter turns from the sample (0–3); 4–7 are the same turns of its mirror image. */
  turn: number;
  /** Share of the sample's lines found at this place (0–1). */
  score: number;
}

type Line = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  /** Which drawn shape of the sample the line is part of. */
  group?: number;
};

const len = (s: Line) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** Turns a point by quarter turns about the origin (sheet y points down). */
const rot = (x: number, y: number, turn: number): [number, number] => {
  // Turns 4–7 mirror the symbol left to right first (a left-hand door is a right-hand one flipped).
  const mx = turn >= 4 ? -x : x;
  const q = turn % 4;
  return q === 0 ? [mx, y] : q === 1 ? [-y, mx] : q === 2 ? [-mx, -y] : [y, -mx];
};

/** Segments bucketed by midpoint for quick lookups around a point. */
class Index<T extends Line> {
  private cells = new Map<string, T[]>();
  constructor(
    lines: T[],
    readonly size: number,
  ) {
    for (const s of lines) {
      const k = this.key((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
      const list = this.cells.get(k);
      if (list) list.push(s);
      else this.cells.set(k, [s]);
    }
  }
  private key(x: number, y: number) {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
  }
  /** Segments with their midpoint within `reach` cells of (x, y). */
  near(x: number, y: number, reach = 1): T[] {
    const cx = Math.floor(x / this.size);
    const cy = Math.floor(y / this.size);
    const out: T[] = [];
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) for (const s of this.cells.get(`${cx + i},${cy + j}`) ?? []) out.push(s);
    return out;
  }
}

/** How many index cells either side of a centre cover linework up to `extent` away. */
const reachFor = (extent: number, cell: number) => Math.max(1, Math.ceil(extent / cell));

const samePen = (a: number, b: number) => Math.abs(a - b) <= 0.02 + b * 0.05;

/** Whether a sheet line has the same ends as a (moved, turned) sample line. */
const sameEnds = (s: Line, ax: number, ay: number, bx: number, by: number, tol: number) =>
  (Math.hypot(s.x1 - ax, s.y1 - ay) <= tol && Math.hypot(s.x2 - bx, s.y2 - by) <= tol) ||
  (Math.hypot(s.x1 - bx, s.y1 - by) <= tol && Math.hypot(s.x2 - ax, s.y2 - ay) <= tol);

const boundsOf = (lines: Line[]): [number, number, number, number] => [
  Math.min(...lines.map((s) => Math.min(s.x1, s.x2))),
  Math.min(...lines.map((s) => Math.min(s.y1, s.y2))),
  Math.max(...lines.map((s) => Math.max(s.x1, s.x2))),
  Math.max(...lines.map((s) => Math.max(s.y1, s.y2))),
];

export const MAX_SAMPLE_LINES = 400;

/** A symbol taken from a sheet: its lines about its centre, ready to look for elsewhere. */
export interface SymbolSample {
  lines: Line[];
  /** The box's longer side, in points. */
  span: number;
  /** Where the symbol's centre is on the sheet it was taken from. */
  origin?: Pt;
  /** How many pieces of linework, of any length, sit inside the symbol (tells ○ from ⊙). */
  ink?: number;
  /** The centre of the box it was taken with, against the symbol's centre: what the user aimed at. */
  aim?: Pt;
}

/**
 * Which drawn shape each line is part of: the PDF's own subpaths when it has them, otherwise
 * lines joined end to end.
 */
function shapesOf(lines: Segment[]): number[] {
  if (lines.every((l) => l.sub !== undefined)) return lines.map((l) => l.sub!);
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) <= 0.05;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      if (near(a.x1, a.y1, b.x1, b.y1) || near(a.x1, a.y1, b.x2, b.y2) || near(a.x2, a.y2, b.x1, b.y1) || near(a.x2, a.y2, b.x2, b.y2)) parent[find(i)] = find(j);
    }
  return lines.map((_, i) => -1 - find(i));
}

/** Share of a symbol's outline its ink is counted inside: clear of lines that only touch it. */
const INNER = 0.85;

/** Every piece of linework (dots and fill slivers included) wholly inside the footprint centred at (cx, cy). */
function inkAt(all: Index<Segment>, cx: number, cy: number, hw: number, hh: number): number {
  const w = hw * INNER;
  const h = hh * INNER;
  let n = 0;
  for (const s of all.near(cx, cy, reachFor(Math.max(hw, hh), all.size)))
    if (Math.abs(s.x1 - cx) <= w && Math.abs(s.x2 - cx) <= w && Math.abs(s.y1 - cy) <= h && Math.abs(s.y2 - cy) <= h) n++;
  return n;
}

/** The lines drawn wholly inside `box` (x0, y0, x1, y1), about the symbol's centre; null when there are too few. */
export function sampleSymbol(segs: Segment[], box: [number, number, number, number]): SymbolSample | null {
  const [x0, y0, x1, y1] = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
  const inBox = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  // Lines too short to tell apart (dots, chord pieces under a point) are left out.
  const lines = segs.filter((s) => len(s) >= 0.4 && inBox(s.x1, s.y1) && inBox(s.x2, s.y2));
  // A symbol is a few dozen lines; a box round a whole room is not a symbol.
  if (lines.length < 2 || lines.length > MAX_SAMPLE_LINES) return null;
  // Centred on the linework, not the box: a copy is then found at the same place whichever way it
  // is turned, and the count's mark lands on the symbol.
  const [bx0, by0, bx1, by1] = boundsOf(lines);
  const cx = (bx0 + bx1) / 2;
  const cy = (by0 + by1) / 2;
  const groups = shapesOf(lines);
  const span = Math.max(x1 - x0, y1 - y0, bx1 - bx0, by1 - by0);
  return {
    lines: lines.map((s, i) => ({ x1: s.x1 - cx, y1: s.y1 - cy, x2: s.x2 - cx, y2: s.y2 - cy, width: s.width, group: groups[i] })),
    span,
    origin: [cx, cy],
    ink: inkAt(new Index(segs, Math.max(4, span / 2)), cx, cy, Math.max(0.5, (bx1 - bx0) / 2), Math.max(0.5, (by1 - by0) / 2)),
    aim: [(x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy],
  };
}

/**
 * Finds every copy of the symbol drawn inside `box`: the same lines, in the same pens,
 * at the same size, moved, turned by quarter turns or mirrored. CAD blocks repeat exactly, so a
 * copy must have nearly all of the symbol's lines.
 */
export function findSymbols(segs: Segment[], box: [number, number, number, number], minScore = 0.85): SymbolMatch[] {
  const sample = sampleSymbol(segs, box);
  return sample ? matchSymbol(sample, segs, minScore) : [];
}

/** Loose first look, used only to find which of the sample's lines are the symbol. */
const LOOSE = 0.5;
/** A part of the sample that at least this share of the symbol's copies have beside it is part of the symbol. */
const CORE_SHARE = 0.75;

interface Ctx {
  /** The sheet's lines long enough to match on. */
  lines: Line[];
  index: Index<Line>;
  /** Every segment, dots and fill slivers included, for the ink test. */
  all: Index<Segment>;
  tol: number;
  reach: number;
}

type Found = SymbolMatch & { hit: boolean[] };
const strip = ({ at, turn, score }: Found): SymbolMatch => ({ at, turn, score });

/**
 * Every copy of a sampled symbol among a sheet's segments.
 *
 * A box dragged round a symbol on a busy sheet also catches a bit of pipe, wall or door swing
 * beside it, and those bits differ at every copy. When the sample's lines all together find fewer
 * copies than the symbol itself does, the symbol is matched alone: the shape the box was aimed
 * at, with the shapes nearly all its copies have beside it.
 */
export function matchSymbol(sample: SymbolSample, segs: Segment[], minScore = 0.85): SymbolMatch[] {
  const lines: Line[] = segs.filter((s) => len(s) >= 0.4);
  const cell = Math.max(4, sample.span / 2);
  const tol = Math.max(0.35, sample.span * 0.01);
  const ctx: Ctx = { lines, index: new Index(lines, cell), all: new Index(segs, cell), tol, reach: reachFor(tol * 2, cell) };

  const direct = search(sample.lines, ctx, minScore, [rarestAnchor(sample.lines, ctx)], inkCheck(sample, sample.lines, ctx));
  if (sample.lines.length < 4) return direct.map(strip);
  let best = direct;
  const consider = (core: Line[], probe: Found[]) => {
    if (core.length < 2 || core.length === sample.lines.length) return;
    const run = coreSearch(sample, core, probe, ctx, minScore);
    if (run.length > best.length) best = run;
  };

  // The shape the box was aimed at, and the shapes nearly every copy of it has beside it.
  const groups = new Map<number, Line[]>();
  for (const l of sample.lines) {
    const k = l.group ?? 0;
    const list = groups.get(k);
    if (list) list.push(l);
    else groups.set(k, [l]);
  }
  const central = groups.size > 1 ? aimedAt([...groups.values()], sample) : undefined;
  if (central) {
    const probe = search(central, ctx, minScore, [rarestAnchor(central, ctx)], null);
    if (probe.length > direct.length) {
      const core = [...central];
      for (const ls of groups.values()) {
        if (ls === central) continue;
        // Drawn inside the shape (the dot in ⊙): part of the symbol, whatever other symbols share
        // its outline. A same-size outline over it (a solid triangle's fill) is not inside it: some
        // copies are drawn without one.
        const inside = area(ls) < area(central) * 0.8 && ls.every((l) => holds(central, l.x1, l.y1, tol) && holds(central, l.x2, l.y2, tol));
        const share = inside ? 1 : probe.filter((f) => present(ls, f, ctx) >= minScore).length / probe.length;
        // A fill over the shape's own outline that some copies are drawn without is optional.
        const overlay = !inside && sameBox(ls, central, tol * 2) && share < 1;
        if (share >= CORE_SHARE && !overlay) core.push(...ls);
      }
      consider(core, probe);
    }
  }

  // Lines without shapes to go on: a loose look from several anchors, keeping the lines most copies share.
  const anchors = [...sample.lines].sort((a, b) => len(b) - len(a)).slice(0, 8);
  let loose: Found[] = [];
  for (const a of anchors) {
    const run = search(sample.lines, ctx, LOOSE, [a], null);
    if (run.length > loose.length) loose = run;
  }
  if (loose.length >= 2 && loose.length > direct.length) {
    const share = sample.lines.map((_, i) => loose.filter((f) => f.hit[i]).length / loose.length);
    consider(
      sample.lines.filter((_, i) => share[i] >= CORE_SHARE),
      loose,
    );
  }
  return best.map(strip);
}

const area = (ls: Line[]) => {
  const [a, b, c, d] = boundsOf(ls);
  return (c - a) * (d - b);
};
const sameBox = (a: Line[], b: Line[], tol: number) => {
  const p = boundsOf(a);
  const q = boundsOf(b);
  return p.every((v, i) => Math.abs(v - q[i]) <= tol);
};
const holds = (ls: Line[], x: number, y: number, pad: number) => {
  const [a, b, c, d] = boundsOf(ls);
  return x >= a - pad && x <= c + pad && y >= b - pad && y <= d + pad;
};

/**
 * The shape the box was aimed at: one round the box's centre, centred nearest it, the outer of
 * shapes drawn about one centre (the ring of ⊙, not its dot). Slivers (the scanlines a solid
 * dot is filled with) and lone short lines are too little to go on.
 */
function aimedAt(groups: Line[][], sample: SymbolSample): Line[] | undefined {
  const aim = sample.aim ?? [0, 0];
  const step = Math.max(0.5, sample.span * 0.05);
  const off = (ls: Line[]) => {
    const [a, b, c, d] = boundsOf(ls);
    return Math.round(Math.hypot((a + c) / 2 - aim[0], (b + d) / 2 - aim[1]) / step);
  };
  const round = (ls: Line[]) => Number(holds(ls, aim[0], aim[1], 0.35));
  const biggest = Math.max(...groups.map(area));
  // Of an outline and the fill drawn over it, the stroke: every copy has that.
  const pen = (ls: Line[]) => Math.max(...ls.map((l) => l.width));
  return groups
    .filter((ls) => (ls.length >= 2 || len(ls[0]) >= sample.span * 0.3) && area(ls) >= biggest * 0.05)
    .sort((a, b) => round(b) - round(a) || off(a) - off(b) || area(b) - area(a) || pen(b) - pen(a))[0];
}

/** Share of `lines` (in sample coordinates) drawn at a copy's place and turn. */
function present(lines: Line[], f: Found, ctx: Ctx): number {
  let n = 0;
  for (const l of lines) {
    const [ax, ay] = rot(l.x1, l.y1, f.turn);
    const [bx, by] = rot(l.x2, l.y2, f.turn);
    const x1 = ax + f.at[0];
    const y1 = ay + f.at[1];
    const x2 = bx + f.at[0];
    const y2 = by + f.at[1];
    if (ctx.index.near((x1 + x2) / 2, (y1 + y2) / 2, ctx.reach).some((s) => samePen(s.width, l.width) && sameEnds(s, x1, y1, x2, y2, ctx.tol))) n++;
  }
  return n / lines.length;
}

/** Matches part of the sample on its own, about its own centre: turned copies land on one place and the mark sits on the symbol. */
function coreSearch(sample: SymbolSample, core: Line[], probe: Found[], ctx: Ctx, minScore: number): Found[] {
  const [x0, y0, x1, y1] = boundsOf(core);
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const centred = core.map((l) => ({ ...l, x1: l.x1 - mx, y1: l.y1 - my, x2: l.x2 - mx, y2: l.y2 - my }));
  // The sample's own copy is on this sheet when a probe copy sits where it was taken: its ink is measured there.
  const o = sample.origin;
  const home = o && probe.some((f) => Math.hypot(f.at[0] - o[0], f.at[1] - o[1]) <= ctx.tol * 2);
  const part: SymbolSample = { lines: centred, span: sample.span, origin: home ? [o[0] + mx, o[1] + my] : undefined };
  return search(centred, ctx, minScore, [rarestAnchor(centred, ctx)], inkCheck(part, centred, ctx));
}

/**
 * The ink test: a copy must have about as much linework inside its outline as the sample (an
 * open circle is not a circle with a dot in it, nor the other way round). Measured where the
 * sample was taken when that is on this sheet, otherwise the count stored with the sample.
 */
function inkCheck(sample: SymbolSample, lines: Line[], ctx: Ctx): ((x: number, y: number, turn: number) => boolean) | null {
  const [x0, y0, x1, y1] = boundsOf(lines);
  const hw = Math.max(0.5, (x1 - x0) / 2);
  const hh = Math.max(0.5, (y1 - y0) / 2);
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const o = sample.origin;
  const want = lines === sample.lines && sample.ink !== undefined ? sample.ink : o ? inkAt(ctx.all, o[0] + mx, o[1] + my, hw, hh) : undefined;
  if (want === undefined) return null;
  const slack = Math.max(2, want * 0.25);
  return (x, y, turn) => {
    const [ox, oy] = rot(mx, my, turn);
    const [w, h] = turn % 2 ? [hh, hw] : [hw, hh];
    return Math.abs(inkAt(ctx.all, x + ox, y + oy, w, h) - want) <= slack;
  };
}

/** The line, of the sample's longest, whose length and pen are rarest on the sheet (fewest places to try). */
function rarestAnchor(rel: Line[], ctx: Ctx): Line {
  const count = (a: Line) => ctx.lines.filter((s) => samePen(s.width, a.width) && Math.abs(len(s) - len(a)) <= ctx.tol).length;
  const longest = [...rel].sort((a, b) => len(b) - len(a)).slice(0, 6);
  return longest.reduce((a, b) => (count(b) < count(a) ? b : a));
}

/** Every place the lines `rel` are drawn, moved, turned or mirrored, found from `anchors`. */
function search(rel: Line[], ctx: Ctx, minScore: number, anchors: Line[], inkOk: ((x: number, y: number, turn: number) => boolean) | null): Found[] {
  const { tol, reach } = ctx;
  const found: Found[] = [];
  // Places already matched, on a grid one symbol wide, so a copy is counted once. The symbol's
  // own linework sets the width, not the box it was taken with: two heads either side of a
  // door are two heads however loosely the box was dragged.
  const [x0, y0, x1, y1] = boundsOf(rel);
  const span = Math.max(1, x1 - x0, y1 - y0);
  const placed = new Map<string, Pt[]>();
  const taken = (x: number, y: number) => {
    const gx = Math.floor(x / span);
    const gy = Math.floor(y / span);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) for (const p of placed.get(`${gx + i},${gy + j}`) ?? []) if (Math.hypot(p[0] - x, p[1] - y) < span / 2) return true;
    return false;
  };
  // Sheet lines already part of a copy: the same lines found again from another turn are one copy, not two.
  const claimed = new Set<Line>();
  for (const anchor of anchors) {
    const aLen = len(anchor);
    const candidates = ctx.lines.filter((s) => samePen(s.width, anchor.width) && Math.abs(len(s) - aLen) <= tol);
    for (let turn = 0; turn < 8; turn++) {
      const turned = rel.map((s) => {
        const [ax, ay] = rot(s.x1, s.y1, turn);
        const [bx, by] = rot(s.x2, s.y2, turn);
        return { ax, ay, bx, by, width: s.width };
      });
      const [pax, pay] = rot(anchor.x1, anchor.y1, turn);
      const [pbx, pby] = rot(anchor.x2, anchor.y2, turn);
      for (const c of candidates) {
        // The candidate's ends match the anchor's either way round: two possible places.
        for (const [ox, oy] of [
          [c.x1 - pax, c.y1 - pay],
          [c.x1 - pbx, c.y1 - pby],
        ]) {
          if (!sameEnds(c, pax + ox, pay + oy, pbx + ox, pby + oy, tol)) continue;
          if (taken(ox, oy)) continue;
          let hits = 0;
          const hit: boolean[] = new Array(turned.length).fill(false);
          const used: Line[] = [];
          for (let i = 0; i < turned.length; i++) {
            const t = turned[i];
            const ax = t.ax + ox;
            const ay = t.ay + oy;
            const bx = t.bx + ox;
            const by = t.by + oy;
            const s = ctx.index.near((ax + bx) / 2, (ay + by) / 2, reach).find((s) => samePen(s.width, t.width) && sameEnds(s, ax, ay, bx, by, tol));
            if (s) {
              hits++;
              hit[i] = true;
              used.push(s);
            }
            // Stop early once a match is out of reach.
            if (hits + (turned.length - i - 1) < minScore * turned.length) break;
          }
          const score = hits / turned.length;
          if (score < minScore) continue;
          if (used.filter((s) => claimed.has(s)).length >= used.length / 2) continue;
          if (inkOk && !inkOk(ox, oy, turn)) continue;
          for (const s of used) claimed.add(s);
          found.push({ at: [ox, oy], turn, score, hit });
          const k = `${Math.floor(ox / span)},${Math.floor(oy / span)}`;
          const list = placed.get(k);
          if (list) list.push([ox, oy]);
          else placed.set(k, [[ox, oy]]);
        }
      }
    }
  }
  return found;
}
