import type { Pt } from '../model';
import type { Segment } from '../fill/vectors';
import { findWallRuns, SegmentIndex, type WallRun } from './bands';
import { lightWall } from './lightWalls';
import { distToSeg, resolveTags, type TagText, type WallTag } from './tags';

export interface TypedRun extends WallRun {
  id: number;
  /** Wall types on this wall: at most one per kind (an exterior wall can also carry its furring). */
  tags: string[];
  /** How the types were found: a tag pointing at it, or carried along from a tagged wall it continues. */
  how: 'tag' | 'carried' | null;
  /** Drawn in light lines (shown above or below, curtain wall), found only because a tag points at it. */
  light?: boolean;
}

export interface WallTakeoffResult {
  runs: TypedRun[];
  tags: WallTag[];
  /** Tags that point at no wall found. */
  unmatched: WallTag[];
}

export interface WallTakeoffOptions {
  /** Thinnest and thickest wall, in metres. */
  minThickness?: number;
  maxThickness?: number;
  /**
   * Where a wall that runs into the side of another stops: at the other wall's
   * centreline (`centre`, centreline measuring) or at its face.
   */
  tee?: 'centre' | 'face';
  /**
   * Where a tag's type spreads to untagged walls of the same thickness: nowhere,
   * along its own wall and round corners, or also into walls that run into it.
   */
  carry?: 'none' | 'wall' | 'wall+tees';
  /**
   * Door openings (the strip between the two wall faces), and whether partitions
   * are measured through them. Exterior walls are always measured through openings.
   */
  doors?: Pt[][];
  throughDoors?: boolean;
  /** Partition types stopped at door openings even when the rest are measured through (finish-only types). */
  stopAtDoors?: string[];
  /** Codes the project's assembly schedules give as exterior walls (WE1), whatever their prefix. */
  exterior?: string[];
  /** Kind of each code as the set's assembly types sheet gives it (exterior, partition, furring, foundation). */
  kinds?: Record<string, string>;
}

/** Kinds of wall tag. A wall has at most one of each; a tag's type spreads only within its kind. */
export function tagKind(code: string, exterior?: readonly string[], kinds?: Record<string, string>): string {
  if (exterior?.includes(code)) return 'exterior';
  const letters = code.replace(/-?\d.*$/, '').toUpperCase();
  // An "x" after the prefix marks existing work of the same kind (wx1, FRX2).
  const prefix = letters.length > 1 && letters.endsWith('X') && letters !== 'EX' ? letters.slice(0, -1) : letters;
  // Furring and foundation walls by their letters, even listed among the interior or exterior wall types.
  const lettered = prefix === 'FR' ? 'furring' : prefix === 'FW' ? 'foundation' : null;
  const given = kinds?.[code];
  if (given) return lettered && (given === 'partition' || given === 'exterior') ? lettered : given;
  if (lettered) return lettered;
  if (prefix === 'EW' || prefix === 'EXT' || prefix === 'EP' || prefix === 'EX') return 'exterior';
  return 'partition';
}

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const runLength = (r: WallRun) => dist(r.a, r.b);

/**
 * Wall takeoff from vector linework: finds every wall (as a centreline with a
 * thickness), joins walls at corners and tees and splits them there, reads which
 * type each tag points at, and carries each type along the wall it tags (straight
 * on through junctions and round corners) to untagged pieces of the same thickness.
 */
