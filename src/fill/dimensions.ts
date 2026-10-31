import type { Segment } from './vectors';

/**
 * Dimension lines: a line crossed near each end by a tick (a short slash at 45°, the architect's
 * mark at the extension line), often one piece of a chain. They bound nothing: a room filled to
 * them stops in the middle of a lobby. `tick` is the longest a tick runs, in sheet points.
 */
export function dimensionLines(segs: Segment[], tick: number): Set<Segment> {
  const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const marks = segs.filter((s) => !s.curve && !s.filled && len(s) > tick * 0.25 && len(s) <= tick);
  const cell = tick * 2;
  const grid = new Map<string, Segment[]>();
  for (const m of marks) {
    const k = `${Math.floor((m.x1 + m.x2) / 2 / cell)},${Math.floor((m.y1 + m.y2) / 2 / cell)}`;
    const list = grid.get(k);
    if (list) list.push(m);
    else grid.set(k, [m]);
  }
  const near = (x: number, y: number) => {
    const out: Segment[] = [];
    const [gx, gy] = [Math.floor(x / cell), Math.floor(y / cell)];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const m of grid.get(`${gx + i},${gy + j}`) ?? []) out.push(m);
    return out;
  };
  /** Where along s (0 at its start, in points) a slash crosses it, and from which side when it only touches it; or null. */
  const crossAt = (s: Segment, m: Segment, L: number): { at: number; side: number } | null => {
    const [ux, uy] = [(s.x2 - s.x1) / L, (s.y2 - s.y1) / L];
    const side = (x: number, y: number) => (x - s.x1) * uy - (y - s.y1) * ux;
    const a = side(m.x1, m.y1);
    const b = side(m.x2, m.y2);
    // A slash at 30–60° to the line: across it, its middle on it, or half of one drawn out from it.
    const ml = len(m);
    const cos = Math.abs(((m.x2 - m.x1) * ux + (m.y2 - m.y1) * uy) / ml);
    if (cos < 0.5 || cos > 0.866) return null;
    const touch = Math.min(Math.abs(a), Math.abs(b)) < 0.3;
    if (!touch && (a * b >= 0 || Math.abs(a + b) / 2 > ml * 0.15)) return null;
    const t = Math.abs(a) < 0.3 ? 0 : Math.abs(b) < 0.3 ? 1 : a / (a - b);
    const x = m.x1 + (m.x2 - m.x1) * t;
    const y = m.y1 + (m.y2 - m.y1) * t;
    const from = touch ? Math.sign(Math.abs(a) < 0.3 ? b : a) : 0;
    return { at: (x - s.x1) * ux + (y - s.y1) * uy, side: from };
  };
  const out = new Set<Segment>();
  for (const s of segs) {
    const L = len(s);
    if (s.curve || s.filled || L <= tick * 3) continue;
    const reach = tick * 1.5;
    let start = false;
    let end = false;
    for (const [x, y, isStart] of [
      [s.x1, s.y1, true],
      [s.x2, s.y2, false],
    ] as const) {
      // Ticks within reach of this end.
      const ux = (s.x2 - s.x1) / L;
      const uy = (s.y2 - s.y1) / L;
      // A tick crosses the line; one drawn as two halves out from it has a half on each side at one
      // point. (Hatching only meets a wall's face from one side.)
      const halves: { at: number; side: number }[] = [];
      const seen = new Set<Segment>();
      for (const p of [0, 0.5, 1]) {
        const d = isStart ? reach * p : -reach * p;
        for (const m of near(x + ux * d, y + uy * d)) {
          if (m === s || seen.has(m)) continue;
          seen.add(m);
          const c = crossAt(s, m, L);
          if (c === null || !(isStart ? c.at >= -1 && c.at <= reach : c.at <= L + 1 && c.at >= L - reach)) continue;
          if (c.side === 0 || halves.some((h) => h.side === -c.side && Math.abs(h.at - c.at) < 0.6)) {
            if (isStart) start = true;
            else end = true;
          } else halves.push(c);
        }
        if (isStart ? start : end) break;
      }
    }
    if (start && end) out.add(s);
  }
  return out;
}

/**
 * Grid lines: the lines run out from a grid bubble (a small circle at the edge of the plan, 1, 2,
 * A, B), dash by dash across the plan, in the bubble's line's pen. They bound nothing either.
 */
