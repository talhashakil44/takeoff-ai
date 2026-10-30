import type { Pt } from '../model';
import type { DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import type { RoofViewportRegistration } from './roofRegistration';
import type { StructuralSection } from './structural';
/** Join only touching source ink, never bridge a missing bearing outline. */
export function joinCollinearRoofStrokes(
  lines: DrawingLines[string],
): DrawingLines[string] {
  const groups = new Map<string, DrawingLines[string]>(),
    other: DrawingLines[string] = [];
  for (const l of lines) {
    const vertical = Math.abs(l.x1 - l.x2) < 0.05,
      horizontal = Math.abs(l.y1 - l.y2) < 0.05;
    if (l.filled || l.curve || (!vertical && !horizontal)) {
      other.push(l);
      continue;
    }
    const k = [
      vertical ? 'v' : 'h',
      (vertical ? l.x1 : l.y1).toFixed(2),
      l.color ?? '',
      l.width ?? '',
    ].join('|');
    const a = groups.get(k) ?? [];
    a.push(l);
    groups.set(k, a);
  }
  for (const group of groups.values()) {
    const vertical = Math.abs(group[0].x1 - group[0].x2) < 0.05;
    const start = (l: (typeof group)[number]) =>
        vertical ? Math.min(l.y1, l.y2) : Math.min(l.x1, l.x2),
      end = (l: (typeof group)[number]) =>
        vertical ? Math.max(l.y1, l.y2) : Math.max(l.x1, l.x2);
    const sorted = group.sort((a, b) => start(a) - start(b));
    let current = { ...sorted[0] },
      lo = start(current),
      hi = end(current);
    const emit = () =>
      other.push(
        vertical
          ? { ...current, y1: lo, y2: hi }
          : { ...current, x1: lo, x2: hi },
      );
    for (const l of sorted.slice(1)) {
      if (start(l) <= hi + 0.05) {
        hi = Math.max(hi, end(l));
      } else {
        emit();
        current = { ...l };
        lo = start(l);
        hi = end(l);
      }
    }
    emit();
  }
  return other;
}
const supportCache = new WeakMap<object, Map<string, Pt[]>>();
/** Recover member bearing centres from closed, scheduled column rectangles.
 * A takeoff line can be a fragment; its endpoints are not automatically bearings.
 * Every recovered bay must contain the matching beam mark. */
export function recoverRoofBeamSpan(
  points: Pt[],
  code: string,
  r: RoofViewportRegistration,
  ts: DrawingTexts[string],
  ls: DrawingLines[string],
  columns: StructuralSection[],
): Pt[] | null {
  if (points.length !== 2) return null;
  const horizontal = Math.abs(points[1][1] - points[0][1]) < 0.3,
    vertical = Math.abs(points[1][0] - points[0][0]) < 0.3;
  if (!horizontal && !vertical) return null;
  const axis = horizontal ? 0 : 1,
    cross = 1 - axis,
    scale = r.metersPerPoint;
  const cacheKey = JSON.stringify([
    r.bounds,
    scale,
    columns,
    ts.filter((t) => /^C\d+$/.test(t.str.trim())),
  ]);
  let cache = supportCache.get(ls);
  if (!cache) {
    cache = new Map();
    supportCache.set(ls, cache);
  }
  let supports = cache.get(cacheKey);
  if (!supports) {
    const edges = [...ls, ...joinCollinearRoofStrokes(ls)].filter(
      (l) => !l.filled && !l.curve,
    );
    const key = (x1: number, y1: number, x2: number, y2: number) =>
      [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
        .map((v) => v.toFixed(1))
        .join(',');
    const edgeSet = new Set(edges.map((l) => key(l.x1, l.y1, l.x2, l.y2)));
    const horizontals = new Map<string, typeof ls>();
    const xkey = (x1: number, x2: number) =>
      [Math.min(x1, x2), Math.max(x1, x2)].map((v) => v.toFixed(1)).join(',');
    for (const l of edges.filter((l) => Math.abs(l.y1 - l.y2) < 0.05)) {
      const k = xkey(l.x1, l.x2),
        a = horizontals.get(k) ?? [];
      a.push(l);
      horizontals.set(k, a);
    }
    const groups: (typeof ls)[] = [];
    for (const l of edges) {
      if (Math.abs(l.y1 - l.y2) > 0.05) continue;
      const w = Math.abs(l.x2 - l.x1) * scale;
      for (const sec of columns) {
        for (const [width, depth] of [
          [sec.width, sec.depth],
          [sec.depth, sec.width],
        ]) {
          if (Math.abs(w - width) > 0.008) continue;
          const x0 = Math.min(l.x1, l.x2),
            x1 = Math.max(l.x1, l.x2),
            y0 = l.y1;
          // PDF coordinate quantisation requires locating the opposite drawn edge.
          for (const b of (horizontals.get(xkey(x0, x1)) ?? []).filter(
            (b) => Math.abs((b.y1 - y0) * scale - depth) < 0.008,
          )) {
            const y1 = b.y1;
            if (
              [x0, x1].every(
                (x) =>
                  edgeSet.has(key(x, y0, x, y1)) ||
                  edges.some(
                    (l) =>
                      Math.abs(l.x1 - l.x2) < 0.05 &&
                      Math.abs(l.x1 - x) < 0.05 &&
                      Math.min(l.y1, l.y2) <= y0 + 0.05 &&
                      Math.max(l.y1, l.y2) >= y1 - 0.05,
                  ),
              )
            )
              groups.push([
                l,
                b,
                { ...l, x1: x0, x2: x0, y1: y0, y2: y1 },
                { ...l, x1: x1, x2: x1, y1: y0, y2: y1 },
              ]);
          }
        }
      }
    }
    supports = [];
    for (const group of groups) {
      if (
        group.length !== 4 ||
        group.some(
          (l) => Math.abs(l.x1 - l.x2) > 0.05 && Math.abs(l.y1 - l.y2) > 0.05,
        )
      )
        continue;
      const xs = group.flatMap((l) => [l.x1, l.x2]),
        ys = group.flatMap((l) => [l.y1, l.y2]);
      const x0 = Math.min(...xs),
        x1 = Math.max(...xs),
        y0 = Math.min(...ys),
        y1 = Math.max(...ys);
      const w = (x1 - x0) * scale,
        d = (y1 - y0) * scale,
        c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
      if (
        !columns.some(
          (s) =>
            !s.conflict &&
            ((Math.abs(w - s.width) < 0.008 && Math.abs(d - s.depth) < 0.008) ||
              (Math.abs(w - s.depth) < 0.008 && Math.abs(d - s.width) < 0.008)),
        )
      )
        continue;
      if (
        c[0] < r.bounds[0] ||
        c[0] > r.bounds[2] ||
        c[1] < r.bounds[1] ||
        c[1] > r.bounds[3]
      )
        continue;
      if (
        !ts.some(
          (t) =>
            columns.some((s) => s.code === t.str.trim()) &&
            Math.hypot(t.cx - c[0], t.cy - c[1]) < 30,
        )
      )
        continue;
      if (!supports.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 0.3))
        supports.push(c);
    }
    cache.set(cacheKey, supports);
  }
  const near = supports.filter(
    (p) =>
      Math.abs(p[cross] - (points[0][cross] + points[1][cross]) / 2) * scale <
      0.25,
  );
  const ends = points.map(
    (p) =>
      near
        .filter((c) => Math.abs(c[axis] - p[axis]) * scale < 1.5)
        .sort(
          (a, b) => Math.abs(a[axis] - p[axis]) - Math.abs(b[axis] - p[axis]),
        )[0],
  );
  if (!ends[0] || !ends[1] || ends[0] === ends[1]) return null;
  const ordered = near
    .filter(
      (p) =>
        p[axis] >= Math.min(ends[0][axis], ends[1][axis]) - 0.1 &&
        p[axis] <= Math.max(ends[0][axis], ends[1][axis]) + 0.1,
    )
    .sort((a, b) => a[axis] - b[axis]);
  for (let i = 1; i < ordered.length; i++)
    if (
      !ts.some(
        (t) =>
          t.str.trim() === code &&
          (axis === 0 ? t.cx : t.cy) > ordered[i - 1][axis] + 3 &&
          (axis === 0 ? t.cx : t.cy) < ordered[i][axis] - 3 &&
          Math.abs((cross === 0 ? t.cx : t.cy) - ordered[i][cross]) * scale <
            0.9,
      )
    )
      return null;
  return ordered;
}