export function wallTakeoff(
  wallLines: Segment[],
  allSegments: Segment[],
  texts: TagText[],
  metersPerPoint: number,
  options: WallTakeoffOptions = {},
): WallTakeoffResult {
  const { minThickness = 0.05, maxThickness = 0.65, tee = 'centre', carry = 'wall+tees', doors = [], throughDoors = true, stopAtDoors = [], exterior = [], kinds: codeKinds } = options;
  const pt = (m: number) => m / metersPerPoint;
  const found = findWallRuns(wallLines, pt(minThickness), pt(maxThickness)).filter(
    (r) => runLength(r) >= Math.max(pt(0.1), r.thickness * 0.5),
  );
  const tags = sameFamily(resolveTags(texts, allSegments));
  // A tag's own box or diamond, drawn in a wall pen, reads as a short thick wall: it is none.
  // (The symbol when one was read, else a box round the text with about its height to spare.)
  const inTag = (p: Pt) =>
    tags.some((t) => {
      const hx = Math.max(t.symbol ? t.symbol.size / 2 : 0, t.w / 2 + t.h) + 1;
      const hy = Math.max(t.symbol ? t.symbol.size / 2 : 0, t.h * 1.5) + 1;
      return Math.abs(p[0] - t.cx) <= hx && Math.abs(p[1] - t.cy) <= hy;
    });
  // Or its box's two long sides read as a wall's faces with the tag's text between them: a
  // short band round a tag's text (a wall a tag sits on runs on well past it).
  const roundTag = (r: WallRun) => {
    const L = runLength(r);
    const [ux, uy] = [(r.b[0] - r.a[0]) / L, (r.b[1] - r.a[1]) / L];
    return tags.some((t) => {
      const along = (t.cx - r.a[0]) * ux + (t.cy - r.a[1]) * uy;
      const across = Math.abs((t.cx - r.a[0]) * -uy + (t.cy - r.a[1]) * ux);
      return across <= r.thickness / 2 && along >= 0 && along <= L && L <= 3 * Math.max(t.w, 2 * t.h, t.symbol?.size ?? 0);
    });
  };
  const runs: WallRun[] = offSquare(found)
    .filter((r) => !(inTag(r.a) && inTag(r.b)) && !roundTag(r))
    .map((r) => ({ ...r, a: [...r.a] as Pt, b: [...r.b] as Pt }));

  // Join ends at corners and tees; remember where to split the walls they meet.
  const splits = runs.map(() => [] as Pt[]);
  const corners: { r1: number; end1: 'a' | 'b'; r2: number; at: Pt }[] = [];
  const tees: { r1: number; end1: 'a' | 'b'; r2: number; at: Pt }[] = [];
  const moves: { run: WallRun; end: 'a' | 'b'; to: Pt }[] = [];
  // Every search below looks only at the walls near the end or line it starts from (indexed by
  // their boxes, grown by the farthest each search reaches): a sheet's walls one by one against
  // all the others is the square of its walls.
  const thickest = runs.reduce((n, r) => Math.max(n, r.thickness), 0);
  const reachJ = thickest * 2 + 4;
  let index = runBoxes(runs, reachJ);
  runs.forEach((r, ri) => {
    for (const end of ['a', 'b'] as const) {
      const e = r[end];
      const o = end === 'a' ? r.b : r.a;
      const L = dist(e, o);
      const ux = (e[0] - o[0]) / L;
      const uy = (e[1] - o[1]) / L;
      let best: { x: number; r2: number; at: Pt; corner: boolean } | null = null;
      nearRuns(index, e, e, reachJ).forEach((r2i) => {
        const r2 = runs[r2i];
        if (r2i === ri) return;
        const L2 = runLength(r2);
        const vx = (r2.b[0] - r2.a[0]) / L2;
        const vy = (r2.b[1] - r2.a[1]) / L2;
        const den = ux * vy - uy * vx;
        if (Math.abs(den) < 0.34) return; // under ~20°: not a junction
        const qx = r2.a[0] - e[0];
        const qy = r2.a[1] - e[1];
        const x = (qx * vy - qy * vx) / den;
        const s = (qx * uy - qy * ux) / den;
        // Thick walls often meet round a column or pilaster, so the reach grows with thickness.
        const wide = Math.max(r.thickness, r2.thickness);
        const slack = r.thickness / 2 + 2 + wide * 1.5;
        if (x < -1 || x > r2.thickness / 2 + 2 + wide || s < -slack || s > L2 + slack) return;
        if (best && Math.abs(x) >= Math.abs(best.x)) return;
        best = { x, r2: r2i, at: [e[0] + ux * x, e[1] + uy * x], corner: s < slack || s > L2 - slack };
      });
      if (!best) continue;
      const b = best as { x: number; r2: number; at: Pt; corner: boolean };
      if (b.corner) {
        corners.push({ r1: ri, end1: end, r2: b.r2, at: b.at });
        moves.push({ run: r, end, to: b.at });
      } else {
        splits[b.r2].push(b.at);
        tees.push({ r1: ri, end1: end, r2: b.r2, at: b.at });
        if (tee === 'centre') moves.push({ run: r, end, to: b.at });
      }
    }
  });
  // A wall broken by a pier or a step in its faces carries on: free ends facing each
  // other on nearly one line, a short way apart, meet in the middle.
  const runNo = new Map(runs.map((r, i) => [r, i]));
  const joined = new Set(moves.map((m) => `${runNo.get(m.run)}${m.end}`));
  const reachC = thickest * 2.5 + 4;
  index = endBoxes(runs);
  const continues: { r1: number; end1: 'a' | 'b'; r2: number; end2: 'a' | 'b' }[] = [];
  runs.forEach((r, ri) => {
    for (const end of ['a', 'b'] as const) {
      if (joined.has(`${ri}${end}`)) continue;
      const e = r[end];
      const o = end === 'a' ? r.b : r.a;
      const L = dist(e, o);
      const ux = (e[0] - o[0]) / L;
      const uy = (e[1] - o[1]) / L;
      let best: { r2: number; end2: 'a' | 'b'; gap: number } | null = null;
      nearRuns(index, e, e, reachC, 2).forEach((r2i) => {
        const r2 = runs[r2i];
        if (r2i <= ri) return;
        for (const end2 of ['a', 'b'] as const) {
          if (joined.has(`${r2i}${end2}`)) continue;
          const e2 = r2[end2];
          const o2 = end2 === 'a' ? r2.b : r2.a;
          const L2 = dist(e2, o2);
          // Pointing back at this end, on nearly the same line.
          if (((o2[0] - e2[0]) * ux + (o2[1] - e2[1]) * uy) / L2 < 0.998) continue;
          const gap = (e2[0] - e[0]) * ux + (e2[1] - e[1]) * uy;
          const off = Math.abs((e2[0] - e[0]) * -uy + (e2[1] - e[1]) * ux);
          const thin = Math.min(r.thickness, r2.thickness);
          if (gap < -1 || gap > Math.max(2, 2 * Math.max(r.thickness, r2.thickness)) || off > Math.max(1.5, 0.3 * thin)) continue;
          if (Math.abs(r.thickness - r2.thickness) / Math.max(r.thickness, r2.thickness) > 0.35) continue;
          if (!best || gap < best.gap) best = { r2: r2i, end2, gap };
        }
      });
      if (!best) continue;
      const b = best as { r2: number; end2: 'a' | 'b'; gap: number };
      const e2 = runs[b.r2][b.end2];
      const mid: Pt = [(e[0] + e2[0]) / 2, (e[1] + e2[1]) / 2];
      moves.push({ run: r, end, to: mid }, { run: runs[b.r2], end: b.end2, to: mid });
      joined.add(`${ri}${end}`).add(`${b.r2}${b.end2}`);
      continues.push({ r1: ri, end1: end, r2: b.r2, end2: b.end2 });
    }
  });
  // A wall carries on through an opening drawn in its line (a window, a storefront, an overhead
  // door up to 3 m; a wider one, an overhead door, is left out as estimators do): free ends facing each other on one line, with the opening's
  // own lines (glazing, sill, frame) running along the wall between them for most of the gap.
  // A doorway or an open end has no such lines across it.
  const lineIndex = new SegmentIndex(allSegments, 32);
  const spanned = (r: WallRun, e: Pt, e2: Pt) => {
    const L = dist(e, e2);
    const [ux, uy] = [(e2[0] - e[0]) / L, (e2[1] - e[1]) / L];
    const half = r.thickness / 2 + 1;
    const pieces: [number, number][] = [];
    for (const i of lineIndex.query(Math.min(e[0], e2[0]) - half, Math.min(e[1], e2[1]) - half, Math.max(e[0], e2[0]) + half, Math.max(e[1], e2[1]) + half)) {
      const s = allSegments[i];
      if (s.curve || s.filled) continue;
      const sl = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      if (sl < 0.5 || Math.abs(((s.x2 - s.x1) * uy - (s.y2 - s.y1) * ux) / sl) > 0.02) continue;
      const across = (x: number, y: number) => Math.abs((x - e[0]) * -uy + (y - e[1]) * ux);
      if (across(s.x1, s.y1) > half || across(s.x2, s.y2) > half) continue;
      const t1 = (s.x1 - e[0]) * ux + (s.y1 - e[1]) * uy;
      const t2 = (s.x2 - e[0]) * ux + (s.y2 - e[1]) * uy;
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(L, Math.max(t1, t2));
      if (hi > lo) pieces.push([lo, hi]);
    }
    pieces.sort((m, n) => m[0] - n[0]);
    let covered = 0;
    let at = 0;
    for (const [lo, hi] of pieces) {
      if (hi <= at) continue;
      covered += hi - Math.max(lo, at);
      at = hi;
    }
    return covered >= 0.6 * L;
  };
  const reachO = pt(3);
  index = endBoxes(runs);
  runs.forEach((r, ri) => {
    for (const end of ['a', 'b'] as const) {
      if (joined.has(`${ri}${end}`)) continue;
      const e = r[end];
      const o = end === 'a' ? r.b : r.a;
      const L = dist(e, o);
      const ux = (e[0] - o[0]) / L;
      const uy = (e[1] - o[1]) / L;
      let best: { r2: number; end2: 'a' | 'b'; gap: number } | null = null;
      nearRuns(index, e, e, reachO, 2).forEach((r2i) => {
        const r2 = runs[r2i];
        if (r2i === ri) return;
        for (const end2 of ['a', 'b'] as const) {
          if (joined.has(`${r2i}${end2}`)) continue;
          const e2 = r2[end2];
          const o2 = end2 === 'a' ? r2.b : r2.a;
          const L2 = dist(e2, o2);
          if (((o2[0] - e2[0]) * ux + (o2[1] - e2[1]) * uy) / L2 < 0.998) continue;
          const gap = (e2[0] - e[0]) * ux + (e2[1] - e[1]) * uy;
          const off = Math.abs((e2[0] - e[0]) * -uy + (e2[1] - e[1]) * ux);
          const thin = Math.min(r.thickness, r2.thickness);
          if (gap <= 0 || gap > reachO || off > Math.max(1.5, 0.3 * thin)) continue;
          if (Math.abs(r.thickness - r2.thickness) / Math.max(r.thickness, r2.thickness) > 0.35) continue;
          if (!best || gap < best.gap) best = { r2: r2i, end2, gap };
        }
      });
      if (!best) continue;
      const b = best as { r2: number; end2: 'a' | 'b'; gap: number };
      const e2 = runs[b.r2][b.end2];
      if (!spanned(r, e, e2)) continue;
      const mid: Pt = [(e[0] + e2[0]) / 2, (e[1] + e2[1]) / 2];
      moves.push({ run: r, end, to: mid }, { run: runs[b.r2], end: b.end2, to: mid });
      joined.add(`${ri}${end}`).add(`${b.r2}${b.end2}`);
      continues.push({ r1: ri, end1: end, r2: b.r2, end2: b.end2 });
    }
  });
  // Tags are matched against each wall as drawn, before its ends reach into junctions.
  const drawn = runs.map((r) => ({ ...r, a: [...r.a] as Pt, b: [...r.b] as Pt }));
  for (const m of moves) m.run[m.end] = m.to;
  // Two walls on one line that both end at one junction (a wall meeting them there from
  // the side) continue each other through it.
  index = endBoxes(runs);
  runs.forEach((r, ri) => {
    for (const end of ['a', 'b'] as const) {
      const e = r[end];
      const o = end === 'a' ? r.b : r.a;
      const L = dist(e, o);
      nearRuns(index, e, e, Math.max(2, thickest / 2) + 1, 2).forEach((r2i) => {
        const r2 = runs[r2i];
        if (r2i <= ri) return;
        for (const end2 of ['a', 'b'] as const) {
          const e2 = r2[end2];
          const o2 = end2 === 'a' ? r2.b : r2.a;
          if (dist(e, e2) > Math.max(2, Math.min(r.thickness, r2.thickness) / 2)) continue;
          const dot = ((e[0] - o[0]) * (e2[0] - o2[0]) + (e[1] - o[1]) * (e2[1] - o2[1])) / (L * dist(e2, o2));
          if (dot > -0.998) continue;
          if (!continues.some((c) => (c.r1 === ri && c.end1 === end) || (c.r2 === r2i && c.end2 === end2))) continues.push({ r1: ri, end1: end, r2: r2i, end2 });
        }
      });
    }
  });

  // Walls crossing each other split each other too.
  index = runBoxes(runs, 1);
  for (let i = 0; i < runs.length; i++) {
    for (const j of nearRuns(index, runs[i].a, runs[i].b, 1)) {
      if (j <= i) continue;
      const p = crossing(runs[i], runs[j]);
      if (p) {
        splits[i].push(p);
        splits[j].push(p);
      }
    }
  }

  // Split into pieces between junctions; pieces of one wall continue into each other.
  const pieces: TypedRun[] = [];
  const pieceRun: number[] = [];
  const firstPiece: number[] = [];
  const lastPiece: number[] = [];
  const links: [number, number, 'straight' | 'corner' | 'tee'][] = [];
  runs.forEach((r, ri) => {
    const L = runLength(r);
    const ux = (r.b[0] - r.a[0]) / L;
    const uy = (r.b[1] - r.a[1]) / L;
    const ts = splits[ri]
      .map((p) => (p[0] - r.a[0]) * ux + (p[1] - r.a[1]) * uy)
      .filter((t) => t > 1 && t < L - 1)
      .sort((m, n) => m - n)
      .filter((t, k, all) => k === 0 || t - all[k - 1] > 1);
    const at = (t: number): Pt => [r.a[0] + ux * t, r.a[1] + uy * t];
    const bounds = [0, ...ts, L];
    firstPiece[ri] = pieces.length;
    for (let k = 0; k < bounds.length - 1; k++) {
      if (k > 0) links.push([pieces.length - 1, pieces.length, 'straight']);
      pieceRun.push(ri);
      pieces.push({ a: k === 0 ? r.a : at(bounds[k]), b: k === bounds.length - 2 ? r.b : at(bounds[k + 1]), thickness: r.thickness, id: pieces.length, tags: [], how: null });
    }
    lastPiece[ri] = pieces.length - 1;
  });
  const pieceAtEnd = (ri: number, end: 'a' | 'b') => (end === 'a' ? firstPiece[ri] : lastPiece[ri]);
  for (const c of corners) {
    const r2 = runs[c.r2];
    const end2 = dist(r2.a, c.at) <= dist(r2.b, c.at) ? 'a' : 'b';
    links.push([pieceAtEnd(c.r1, c.end1), pieceAtEnd(c.r2, end2), 'corner']);
  }
  for (const c of continues) links.push([pieceAtEnd(c.r1, c.end1), pieceAtEnd(c.r2, c.end2), 'straight']);
  // A wall running into the side of another: an untagged one is most likely the same type.
  for (const t of carry === 'wall+tees' ? tees : []) {
    const stem = pieceAtEnd(t.r1, t.end1);
    for (let i = firstPiece[t.r2]; i <= lastPiece[t.r2]; i++) {
      if (dist(pieces[i].a, t.at) < 1.5 || dist(pieces[i].b, t.at) < 1.5) links.push([stem, i, 'tee']);
    }
  }

  // A thin band lying against a thick wall along its length (and the bands lying against
  // it) is a leaf of a built-up wall, the lining inside a masonry or exterior wall: a
  // different construction from a partition standing on its own.
  const pieceIndex = new SegmentIndex(pieces.map((p) => ({ x1: p.a[0], y1: p.a[1], x2: p.b[0], y2: p.b[1], width: 0, filled: false })), 32);
  const reach = pt(maxThickness) / 2 + 2;
  const beside = pieces.map((p) =>
    pieceIndex
      .query(Math.min(p.a[0], p.b[0]) - p.thickness / 2 - reach, Math.min(p.a[1], p.b[1]) - p.thickness / 2 - reach, Math.max(p.a[0], p.b[0]) + p.thickness / 2 + reach, Math.max(p.a[1], p.b[1]) + p.thickness / 2 + reach)
      .filter((j) => j !== p.id && alongside(p, pieces[j])),
  );
  const thick = pieces.map((p) => p.thickness >= pt(0.25));
  const layered = pieces.map((p, i) => !thick[i] && beside[i].some((j) => thick[j] && pieces[j].thickness >= 2 * p.thickness));
  for (let k = 0, grow = true; grow && k < 10; k++) {
    grow = false;
    pieces.forEach((_, i) => {
      if (!layered[i] && !thick[i] && beside[i].some((j) => layered[j])) grow = layered[i] = true;
    });
  }
  /** The thick walls a leaf belongs to: reached across the leaves lying against each other. */
  const bodyOf = (i: number): number[] => {
    const seen = new Set([i]);
    const out: number[] = [];
    for (const q = [i]; q.length; ) {
      for (const j of beside[q.shift()!]) {
        if (seen.has(j)) continue;
        seen.add(j);
        if (thick[j]) out.push(j);
        else if (layered[j]) q.push(j);
      }
    }
    return out;
  };
  // Types from tags: each tag labels the piece of wall it points at.
  const unmatched: WallTag[] = [];
  const tagged = pieces.map(() => new Map<string, { codes: string[]; d: number }>());
  /** Pieces of a furring wrap round a column: the wrap is the whole of that type there. */
  const wrapped = new Set<number>();
  const drawnIndex = runBoxes(drawn, 1);
  for (const tag of tags) {
    // Follow each leader out from the tag; the first point that lands on a wall is
    // what it points at, and the leader that gets there soonest wins. A tag with
    // no leader sits beside its wall.
    let bestRun = -1;
    let bestD = Infinity;
    let bestSteps = Infinity;
    const stepped = (path: Pt[]): Pt[] =>
      path.flatMap((p, k) => {
        if (k === 0) return [p];
        const q = path[k - 1];
        const n = Math.max(1, Math.ceil(dist(p, q)));
        return Array.from({ length: n }, (_, i): Pt => [q[0] + ((p[0] - q[0]) * (i + 1)) / n, q[1] + ((p[1] - q[1]) * (i + 1)) / n]);
      });
    // A code outside the usual wall prefixes is a wall type only when its leader lands on a wall.
    if (tag.generic && !tag.leader) continue;
    // A tick is followed in small steps from the box, so the first wall it crosses is found.
    const paths = tag.leader ? (tag.tick ? tag.paths.map(stepped) : tag.paths) : [[tag.target]];
    for (const path of paths) {
      for (let k = tag.leader ? 1 : 0; k < Math.min(path.length, bestSteps); k++) {
        let hit = -1;
        let hitD = Infinity;
        // The farthest a wall's centreline can be from the point and still be hit.
        const far = thickest / 2 + Math.max(1.5, tag.symbol ? tag.symbol.size * 1.5 : 0, pt(1.0)) + 1;
        nearRuns(drawnIndex, path[k], path[k], far).forEach((ri) => {
          const r = drawn[ri];
          // A tick lands inside the wall's band itself, not in the round end beyond it (a
          // locker or a cabinet drawn square on beside the wall reads as a short thick wall).
          const d = tag.tick ? distInBand(path[k], r) : distToRun(path[k], r);
          // A tag with no leader sits on its wall or beside it, within about its own size.
          const limit = tag.leader ? r.thickness / 2 + 1.5 : tag.symbol ? r.thickness / 2 + tag.symbol.size * 1.5 : pt(1.0);
          if (d <= limit && d - r.thickness / 2 < hitD) {
            hit = ri;
            hitD = d - r.thickness / 2;
          }
        });
        if (hit < 0) continue;
        if (k < bestSteps || hitD < bestD) {
          bestRun = hit;
          bestD = hitD;
          bestSteps = k;
          tag.target = path[k];
        }
        break;
      }
    }
    // The piece of that wall the tag points at.
    let best: TypedRun | null = null;
    let nearest = Infinity;
    for (let i = 0; i < pieces.length; i++) {
      if (pieceRun[i] !== bestRun) continue;
      const d = distToRun(tag.target, pieces[i]);
      if (d < nearest) {
        nearest = d;
        best = pieces[i];
      }
    }
    if (!best) {
      unmatched.push(tag);
      continue;
    }
    // Two tags of one kind on one piece: the one pointing more squarely at it wins.
    const kind = tagKind(tag.code, exterior, codeKinds);
    // An exterior or foundation type names the whole built-up wall: a tag landing on a leaf
    // of it (a face line just beside the wall) goes to the wall's body.
    if ((kind === 'exterior' || kind === 'foundation') && layered[best.id]) {
      const here = tag.target;
      const body = bodyOf(best.id)
        .filter((j) => distToRun(here, pieces[j]) <= pieces[j].thickness + best!.thickness + 3)
        .sort((i, j) => distToRun(here, pieces[i]) - distToRun(here, pieces[j]))[0];
      if (body !== undefined) best = pieces[body];
    }
    // Exterior and foundation walls can stack (a screen wall over the wall below, both
    // tagged on one line); for partitions the tag pointing more squarely wins.
    const prev = tagged[best.id].get(kind);
    if (prev && (kind === 'exterior' || kind === 'foundation') && !prev.codes.includes(tag.code)) {
      tagged[best.id].set(kind, { codes: [...prev.codes, tag.code], d: Math.min(prev.d, bestD) });
    } else if (!prev || bestD < prev.d) tagged[best.id].set(kind, { codes: [tag.code], d: bestD });
    // Furring wrapped round a column: the tag lands inside the wrap (on the column),
    // so the type goes to the wrap all round instead.
    if (kind === 'furring') {
      const wrap = enclosure(best, pieces, pt(1.0), pt(6));
      if (wrap) {
        tagged[best.id].delete(kind);
        for (const i of wrap) {
          if (!tagged[i].has(kind)) tagged[i].set(kind, { codes: [tag.code], d: bestD });
          wrapped.add(i);
        }
      }
    }
  }

  // Carry each kind along connected pieces of similar thickness; nearest tag wins.
  // Partitions and furring keep to walls of the same thickness. Exterior and
  // foundation types follow their wall on round corners even where it thickens
  // (cladding, footings change), but never into walls that run into it.
  // Existing walls drawn solid (poché) and new ones drawn as outlines or hatched are different
  // work on a renovation: a type never carries from one to the other. (New work can be drawn
  // over the poché, so a solid wall is one filled with nothing drawn inside it.)
  const filledIndex = new SegmentIndex(allSegments.filter((s) => s.filled), 16);
  const strokeIndex = new SegmentIndex(allSegments, 16);
  const solid = pieces.map((p) => {
    const L = runLength(p);
    if (L < 0.5) return 'other';
    const [ux, uy] = [(p.b[0] - p.a[0]) / L, (p.b[1] - p.a[1]) / L];
    const mid: Pt = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2];
    const at = (side: number): Pt => [mid[0] - (uy * side * p.thickness) / 2, mid[1] + (ux * side * p.thickness) / 2];
    const faces = [1, -1].map((side) => {
      const f = at(side);
      return filledIndex.query(f[0] - 1, f[1] - 1, f[0] + 1, f[1] + 1).map((i) => filledIndex.segs[i]).filter((q) => distToSeg(f[0], f[1], q) < 1);
    });
    // Faces drawn as lines (not a door or window opening the model closed across).
    const outlined = [1, -1].every((side) => {
      const f = at(side);
      return strokeIndex.query(f[0] - 1, f[1] - 1, f[0] + 1, f[1] + 1).some((i) => !strokeIndex.segs[i].filled && distToSeg(f[0], f[1], strokeIndex.segs[i]) < 1);
    });
    // Along a long filled edge each side: a column's square of poché in a new wall is no existing wall.
    const filled = faces.every((f) => f.some((q) => Math.hypot(q.x2 - q.x1, q.y2 - q.y1) >= Math.max(3 * p.thickness, pt(1.5))));
    const anyFill = faces.some((f) => f.length > 0);
    const reach = Math.min(L / 2, 10);
    const r = reach + p.thickness;
    const inside = strokeIndex.query(mid[0] - r, mid[1] - r, mid[0] + r, mid[1] + r).filter((i) => {
      const q = strokeIndex.segs[i];
      const c: Pt = [(q.x1 + q.x2) / 2, (q.y1 + q.y2) / 2];
      const along = (c[0] - mid[0]) * ux + (c[1] - mid[1]) * uy;
      const across = Math.abs((c[0] - mid[0]) * -uy + (c[1] - mid[1]) * ux);
      return Math.abs(along) <= reach && across < p.thickness / 2 - 0.5;
    });
    const lines = inside.filter((i) => !strokeIndex.segs[i].filled).length;
    // Solid: filled with nothing drawn inside. New: an outline, or hatched with insulation
    // lines. (Filled with a concrete stipple, a pier, is neither.)
    return filled && !inside.length ? 'solid' : (!anyFill && outlined) || lines >= 4 ? 'new' : 'other';
  });
  const apart = (i: number, j: number) => (solid[i] === 'solid' && solid[j] === 'new') || (solid[i] === 'new' && solid[j] === 'solid');
  const adj = pieces.map(() => [] as { j: number; diff: number; tee: boolean; link: 'straight' | 'corner' | 'tee'; apart: boolean; leaf: boolean }[]);
  for (const [i, j, kind] of links) {
    if (carry === 'none') continue;
    const diff = Math.abs(pieces[i].thickness - pieces[j].thickness) / Math.max(pieces[i].thickness, pieces[j].thickness);
    const abs = Math.abs(pieces[i].thickness - pieces[j].thickness);
    const cut = apart(i, j);
    const leaf = layered[i] !== layered[j];
    adj[i].push({ j, diff: abs <= 0.6 ? 0 : diff, tee: kind === 'tee', link: kind, apart: cut, leaf });
    adj[j].push({ j: i, diff: abs <= 0.6 ? 0 : diff, tee: kind === 'tee', link: kind, apart: cut, leaf });
  }
  const followsWall = (kind: string) => kind === 'exterior' || kind === 'foundation';
  const kinds = [...new Set(tagged.flatMap((m) => [...m.keys()]))];
  const carried = pieces.map(() => new Map<string, string[]>());
  // All kinds spread at once, nearest tag first: a partition type stops where an exterior or
  // foundation type got first, and the other way round (furring lines either).
  const competes = (a: string, b: string) => a !== b && (a === 'partition' || b === 'partition');
  const best = new Map(kinds.map((k) => [k, pieces.map(() => Infinity)]));
  const code = new Map(kinds.map((k) => [k, pieces.map((): string[] | null => null)]));
  const done = new Map(kinds.map((k) => [k, new Set<number>()]));
  const queue = new Queue<[string, number]>();
  for (const kind of kinds) {
    pieces.forEach((_, i) => {
      const t = tagged[i].get(kind);
      if (t) {
        best.get(kind)![i] = 0;
        code.get(kind)![i] = t.codes;
        queue.push([kind, i], 0);
      }
    });
  }
  // Dijkstra on piece centres.
  while (queue.size) {
    const [kind, i] = queue.pop();
    const bestK = best.get(kind)!;
    const codeK = code.get(kind)!;
    if (done.get(kind)!.has(i)) continue;
    done.get(kind)!.add(i);
    // Another kind got here first: this type goes no further.
    if (kinds.some((k2) => competes(kind, k2) && done.get(k2)!.has(i) && code.get(k2)![i] && best.get(k2)![i] < bestK[i])) {
      codeK[i] = null;
      continue;
    }
    for (const { j, diff, tee, link, apart: cut, leaf } of adj[i]) {
      // New work stops at existing walls (furring is the exception: it lines them).
      if (cut && kind !== 'furring') continue;
      // A type does not run on into the lining of a built-up wall, nor out of one (furring
      // is lining).
      if (leaf && kind !== 'furring') continue;
      // Furring and finishes belong to a room: they turn its corners but stop where a
      // wall meets them and the wall carries on into the next room.
      if (kind === 'furring' && (link === 'straight' || wrapped.has(i))) continue;
      // Within a fifth of the thickness counts as the same wall for exterior and
      // foundation walls (cladding and footing changes, pilasters); others must match.
      // An exterior or foundation wall is the building's edge: a wall running into its side
      // (or that it runs into) is an interior wall, however thick it is drawn.
      if (followsWall(kind) && tee) continue;
      if (diff > (followsWall(kind) ? 0.2 : 0)) continue;
      const d = bestK[i] + (runLength(pieces[i]) + runLength(pieces[j])) / 2;
      if (d < bestK[j]) {
        bestK[j] = d;
        codeK[j] = codeK[i];
        queue.push([kind, j], d);
      }
    }
  }
  for (const kind of kinds) {
    pieces.forEach((_, i) => {
      const c = code.get(kind)![i];
      if (c && !tagged[i].has(kind) && done.get(kind)!.has(i)) carried[i].set(kind, c);
    });
  }
  // The side of a column wrap that lies on a furring line running past the column is
  // both: the wrap, and the furring continuing behind the column.
  for (const i of wrapped) {
    const ends = adj[i].filter((n) => n.link === 'straight').map((n) => carried[n.j].get('furring') ?? tagged[n.j].get('furring')?.codes);
    const own = tagged[i].get('furring')?.codes ?? [];
    if (ends.length >= 2 && ends[0] && ends.every((c) => c && c.join() === ends[0]!.join()) && ends[0].some((c) => !own.includes(c))) {
      carried[i].set('furring', ends[0].filter((c) => !own.includes(c)));
    }
  }
  for (const p of pieces) {
    const own = [...tagged[p.id].values()].flatMap((t) => t.codes);
    const more = [...carried[p.id].values()].flat();
    p.tags = [...own, ...more];
    p.how = own.length ? 'tag' : more.length ? 'carried' : null;
  }
  // An opening another wall passes through is a junction, not a door.
  const cuts = (p: TypedRun) => isPartition(p.tags, exterior, codeKinds) && (!throughDoors || p.tags.some((t) => stopAtDoors.includes(t)));
  const doorways = throughDoors && !stopAtDoors.length
    ? []
    : doors.filter((q) => {
        const cx = q.reduce((n, v) => n + v[0], 0) / q.length;
        const cy = q.reduce((n, v) => n + v[1], 0) / q.length;
        return !nearRuns(drawnIndex, [cx, cy], [cx, cy], thickest / 2 + 1).some((ri) => {
          const r = drawn[ri];
          const L = runLength(r);
          const t = ((cx - r.a[0]) * (r.b[0] - r.a[0]) + (cy - r.a[1]) * (r.b[1] - r.a[1])) / L;
          if (t < 0 || t > L) return false;
          const along = Math.abs((q[1][0] - q[0][0]) * (r.b[0] - r.a[0]) + (q[1][1] - q[0][1]) * (r.b[1] - r.a[1])) / (L * dist(q[0], q[1]) || 1);
          return along < 0.5 && distToRun([cx, cy], r) <= r.thickness / 2;
        });
      });
  const measured = doorways.length ? pieces.flatMap((p) => (cuts(p) ? cutAtDoors(p, doorways) : [p])) : pieces;
  measured.forEach((p, i) => (p.id = i));

  // Tags pointing at walls not drawn with the wall pen ("BELOW", curtain walls): measure
  // the line the leader lands on. Several tags on one such wall share it.
  const stillUnmatched: WallTag[] = [];
  const pieceCount = measured.length;
  const lightIndex = new SegmentIndex(allSegments.filter((x) => !x.filled));
  const light: TypedRun[] = [];
  for (const tag of unmatched) {
    let found: WallRun | null = null;
    for (const path of tag.leader ? tag.paths : []) {
      found = lightWall(path, lightIndex, pt(maxThickness), drawn);
      if (found) {
        tag.target = path[path.length - 1];
        break;
      }
    }
    if (!found) {
      if (!tag.generic) stillUnmatched.push(tag);
      continue;
    }
    const same = light.find((r) => sameLine(r, found!));
    if (same) {
      if (!same.tags.includes(tag.code)) same.tags.push(tag.code);
    } else {
      light.push({ ...found, id: pieceCount + light.length, tags: [tag.code], how: 'tag', light: true });
    }
  }
  return { runs: [...measured, ...light], tags, unmatched: stillUnmatched };
}

