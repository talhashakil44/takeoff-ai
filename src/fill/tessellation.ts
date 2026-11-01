import type { Segment } from './vectors';

/**
 * Fills cut into triangles: some PDF writers (a flattened Bluebeam set, a print driver) draw every
 * filled shape as a mesh of triangles, so a wall's poché is a strip of triangles whose diagonal
 * edges pair like nothing. Triangles that share an edge are joined back into one shape, drawn by
 * its outline (the edges only one triangle has). Pages without such meshes are left as they are.
 */
export function mergeTessellated(segs: Segment[], minTriangles = 2000): Segment[] {
  const subs = new Map<number, Segment[]>();
  for (const s of segs) if (s.filled && s.sub !== undefined) (subs.get(s.sub) ?? subs.set(s.sub, []).get(s.sub)!).push(s);
  // A shape's closing edge, when the path closes without drawing it.
  for (const [sub, list] of subs) {
    const [f, l] = [list[0]!, list[list.length - 1]!];
    if (list.length >= 2 && Math.hypot(f.x1 - l.x2, f.y1 - l.y2) > 1e-3) list.push({ ...l, x1: l.x2, y1: l.y2, x2: f.x1, y2: f.y1, sub });
  }
  const triangles = [...subs].filter(([, list]) => list.length >= 3 && list.length <= 4);
  if (triangles.length < minTriangles) return segs;
  const key = (x: number, y: number) => `${Math.round(x * 20)},${Math.round(y * 20)}`;
  const edgeKey = (s: Segment) => {
    const a = key(s.x1, s.y1);
    const b = key(s.x2, s.y2);
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  // Shapes sharing an edge are one shape.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const owner = new Map<string, number>();
  for (const [sub, list] of triangles) {
    parent.set(sub, sub);
    for (const s of list) {
      if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 1e-3) continue;
      const k = edgeKey(s);
      const o = owner.get(k);
      if (o === undefined) owner.set(k, sub);
      else {
        const [ra, rb] = [find(o), find(sub)];
        if (ra !== rb) parent.set(ra, rb);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (const [sub] of triangles) {
    const r = find(sub);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(sub);
  }
  const merged = new Set<number>();
  const out: Segment[] = [];
  let next = 1e7;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const count = new Map<string, { s: Segment; n: number }>();
    for (const m of members) {
      merged.add(m);
      for (const s of subs.get(m)!) {
        if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 1e-3) continue;
        const k = edgeKey(s);
        const c = count.get(k);
        if (c) c.n++;
        else count.set(k, { s, n: 1 });
      }
    }
    const id = next++;
    for (const { s, n } of count.values()) if (n === 1) out.push({ ...s, sub: id });
  }
  return merged.size ? [...segs.filter((s) => !(s.filled && s.sub !== undefined && merged.has(s.sub))), ...out] : segs;
}
