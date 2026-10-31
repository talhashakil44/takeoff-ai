import type { Segment } from '../fill/vectors';
import type { Pt } from '../model';
import type { WallTag } from '../walls/tags';

/** A strip footing found from its own tag: its centreline and drawn width, in sheet points. */
export interface TaggedStrip {
  code: string;
  line: [Pt, Pt];
  width: number;
  /** Where the tag is. */
  tag: Pt;
}

/** A straight dashed line: the dashes along one line, gaps no longer than a few dashes. */
interface Dashed {
  pen: number;
  /** Offset across the line (along the arrow), and the extent along it. */
  v: number;
  u0: number;
  u1: number;
}

const DASH = 15; // the longest piece of a dashed line, points

/**
 * Strip footings tagged on their own (Kelso S1.0: SF-1 and SF-N under the core's masonry walls,
 * no foundation wall tag beside them). The tag's arrow lands on the footing's near edge, drawn
 * dashed (it is under the slab); its far edge is the dashed line parallel to it the footing's
 * width away (`width` from the schedule, or the nearest beyond 0.3 m when the schedule gives
 * none). The footing runs along the two edges, from the middle of their ends.
 */
export function stripsFromTags(tags: WallTag[], segs: Segment[], metersPerPoint: number, width: (code: string) => number | undefined): TaggedStrip[] {
  const dashes = segs.filter((s) => !s.filled && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.5 && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) <= DASH);
  const out: TaggedStrip[] = [];
  for (const t of tags) {
    if (!t.leader || !t.paths.length) continue;
    const [from, tip] = t.paths[0];
    const L = Math.hypot(tip[0] - from[0], tip[1] - from[1]);
    if (L < 2) continue;
    // Across the footing (the arrow's way) and along it.
    const d: Pt = [(tip[0] - from[0]) / L, (tip[1] - from[1]) / L];
    const a: Pt = [-d[1], d[0]];
    const along = dashes.filter((s) => {
      const n = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      return Math.abs(((s.x2 - s.x1) * d[0] + (s.y2 - s.y1) * d[1]) / n) < 0.05;
    });
    const uv = (x: number, y: number): Pt => [x * a[0] + y * a[1], x * d[0] + y * d[1]];
    const [tu, tv] = uv(tip[0], tip[1]);
    const lineAt = (pen: number, v: number, u: number): Dashed | null => {
      const on = along
        .filter((s) => s.width === pen)
        .map((s) => {
          const [p0, q0] = uv(s.x1, s.y1);
          const [p1, q1] = uv(s.x2, s.y2);
          return { u0: Math.min(p0, p1), u1: Math.max(p0, p1), v: (q0 + q1) / 2 };
        })
        .filter((s) => Math.abs(s.v - v) < 0.6)
        .sort((x, y) => x.u0 - y.u0);
      if (on.length < 3) return null;
      // The run of dashes through u: gaps no longer than three dashes' worth.
      const gap = Math.max(6, 3 * median(on.map((s) => s.u1 - s.u0)));
      let start = on.findIndex((s) => s.u1 >= u - gap);
      if (start < 0 || on[start].u0 > u + gap) return null;
      let [u0, u1] = [on[start].u0, on[start].u1];
      for (let i = start + 1; i < on.length && on[i].u0 <= u1 + gap; i++) u1 = Math.max(u1, on[i].u1);
      for (let i = start - 1; i >= 0; i--) {
        if (on[i].u1 < u0 - gap) break;
        u0 = Math.min(u0, on[i].u0);
        start = i;
      }
      return u0 <= u + gap && u1 >= u - gap && u1 - u0 > 1.5 * gap ? { pen, v, u0, u1 } : null;
    };
    // The near edge: the dashed line the arrow ends on.
    let near: Dashed | null = null;
    for (const s of along) {
      const [p0, q0] = uv(s.x1, s.y1);
      const v = (q0 + uv(s.x2, s.y2)[1]) / 2;
      if (Math.abs(v - tv) > 1.5 || Math.abs(p0 - tu) > 40) continue;
      const line = lineAt(s.width, v, tu);
      if (line && (!near || Math.abs(line.v - tv) < Math.abs(near.v - tv))) near = line;
    }
    if (!near) continue;
    // The far edge: parallel, beyond, overlapping it.
    const w = width(t.code);
    const want = w ? w / metersPerPoint : null;
    const lo = want ? want * 0.75 : 0.3 / metersPerPoint;
    const hi = want ? want * 1.25 : 1.5 / metersPerPoint;
    const vs = new Set<number>();
    for (const s of along) {
      if (s.width !== near.pen) continue;
      const v = (uv(s.x1, s.y1)[1] + uv(s.x2, s.y2)[1]) / 2;
      const off = v - near.v;
      if (off >= lo && off <= hi) vs.add(Math.round(v * 2) / 2);
    }
    let far: Dashed | null = null;
    for (const v of [...vs].sort((x, y) => (want ? Math.abs(x - near!.v - want) - Math.abs(y - near!.v - want) : x - y))) {
      const line = lineAt(near.pen, v, (Math.max(near.u0, tu - 40) + Math.min(near.u1, tu + 40)) / 2);
      if (line && Math.min(line.u1, near.u1) - Math.max(line.u0, near.u0) > 0.5 * (near.u1 - near.u0)) {
        far = line;
        break;
      }
    }
    if (!far) continue;
    const v = (near.v + far.v) / 2;
    const u0 = (near.u0 + far.u0) / 2;
    const u1 = (near.u1 + far.u1) / 2;
    if ((u1 - u0) * metersPerPoint < 0.5) continue;
    const xy = (u: number): Pt => [u * a[0] + v * d[0], u * a[1] + v * d[1]];
    const line: [Pt, Pt] = [xy(u0), xy(u1)];
    // Two tags on one footing: one footing.
    const at = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 3;
    if (out.some((o) => o.code === t.code && ((at(o.line[0], line[0]) && at(o.line[1], line[1])) || (at(o.line[0], line[1]) && at(o.line[1], line[0]))))) continue;
    out.push({ code: t.code, line, width: Math.abs(far.v - near.v), tag: [t.cx, t.cy] });
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}