/**
 * Drops bands a hair off square: CAD walls are drawn square to the building (or at a
 * deliberate angle), so a long "wall" a fraction of a degree off the sheet's main
 * directions is two unrelated lines that happen to run close (a dimension line beside a
 * face, a slanted hairline).
 */
function offSquare(runs: WallRun[]): WallRun[] {
  const angle = (r: WallRun) => {
    const a = Math.atan2(r.b[1] - r.a[1], r.b[0] - r.a[0]);
    return ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  };
  // The main direction: the length-weighted angle (mod 90°) most walls share, to 0.1°.
  const bins = new Map<number, number>();
  for (const r of runs) {
    const k = Math.round((angle(r) * 1800) / Math.PI) % 900;
    bins.set(k, (bins.get(k) ?? 0) + runLength(r));
  }
  let main = 0;
  let most = -1;
  for (const [k, n] of bins) if (n > most) [main, most] = [k, n];
  // Only a sheet drawn square to the page is that exact: a building rotated on the sheet
  // carries rounding in every line.
  if (main !== 0) return runs;
  return runs.filter((r) => {
    const d = Math.min(angle(r), Math.PI / 2 - angle(r));
    return d < 0.005 || d > 0.035;
  });
}

/**
 * Tags the set confirms as wall types show which symbols wall tags use on this sheet. A
 * code only guessed to be a wall type (by its prefix, or any code with a leader) in a
 * different symbol is another kind of tag: a window type in a hexagon, a keynote in a
 * triangle, a room number in a box.
 */