export function gridLines(segs: Segment[], face?: { min: number; max: number }): Set<Segment> {
  const out = new Set<Segment>();
  // Circles: curved shapes about as wide as high, 4–30 points across.
  const subs = new Map<number, Segment[]>();
  // (Curves, or circles flattened into a ring of short lines.)
  for (const s of segs) if (!s.filled && s.sub !== undefined) (subs.get(s.sub) ?? subs.set(s.sub, []).get(s.sub)!).push(s);
  const circles: { x: number; y: number; r: number }[] = [];
  for (const list of subs.values()) {
    if (list.length < 8 && !list.every((s) => s.curve)) continue;
    const xs = list.flatMap((s) => [s.x1, s.x2]);
    const ys = list.flatMap((s) => [s.y1, s.y2]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w < 8 || w > 60 || Math.abs(w - h) > w * 0.12) continue;
    const [x, y, r] = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, (w + h) / 4];
    // Round all the way: every point on the circle.
    if (list.every((s) => Math.abs(Math.hypot(s.x1 - x, s.y1 - y) - r) < r * 0.12)) circles.push({ x, y, r });
  }
  if (!circles.length) return out;
  const straight = segs.filter((s) => !s.curve && !s.filled);
  const cell = 40;
  const index = new Map<string, Segment[]>();
  for (const s of straight)
    for (const [x, y] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ] as const) {
      const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      (index.get(k) ?? index.set(k, []).get(k)!).push(s);
    }
  const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  for (const c of circles) {
    const near: Segment[] = [];
    const [gx, gy] = [Math.floor(c.x / cell), Math.floor(c.y / cell)];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) near.push(...(index.get(`${gx + i},${gy + j}`) ?? []));
    for (const s of near) {
      const L = len(s);
      if (L < 2) continue;
      const [ux, uy] = [(s.x2 - s.x1) / L, (s.y2 - s.y1) / L];
      // A line pointing at the bubble's centre, starting at its rim.
      if (Math.abs((c.x - s.x1) * uy - (c.y - s.y1) * ux) > 0.6) continue;
      const d1 = Math.hypot(s.x1 - c.x, s.y1 - c.y);
      const d2 = Math.hypot(s.x2 - c.x, s.y2 - c.y);
      const nearEnd = Math.min(d1, d2);
      if (nearEnd < c.r * 0.85 || nearEnd > c.r * 1.6) continue;
      // Out from the bubble: every piece on that line, in that pen, on the far side of the rim.
      const [ox, oy] = d1 < d2 ? [ux, uy] : [-ux, -uy];
      for (const t of straight) {
        if (Math.abs(t.width - s.width) > 0.05) continue;
        const Lt = len(t);
        if (Lt < 0.5 || Math.abs(((t.x2 - t.x1) * oy - (t.y2 - t.y1) * ox) / Lt) > 0.01) continue;
        if (Math.abs((t.x1 - c.x) * oy - (t.y1 - c.y) * ox) > 0.6) continue;
        if ((t.x1 - c.x) * ox + (t.y1 - c.y) * oy < c.r * 0.8) continue;
        out.add(t);
      }
    }
  }
  if (!face || !out.size) return out;
  // A wall drawn on its grid line: a piece with another line beside it a wall's thickness away is
  // the wall's face, not the grid's (kept).
  const lines = segs.filter((s) => !s.curve && !s.filled && !out.has(s));
  const near = new Map<string, Segment[]>();
  const fcell = Math.max(8, face.max);
  for (const l of lines) {
    const k = `${Math.floor((l.x1 + l.x2) / 2 / fcell)},${Math.floor((l.y1 + l.y2) / 2 / fcell)}`;
    (near.get(k) ?? near.set(k, []).get(k)!).push(l);
  }
  for (const g of [...out]) {
    const L = len(g);
    const [ux, uy] = [(g.x2 - g.x1) / L, (g.y2 - g.y1) / L];
    const [mx, my] = [(g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2];
    const reach = Math.ceil((L / 2 + face.max) / fcell) + 1;
    const [gx, gy] = [Math.floor(mx / fcell), Math.floor(my / fcell)];
    let paired = false;
    for (let i = -reach; i <= reach && !paired; i++)
      for (let j = -reach; j <= reach && !paired; j++)
        for (const l of near.get(`${gx + i},${gy + j}`) ?? []) {
          const ll = len(l);
          if (ll < Math.min(L, face.max) * 0.5 || Math.abs(((l.x2 - l.x1) * uy - (l.y2 - l.y1) * ux) / ll) > 0.02) continue;
          const off = Math.abs((l.x1 - g.x1) * -uy + (l.y1 - g.y1) * ux);
          if (off < face.min || off > face.max) continue;
          const t1 = (l.x1 - g.x1) * ux + (l.y1 - g.y1) * uy;
          const t2 = (l.x2 - g.x1) * ux + (l.y2 - g.y1) * uy;
          if (Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)) >= L * 0.5) paired = true;
        }
    if (paired) out.delete(g);
  }
  return out;
}