function sameFamily(tags: WallTag[]): WallTag[] {
  const kind = (t: WallTag) => t.symbol!.core ?? t.symbol!.shape;
  const confirmed = tags.filter((t) => t.confirmed && t.symbol);
  const count = new Map<string, number>();
  for (const t of confirmed) count.set(kind(t), (count.get(kind(t)) ?? 0) + 1);
  const all = new Map<string, number>();
  for (const t of tags) if (t.symbol) all.set(kind(t), (all.get(kind(t)) ?? 0) + 1);
  const shapes = new Set([...count].filter(([, n]) => n >= Math.max(1, confirmed.length * 0.1)).map(([s]) => s));
  // A code the set lists as a wall type, in a symbol a family of other codes use and few wall
  // tags do, is another kind of tag sharing its code (window type W3 in a hexagon among window
  // types W1a, W2b, beside wall type W3 in boxes).
  const settled = confirmed.length >= 8;
  const otherFamily = (k: string) => (all.get(k) ?? 0) >= 3 && (count.get(k) ?? 0) < (all.get(k) ?? 0) / 2;
  return tags.filter((t) => {
    if (!t.symbol) return true;
    if (t.confirmed) return !settled || shapes.has(kind(t)) || !otherFamily(kind(t));
    if (t.symbol.shape === 'triangle') return false;
    return !shapes.size || shapes.has(kind(t));
  });
}

/**
 * The small closed ring of walls round a piece (a column wrapped in furring): rays from
 * the piece's middle meet walls on all four sides within `reach`, and the ring they
 * bound is no longer than `maxPerimeter`. Returns the pieces on the ring.
 */
function enclosure(inner: WallRun, pieces: WallRun[], reach: number, maxPerimeter: number): number[] | null {
  const mx = (inner.a[0] + inner.b[0]) / 2;
  const my = (inner.a[1] + inner.b[1]) / 2;
  const hit = (dx: number, dy: number): number | null => {
    let best: number | null = null;
    for (const p of pieces) {
      // A second band on the same line as the inner piece (a column read twice) is not a side.
      if (p === inner || overlapping(inner, p)) continue;
      const pt = crossingRay(mx, my, dx, dy, p);
      if (pt !== null && pt > 0.5 && pt <= reach && (best === null || pt < best)) best = pt;
    }
    return best;
  };
  const [e, w, sth, n] = [hit(1, 0), hit(-1, 0), hit(0, 1), hit(0, -1)];
  if (e === null || w === null || sth === null || n === null) return null;
  const [x0, x1, y0, y1] = [mx - w, mx + e, my - n, my + sth];
  if (2 * (x1 - x0 + (y1 - y0)) > maxPerimeter) return null;
  const tol = 1.5;
  const onEdge = (q: Pt) =>
    q[0] >= x0 - tol && q[0] <= x1 + tol && q[1] >= y0 - tol && q[1] <= y1 + tol &&
    (Math.abs(q[0] - x0) <= tol || Math.abs(q[0] - x1) <= tol || Math.abs(q[1] - y0) <= tol || Math.abs(q[1] - y1) <= tol);
  const ring = pieces.flatMap((p, i) => (p !== inner && onEdge(p.a) && onEdge(p.b) && onSameEdge(p, x0, x1, y0, y1, tol) ? [i] : []));
  return ring.length >= 3 ? ring : null;
}

/** Whether two pieces run parallel and nearly on one line (within 2.5 pt, at most half the first one's thickness). */
function overlapping(r: WallRun, p: WallRun): boolean {
  const L = runLength(r);
  const ux = (r.b[0] - r.a[0]) / L;
  const uy = (r.b[1] - r.a[1]) / L;
  const Lp = runLength(p);
  if (Math.abs(ux * (p.b[1] - p.a[1]) - uy * (p.b[0] - p.a[0])) / Lp > 0.05) return false;
  return Math.abs((p.a[0] - r.a[0]) * -uy + (p.a[1] - r.a[1]) * ux) < Math.min(r.thickness / 2, 2.5);
}

/** Whether both ends of a piece lie on one side of the box (it runs along that side). */
function onSameEdge(p: WallRun, x0: number, x1: number, y0: number, y1: number, tol: number): boolean {
  return [x0, x1].some((x) => Math.abs(p.a[0] - x) <= tol && Math.abs(p.b[0] - x) <= tol) || [y0, y1].some((y) => Math.abs(p.a[1] - y) <= tol && Math.abs(p.b[1] - y) <= tol);
}

/** Distance along a ray from (x, y) in direction (dx, dy) to where it crosses a piece, or null. */
function crossingRay(x: number, y: number, dx: number, dy: number, p: WallRun): number | null {
  const ex = p.b[0] - p.a[0];
  const ey = p.b[1] - p.a[1];
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return null;
  const qx = p.a[0] - x;
  const qy = p.a[1] - y;
  const t = (qx * ey - qy * ex) / den;
  const u = (qx * dy - qy * dx) / den;
  return u >= -0.02 && u <= 1.02 ? t : null;
}

const isPartition = (tags: string[], exterior?: readonly string[], kinds?: Record<string, string>) =>
  tags.some((t) => tagKind(t, exterior, kinds) === 'partition') && !tags.some((t) => tagKind(t, exterior, kinds) === 'exterior');

/** The piece without the door openings along it. */
function cutAtDoors(p: TypedRun, doors: Pt[][]): TypedRun[] {
  const L = runLength(p);
  const ux = (p.b[0] - p.a[0]) / L;
  const uy = (p.b[1] - p.a[1]) / L;
  const gaps: [number, number][] = [];
  for (const q of doors) {
    // The strip runs along its first edge (the bridge across the opening).
    const ex = q[1][0] - q[0][0];
    const ey = q[1][1] - q[0][1];
    const El = Math.hypot(ex, ey);
    if (El < 1 || Math.abs(ux * ey - uy * ex) / El > 0.035) continue;
    const cx = q.reduce((n, v) => n + v[0], 0) / q.length;
    const cy = q.reduce((n, v) => n + v[1], 0) / q.length;
    if (Math.abs((cx - p.a[0]) * -uy + (cy - p.a[1]) * ux) > p.thickness / 2 + 1) continue;
    const t = q.map((v) => (v[0] - p.a[0]) * ux + (v[1] - p.a[1]) * uy);
    const lo = Math.max(0, Math.min(...t));
    const hi = Math.min(L, Math.max(...t));
    if (hi > lo) gaps.push([lo, hi]);
  }
  if (!gaps.length) return [p];
  gaps.sort((m, n) => m[0] - n[0]);
  const out: TypedRun[] = [];
  let from = 0;
  const at = (t: number): Pt => [p.a[0] + ux * t, p.a[1] + uy * t];
  for (const [lo, hi] of [...gaps, [L, L] as [number, number]]) {
    if (lo - from > 1) out.push({ ...p, a: at(from), b: at(lo) });
    from = Math.max(from, hi);
  }
  return out;
}

/**
 * Whether piece p runs alongside q for most of its length, their faces touching or
 * overlapping (two leaves of one built-up wall).
 */
function alongside(p: WallRun, q: WallRun): boolean {
  const L = runLength(p);
  const Lq = runLength(q);
  if (L < 1 || Lq < 1) return false;
  const ux = (p.b[0] - p.a[0]) / L;
  const uy = (p.b[1] - p.a[1]) / L;
  if (Math.abs(ux * (q.b[1] - q.a[1]) - uy * (q.b[0] - q.a[0])) / Lq > 0.035) return false;
  const sep = Math.abs((q.a[0] + q.b[0] - p.a[0] - p.b[0]) / 2 * -uy + ((q.a[1] + q.b[1] - p.a[1] - p.b[1]) / 2) * ux);
  if (sep < 0.5 || sep > (p.thickness + q.thickness) / 2 + 1.5) return false;
  const t1 = (q.a[0] - p.a[0]) * ux + (q.a[1] - p.a[1]) * uy;
  const t2 = (q.b[0] - p.a[0]) * ux + (q.b[1] - p.a[1]) * uy;
  return Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)) > 0.5 * L;
}

/** Two runs along the same line that overlap. */
function sameLine(r: WallRun, q: WallRun): boolean {
  const L = runLength(r);
  const ux = (r.b[0] - r.a[0]) / L;
  const uy = (r.b[1] - r.a[1]) / L;
  const Lq = runLength(q);
  if (Math.abs(ux * (q.b[1] - q.a[1]) - uy * (q.b[0] - q.a[0])) / Lq > 0.0175) return false;
  if (Math.abs((q.a[0] - r.a[0]) * -uy + (q.a[1] - r.a[1]) * ux) > 1) return false;
  const t1 = (q.a[0] - r.a[0]) * ux + (q.a[1] - r.a[1]) * uy;
  const t2 = (q.b[0] - r.a[0]) * ux + (q.b[1] - r.a[1]) * uy;
  return Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)) > 0.5 * Math.min(L, Lq);
}

/** Where two wall centrelines cross, away from both walls' ends. */
function crossing(r: WallRun, q: WallRun): Pt | null {
  const L1 = runLength(r);
  const L2 = runLength(q);
  const ux = (r.b[0] - r.a[0]) / L1;
  const uy = (r.b[1] - r.a[1]) / L1;
  const vx = (q.b[0] - q.a[0]) / L2;
  const vy = (q.b[1] - q.a[1]) / L2;
  const den = ux * vy - uy * vx;
  if (Math.abs(den) < 0.34) return null;
  const qx = q.a[0] - r.a[0];
  const qy = q.a[1] - r.a[1];
  const t = (qx * vy - qy * vx) / den;
  const s = (qx * uy - qy * ux) / den;
  const m1 = q.thickness / 2 + 1;
  const m2 = r.thickness / 2 + 1;
  if (t < m1 || t > L1 - m1 || s < m2 || s > L2 - m2) return null;
  return [r.a[0] + ux * t, r.a[1] + uy * t];
}

/** A priority queue: the least key first, of equal keys the first pushed. */
class Queue<T> {
  private heap: { key: number; seq: number; v: T }[] = [];
  private seq = 0;
  get size() {
    return this.heap.length;
  }
  private less(i: number, j: number) {
    const [a, b] = [this.heap[i], this.heap[j]];
    return a.key < b.key || (a.key === b.key && a.seq < b.seq);
  }
  private swap(i: number, j: number) {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }
  push(v: T, key: number) {
    this.heap.push({ key, seq: this.seq++, v });
    for (let i = this.heap.length - 1; i > 0; ) {
      const up = (i - 1) >> 1;
      if (!this.less(i, up)) break;
      this.swap(i, up);
      i = up;
    }
  }
  pop(): T {
    const top = this.heap[0].v;
    const last = this.heap.pop()!;
    if (this.heap.length) {
      this.heap[0] = last;
      for (let i = 0; ; ) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < this.heap.length && this.less(l, m)) m = l;
        if (r < this.heap.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/** The runs' boxes grown by `grow`, indexed (for `nearRuns`). */
function runBoxes(runs: WallRun[], grow: number): SegmentIndex {
  return new SegmentIndex(
    runs.map((r) => ({ x1: Math.min(r.a[0], r.b[0]) - grow, y1: Math.min(r.a[1], r.b[1]) - grow, x2: Math.max(r.a[0], r.b[0]) + grow, y2: Math.max(r.a[1], r.b[1]) + grow, width: 0, filled: false })),
    32,
  );
}

/** The runs' two ends, indexed (entries 2i and 2i + 1: run i's ends a and b). */
function endBoxes(runs: WallRun[]): SegmentIndex {
  return new SegmentIndex(
    runs.flatMap((r) => [r.a, r.b].map((p) => ({ x1: p[0], y1: p[1], x2: p[0], y2: p[1], width: 0, filled: false }))),
    32,
  );
}

/** Runs (ascending) whose indexed entries may lie within `reach` of the box from p to q; `per` entries per run. */
function nearRuns(index: SegmentIndex, p: Pt, q: Pt, reach: number, per = 1): number[] {
  const hits = index.query(Math.min(p[0], q[0]) - reach, Math.min(p[1], q[1]) - reach, Math.max(p[0], q[0]) + reach, Math.max(p[1], q[1]) + reach);
  const out = per === 1 ? hits : [...new Set(hits.map((i) => Math.floor(i / per)))];
  return out.sort((m, n) => m - n);
}

/** Distance across a wall to its centreline, from a point alongside it (Infinity past its ends). */
function distInBand(p: Pt, r: WallRun): number {
  const L = runLength(r);
  const ux = (r.b[0] - r.a[0]) / L;
  const uy = (r.b[1] - r.a[1]) / L;
  const t = (p[0] - r.a[0]) * ux + (p[1] - r.a[1]) * uy;
  return t < -1 || t > L + 1 ? Infinity : Math.abs((p[0] - r.a[0]) * -uy + (p[1] - r.a[1]) * ux);
}

function distToRun(p: Pt, r: WallRun): number {
  const wx = r.b[0] - r.a[0];
  const wy = r.b[1] - r.a[1];
  const L2 = wx * wx + wy * wy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - r.a[0]) * wx + (p[1] - r.a[1]) * wy) / L2)) : 0;
  return Math.hypot(p[0] - r.a[0] - wx * t, p[1] - r.a[1] - wy * t);
}

/** Total centreline length per wall type, in metres. */
export function lengthsByType(runs: TypedRun[], metersPerPoint: number): Map<string, { length: number; runs: number }> {
  const out = new Map<string, { length: number; runs: number }>();
  for (const r of runs) {
    const L = runLength(r) * metersPerPoint;
    for (const t of r.tags.length ? r.tags : ['(untagged)']) {
      const e = out.get(t) ?? { length: 0, runs: 0 };
      e.length += L;
      e.runs++;
      out.set(t, e);
    }
  }
  return out;
}
