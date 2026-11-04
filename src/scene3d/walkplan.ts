import type { Element3D, Pt2, Pt3, Scene3D, Shape3D } from './scene';

/**
 * Plans a walk through a Scene3D from its data alone: the floor levels, the main entrance, the
 * open rooms on each level and the routes between them. The model view uses it to stand you at
 * the front door (Walk) and to fly you round the building (Tour). Model metres, Z up.
 */

export interface Level {
  /** Top of the floor (m). */
  z: number;
  name: string;
}

/** A prism: a plan outline from z0 to z1. Every shape is reduced to these for planning. */
interface Solid {
  poly: Pt2[];
  z0: number;
  z1: number;
}

const ring = (c: Pt2, r: number, n = 12): Pt2[] => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
const strip = (p: Pt2, q: Pt2, width: number, off = 0): Pt2[] => {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1e-9;
  const [nx, ny] = [-(q[1] - p[1]) / L, (q[0] - p[0]) / L];
  const [a, b] = [off + width / 2, off - width / 2];
  return [[p[0] + nx * b, p[1] + ny * b], [q[0] + nx * b, q[1] + ny * b], [q[0] + nx * a, q[1] + ny * a], [p[0] + nx * a, p[1] + ny * a]];
};

/** A shape as prisms (a wall comes apart at its openings, as it is drawn). */
export function solidsOf(s: Shape3D): Solid[] {
  switch (s.type) {
    case 'box':
      return [{ poly: [[s.min[0], s.min[1]], [s.max[0], s.min[1]], [s.max[0], s.max[1]], [s.min[0], s.max[1]]], z0: Math.min(s.min[2], s.max[2]), z1: Math.max(s.min[2], s.max[2]) }];
    case 'wall': {
      const L = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]);
      if (L < 1e-6) return [];
      const at = (t: number): Pt2 => [s.from[0] + ((s.to[0] - s.from[0]) * t) / L, s.from[1] + ((s.to[1] - s.from[1]) * t) / L];
      const pieces: [number, number, number, number][] = [];
      let pos = 0;
      for (const o of [...(s.openings ?? [])].filter((o) => o.end > o.start).sort((x, y) => x.start - y.start)) {
        const [a, b] = [Math.max(0, o.start), Math.min(L, o.end)];
        if (a > pos) pieces.push([pos, a, s.z0, s.z1]);
        if (o.sill > s.z0) pieces.push([a, b, s.z0, Math.min(o.sill, s.z1)]);
        if (o.head < s.z1) pieces.push([a, b, Math.max(o.head, s.z0), s.z1]);
        pos = Math.max(pos, b);
      }
      if (pos < L) pieces.push([pos, L, s.z0, s.z1]);
      return pieces.filter(([a, b, z0, z1]) => b - a > 1e-4 && z1 - z0 > 1e-4).map(([a, b, z0, z1]) => ({ poly: strip(at(a), at(b), s.thickness, s.offset ?? 0), z0, z1 }));
    }
    case 'slab': {
      const tops = s.polygon.map(([x, y]) => s.z1 + (s.slope?.dzdx ?? 0) * x + (s.slope?.dzdy ?? 0) * y);
      return [{ poly: s.polygon, z0: Math.min(...tops) - (s.z1 - s.z0), z1: Math.max(...tops) }];
    }
    case 'cylinder':
    case 'cone':
      return [{ poly: ring(s.at, s.radius), z0: Math.min(s.z0, s.z1), z1: Math.max(s.z0, s.z1) }];
    case 'tube':
      return [{ poly: strip([s.from[0], s.from[1]], [s.to[0], s.to[1]], s.radius * 2), z0: Math.min(s.from[2], s.to[2]) - s.radius, z1: Math.max(s.from[2], s.to[2]) + s.radius }];
    case 'sphere':
      return [{ poly: ring([s.at[0], s.at[1]], s.radius), z0: s.at[2] - s.radius, z1: s.at[2] + s.radius }];
  }
}

const inPoly = (p: Pt2, poly: Pt2[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
const segDist = (p: Pt2, a: Pt2, b: Pt2) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1e-12)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
/** How far a point is from an outline (0 inside). */
const polyDist = (p: Pt2, poly: Pt2[]) => (inPoly(p, poly) ? 0 : Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length]))));
const area = (p: Pt2[]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2);

/** What stops you walking: everything but doors, floors, ceilings and the ground itself. */
export const PASSABLE = new Set(['doors', 'floor', 'ceiling', 'site', 'paving', 'electrical']);
/** What you notice in a room. */
const NOTABLE = new Set(['fixtures', 'furniture', 'mechanical', 'doors', 'stairs', 'glazing', 'plumbing', 'electrical']);
/** Parts of a thing rather than the thing. */
const PART = /joint|frame\b|glass$|hardware|seam|marking|line\b|closer|trim|bracket|hanger|support|stringer/i;

/** A short name for an element: no notes in brackets. */
export const shortName = (name: string) => name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------- levels

/** The floor levels, from the tops of the floor slabs (lowest first). */
export function floorLevels(scene: Scene3D): Level[] {
  const tops: { z: number; area: number; level: string }[] = [];
  for (const e of scene.elements) {
    if (e.category !== 'floor') continue;
    for (const s of e.shapes)
      for (const so of solidsOf(s)) {
        const a = area(so.poly);
        if (a >= 4 && so.z1 - so.z0 < 1.2) tops.push({ z: so.z1, area: a, level: e.level });
      }
  }
  tops.sort((a, b) => a.z - b.z);
  // Tops within half a metre are one level (a slab and the finish on it); its height is the biggest one's.
  const out: (Level & { area: number; big: number; first: number; names: Map<string, number> })[] = [];
  for (const t of tops) {
    const last = out[out.length - 1];
    if (last && t.z - last.first < 0.5) {
      if (t.area > last.big) [last.z, last.big] = [t.z, t.area];
      last.area += t.area;
      last.names.set(t.level, (last.names.get(t.level) ?? 0) + t.area);
    } else out.push({ z: t.z, name: t.level, area: t.area, big: t.area, first: t.z, names: new Map([[t.level, t.area]]) });
  }
  // Floors under 8 m² are landings and pads, not levels.
  const levels = out.filter((l) => l.area >= 8).map((l) => {
    const name = [...l.names].sort((a, b) => b[1] - a[1])[0][0] || 'Floor';
    return { z: Math.round(l.z * 1000) / 1000, name: /floor|level|storey|mezz|basement|roof|deck/i.test(name) ? name : `${name} floor` };
  });
  return levels.length ? levels : [{ z: 0, name: 'Ground floor' }];
}

// ---------------------------------------------------------------------------- doors

/** A door you can walk through: its middle, the way across it, its width and its sill. */
export interface Doorway {
  at: Pt2;
  /** Unit vector across the door (through it). */
  across: Pt2;
  width: number;
  z0: number;
  z1: number;
  name: string;
}

/** The doors of a model that stand on a floor and are tall enough to walk through. */
export function doorsOf(scene: Scene3D): Doorway[] {
  const out: Doorway[] = [];
  for (const e of scene.elements) {
    if (e.category !== 'doors' || PART.test(shortName(e.name)) || /glass\b/i.test(e.name)) continue;
    const b = extentOf(e);
    if (!Number.isFinite(b[0]) || b[5] - b[2] < 1.6 || b[5] - b[2] > 6) continue;
    // A door's face is across its thin side; a wall-shaped door says so itself.
    const w = e.shapes.find((s) => s.type === 'wall');
    let across: Pt2 = b[3] - b[0] < b[4] - b[1] ? [1, 0] : [0, 1];
    if (w && w.type === 'wall') {
      const L = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]) || 1;
      across = [-(w.to[1] - w.from[1]) / L, (w.to[0] - w.from[0]) / L];
    }
    const width = Math.abs(across[0]) > Math.abs(across[1]) ? b[4] - b[1] : b[3] - b[0];
    if (width < 0.6) continue;
    out.push({ at: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2], across, width, z0: b[2], z1: b[5], name: shortName(e.name) });
  }
  return out;
}

/** The plan outlines of the doorways on a level, reaching through the wall either side. */
function doorways(scene: Scene3D, z: number): Pt2[][] {
  return doorsOf(scene)
    .filter((d) => Math.abs(d.z0 - z) < 0.35)
    .map((d) => {
      const along: Pt2 = [-d.across[1], d.across[0]];
      const [h, t] = [d.width / 2 - 0.05, 0.45];
      return [
        [d.at[0] - along[0] * h - d.across[0] * t, d.at[1] - along[1] * h - d.across[1] * t],
        [d.at[0] + along[0] * h - d.across[0] * t, d.at[1] + along[1] * h - d.across[1] * t],
        [d.at[0] + along[0] * h + d.across[0] * t, d.at[1] + along[1] * h + d.across[1] * t],
        [d.at[0] - along[0] * h + d.across[0] * t, d.at[1] - along[1] * h + d.across[1] * t],
      ];
    });
}

// ---------------------------------------------------------------------------- the floor grid

/** A level as a grid: where there is floor, what stands on it, and how much room there is around each spot. */
export interface Grid {
  level: Level;
  x0: number;
  y0: number;
  cell: number;
  nx: number;
  ny: number;
  floor: Uint8Array;
  blocked: Uint8Array;
  /** Distance (m) to the nearest wall, obstacle or floor edge. */
  clear: Float32Array;
  /** What you see at eye height: 1 across the floor (nothing taller than a table), 2 a shut door, 0 a wall or no floor. */
  see: Uint8Array;
}

const CELL = 0.25;

export function levelGrid(scene: Scene3D, level: Level, cell = CELL): Grid | null {
  const floors: Pt2[][] = [];
  const obstacles: Solid[] = [], sightlines: Solid[] = [], shut: Solid[] = [];
  const lo = level.z + 0.3, hi = level.z + 1.8;
  for (const e of scene.elements) {
    const isFloor = e.category === 'floor';
    const blocks = !PASSABLE.has(e.category);
    if (!isFloor && !blocks && e.category !== 'doors') continue;
    for (const s of e.shapes)
      for (const so of solidsOf(s)) {
        if (isFloor && Math.abs(so.z1 - level.z) < 0.3 && area(so.poly) > 0.5) floors.push(so.poly);
        else if (blocks && so.z1 > lo && so.z0 < hi) obstacles.push(so);
        if (so.z1 > level.z + 1.35 && so.z0 < level.z + 1.85) {
          if (blocks) sightlines.push(so);
          else if (e.category === 'doors') shut.push(so);
        }
      }
  }
  if (!floors.length) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of floors.flat()) [x0, y0, x1, y1] = [Math.min(x0, p[0]), Math.min(y0, p[1]), Math.max(x1, p[0]), Math.max(y1, p[1])];
  x0 -= cell;
  y0 -= cell;
  const nx = Math.ceil((x1 - x0) / cell) + 2, ny = Math.ceil((y1 - y0) / cell) + 2;
  if (nx * ny > 2_000_000) return null;
  const floor = new Uint8Array(nx * ny), blocked = new Uint8Array(nx * ny);
  const centre = (i: number, j: number): Pt2 => [x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell];
  const fill = (poly: Pt2[], into: Uint8Array, grow: number) => {
    let [a, b, c, d] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of poly) [a, b, c, d] = [Math.min(a, p[0]), Math.min(b, p[1]), Math.max(c, p[0]), Math.max(d, p[1])];
    const [i0, j0] = [Math.max(0, Math.floor((a - grow - x0) / cell)), Math.max(0, Math.floor((b - grow - y0) / cell))];
    const [i1, j1] = [Math.min(nx - 1, Math.floor((c + grow - x0) / cell)), Math.min(ny - 1, Math.floor((d + grow - y0) / cell))];
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) if (!into[j * nx + i] && (grow ? polyDist(centre(i, j), poly) <= grow : inPoly(centre(i, j), poly))) into[j * nx + i] = 1;
  };
  for (const p of floors) fill(p, floor, 0);
  // Thin walls must not slip between cell centres: anything within half a cell blocks it.
  for (const o of obstacles) fill(o.poly, blocked, cell * 0.5);
  const see = new Uint8Array(nx * ny);
  const walls = new Uint8Array(nx * ny), doors = new Uint8Array(nx * ny);
  for (const o of sightlines) fill(o.poly, walls, cell * 0.5);
  for (const o of shut) fill(o.poly, doors, cell * 0.5);
  for (let k = 0; k < see.length; k++) see[k] = !floor[k] || walls[k] ? 0 : doors[k] ? 2 : 1;
  // A door goes through its wall even where the wall was drawn without the opening.
  for (const d of doorways(scene, level.z)) {
    const p = new Uint8Array(nx * ny);
    fill(d, p, 0);
    for (let k = 0; k < p.length; k++) if (p[k]) blocked[k] = 0;
  }
  // Room around each spot: a two-pass chamfer distance to the nearest blocked or floorless cell.
  const INF = 1e9;
  const d = new Float32Array(nx * ny);
  for (let k = 0; k < d.length; k++) d[k] = floor[k] && !blocked[k] ? INF : 0;
  const r2 = Math.SQRT2;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!d[k]) continue;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) v = Math.min(v, d[k - nx] + 1);
      if (i > 0 && j > 0) v = Math.min(v, d[k - nx - 1] + r2);
      if (i < nx - 1 && j > 0) v = Math.min(v, d[k - nx + 1] + r2);
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) v = Math.min(v, 1);
      d[k] = v;
    }
  for (let j = ny - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (!d[k]) continue;
      let v = d[k];
      if (i < nx - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < ny - 1) v = Math.min(v, d[k + nx] + 1);
      if (i < nx - 1 && j < ny - 1) v = Math.min(v, d[k + nx + 1] + r2);
      if (i > 0 && j < ny - 1) v = Math.min(v, d[k + nx - 1] + r2);
      d[k] = v;
    }
  const clear = new Float32Array(nx * ny);
  for (let k = 0; k < d.length; k++) clear[k] = d[k] ? (d[k] - 0.5) * cell : 0;
  return { level, x0, y0, cell, nx, ny, floor, blocked, clear, see };
}

const cellOf = (g: Grid, p: Pt2) => {
  const [i, j] = [Math.floor((p[0] - g.x0) / g.cell), Math.floor((p[1] - g.y0) / g.cell)];
  return i < 0 || j < 0 || i >= g.nx || j >= g.ny ? -1 : j * g.nx + i;
};
const centreOf = (g: Grid, k: number): Pt2 => [g.x0 + ((k % g.nx) + 0.5) * g.cell, g.y0 + (Math.floor(k / g.nx) + 0.5) * g.cell];
/** Room (m) at a point; 0 off the floor or in a wall. */
export const clearAt = (g: Grid, p: Pt2) => {
  const k = cellOf(g, p);
  return k < 0 ? 0 : g.clear[k];
};

/** How far you can see along a direction at eye height before a wall, a door or the floor's edge (and whether it was a door). */
export function sightLine(g: Grid, p: Pt2, dir: Pt2, max = 30): { run: number; door: boolean } {
  const step = g.cell / 2;
  for (let t = step; t <= max; t += step) {
    const k = cellOf(g, [p[0] + dir[0] * t, p[1] + dir[1] * t]);
    if (k < 0 || g.see[k] !== 1) return { run: t - step, door: k >= 0 && g.see[k] === 2 };
  }
  return { run: max, door: false };
}
const sightRun = (g: Grid, p: Pt2, dir: Pt2, max = 30) => sightLine(g, p, dir, max).run;

/** Walking distance (m) from a point to every spot on a level: -1 where you can't get to. */
export function walkingDistances(g: Grid, from: Pt2): Float32Array {
  const d = new Float32Array(g.clear.length).fill(-1);
  const k0 = cellOf(g, from);
  if (k0 < 0 || g.clear[k0] <= 0) return d;
  d[k0] = 0;
  const queue = [k0];
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    const [i, j] = [k % g.nx, Math.floor(k / g.nx)];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [ii, jj] = [i + di, j + dj];
      if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
      const n = jj * g.nx + ii;
      if (d[n] < 0 && g.clear[n] > 0) {
        d[n] = d[k] + g.cell;
        queue.push(n);
      }
    }
  }
  return d;
}

/** A walking route between two points on a level (A* over the grid, then straightened), or null. */
export function findPath(g: Grid, a: Pt2, b: Pt2): Pt2[] | null {
  const snap = (p: Pt2) => {
    const k = cellOf(g, p);
    if (k >= 0 && g.clear[k] > 0) return k;
    let best = -1, bd = Infinity;
    for (let n = 0; n < g.clear.length; n++) {
      if (g.clear[n] <= 0) continue;
      const c = centreOf(g, n);
      const dd = Math.hypot(c[0] - p[0], c[1] - p[1]);
      if (dd < bd) [best, bd] = [n, dd];
    }
    return bd < 3 ? best : -1;
  };
  const [s, t] = [snap(a), snap(b)];
  if (s < 0 || t < 0) return null;
  const { nx, clear } = g;
  const cost = new Float32Array(clear.length).fill(Infinity);
  const from = new Int32Array(clear.length).fill(-1);
  const tc = centreOf(g, t);
  const h = (k: number) => {
    const c = centreOf(g, k);
    return Math.hypot(c[0] - tc[0], c[1] - tc[1]) / g.cell;
  };
  // A small binary heap of [f, cell].
  const heap: [number, number][] = [];
  const push = (f: number, k: number) => {
    heap.push([f, k]);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  cost[s] = 0;
  push(h(s), s);
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [, k] = pop();
    if (k === t) break;
    const [i, j] = [k % nx, Math.floor(k / nx)];
    for (const [di, dj, w] of steps) {
      const [ii, jj] = [i + di, j + dj];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= g.ny) continue;
      const n = jj * nx + ii;
      if (clear[n] <= 0) continue;
      // Keep to the middle of doors and corridors.
      const c = cost[k] + w * (1 + 0.6 / (clear[n] + 0.15));
      if (c < cost[n]) {
        cost[n] = c;
        from[n] = k;
        push(c + h(n), n);
      }
    }
  }
  if (from[t] < 0 && s !== t) return null;
  const cells: number[] = [];
  for (let k = t; k >= 0; k = from[k]) {
    cells.push(k);
    if (k === s) break;
  }
  cells.reverse();
  const pts: Pt2[] = [a, ...cells.slice(1, -1).map((k) => centreOf(g, k)), b];
  // Straighten: skip ahead while the line between stays clear of walls.
  const sees = (p: Pt2, q: Pt2) => {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    for (let u = 0; u <= L; u += g.cell / 2) if (clearAt(g, [p[0] + ((q[0] - p[0]) * u) / (L || 1), p[1] + ((q[1] - p[1]) * u) / (L || 1)]) < 0.2) return false;
    return true;
  };
  const out: Pt2[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; ) {
    let j = pts.length - 1;
    while (j > i + 1 && !sees(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------------------- rooms

export interface Room {
  /** The most open spot. */
  at: Pt2;
  area: number;
  name: string | null;
}

/** What a room is called, from the floor finish laid in it ("Floor finish: Office 101" → "Office 101"). */
function roomName(scene: Scene3D, level: Level, p: Pt2): string | null {
  let best: { name: string; score: number } | null = null;
  for (const e of scene.elements) {
    if (e.category !== 'floor' && e.category !== 'ceiling') continue;
    for (const s of e.shapes)
      for (const so of solidsOf(s)) {
        const near = e.category === 'floor' ? Math.abs(so.z1 - level.z) < 0.3 : so.z0 > level.z && so.z0 < level.z + 5;
        if (!near || !inPoly(p, so.poly)) continue;
        let n = e.name;
        if (n.includes(':')) n = n.slice(n.indexOf(':') + 1);
        else if (e.category === 'floor') n = n.replace(/^floor finish\s*/i, '');
        else n = /ceiling(?:\/bulkhead)?\s+(.*)$/i.exec(n)?.[1] ?? '';
        // "washrooms 106-108 at 2600 AFF" → "washrooms 106-108"; "community hall, sealed topping" → "community hall".
        n = shortName(n).split(',')[0].replace(/^(at|in|over)\s+/i, '').replace(/\s(at|to|over|around|under|above|below|with|for)\s.*$/i, '');
        n = n.replace(/\b(tile|vinyl|carpet|epoxy|sealed|concrete|finish|act|gypsum|gwb|aff)\b/gi, '').replace(/\s+/g, ' ').trim();
        if (n.length < 3 || /slab|deck|topping|on grade|\bsog\b|clt|^f\d|^c\d|\d{2,3} ?mm|^\W/i.test(n)) continue;
        const score = (e.name.includes(':') ? 3 : e.category === 'floor' ? 2 : 1) - area(so.poly) / 1e4;
        if (!best || score > best.score) best = { name: n[0].toUpperCase() + n.slice(1), score };
      }
  }
  return best?.name ?? null;
}

/** The open rooms on a level: the grid split at its doors, each part's most open spot. */
export function roomsOf(scene: Scene3D, g: Grid, min = 3): Room[] {
  const open = 0.6;
  const seen = new Uint8Array(g.clear.length);
  const rooms: Room[] = [];
  for (let k0 = 0; k0 < g.clear.length; k0++) {
    if (seen[k0] || g.clear[k0] < open) continue;
    const stack = [k0];
    seen[k0] = 1;
    let n = 0, best = k0;
    while (stack.length) {
      const k = stack.pop()!;
      n++;
      if (g.clear[k] > g.clear[best]) best = k;
      const [i, j] = [k % g.nx, Math.floor(k / g.nx)];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const [ii, jj] = [i + di, j + dj];
        if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
        const m = jj * g.nx + ii;
        if (!seen[m] && g.clear[m] >= open) {
          seen[m] = 1;
          stack.push(m);
        }
      }
    }
    // The room includes the band near its walls the threshold left out.
    const a = n * g.cell * g.cell * 1.6;
    if (a >= min) rooms.push({ at: centreOf(g, best), area: a, name: null });
  }
  for (const r of rooms) r.name = roomName(scene, g.level, r.at);
  // Furniture can split a room in two: keep the bigger part of a room with the same name.
  rooms.sort((a, b) => b.area - a.area);
  return rooms.filter((r, i) => !r.name || !rooms.slice(0, i).some((q) => q.name === r.name));
}

/** What to call a room the drawings didn't name. */
const describe = (area: number) => (area >= 80 ? 'Large open space' : area >= 25 ? 'Open area' : area >= 8 ? 'Room' : 'Small room');

// ---------------------------------------------------------------------------- the entrance and the street

export interface Entrance {
  /** Middle of the door at floor level. */
  at: Pt2;
  /** Unit vector pointing out of the building. */
  out: Pt2;
  z: number;
  name: string;
}

function extentOf(e: Element3D) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const s of e.shapes)
    for (const so of solidsOf(s)) {
      for (const [x, y] of so.poly) [b[0], b[1], b[3], b[4]] = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[3], x), Math.max(b[4], y)];
      [b[2], b[5]] = [Math.min(b[2], so.z0), Math.max(b[5], so.z1)];
    }
  return b;
}

/** The building itself, from its walls, floors, roof and frame (no site services running off to the road): [x0, y0, z0, x1, y1, z1]. */
export function buildingExtent(scene: Scene3D): [number, number, number, number, number, number] | null {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const e of scene.elements) {
    if (!['envelope', 'floor', 'roof', 'structure'].includes(e.category)) continue;
    const x = extentOf(e);
    for (let k = 0; k < 3; k++) [b[k], b[k + 3]] = [Math.min(b[k], x[k]), Math.max(b[k + 3], x[k + 3])];
  }
  return Number.isFinite(b[0]) ? (b as [number, number, number, number, number, number]) : null;
}

/** The building's middle in plan. */
function middleOf(scene: Scene3D): Pt2 {
  const b = buildingExtent(scene);
  return b ? [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2] : [0, 0];
}

/** Which way the street is from the building (unit, plan): towards the roads and parking. */
export function streetSide(scene: Scene3D): Pt2 {
  const mid = middleOf(scene);
  let [sx, sy] = [0, 0];
  for (const e of scene.elements) {
    if (e.category !== 'paving' && e.category !== 'civil') continue;
    if (!(e.material === 'asphalt' || /road|street|parking|drive|lot|lane|court|access|fire route/i.test(e.name))) continue;
    for (const s of e.shapes)
      for (const so of solidsOf(s)) {
        const a = Math.min(area(so.poly), 4000);
        const c = so.poly.reduce<Pt2>((m, p) => [m[0] + p[0] / so.poly.length, m[1] + p[1] / so.poly.length], [0, 0]);
        const L = Math.hypot(c[0] - mid[0], c[1] - mid[1]) || 1;
        [sx, sy] = [sx + ((c[0] - mid[0]) / L) * a, sy + ((c[1] - mid[1]) / L) * a];
      }
  }
  const L = Math.hypot(sx, sy);
  return L > 1e-6 ? [sx / L, sy / L] : [0, -1];
}

/** The main way in: an outside door on the lowest level, preferring one called the entrance and facing the street. */
export function findEntrance(scene: Scene3D, g: Grid | null, street: Pt2, biggest: Pt2 | null = null): Entrance | null {
  if (!g) return null;
  // The way in usually leads straight to the biggest room (the lobby, the shop floor).
  const far = biggest ? walkingDistances(g, biggest) : null;
  const floorAt = (p: Pt2) => {
    const k = cellOf(g, p);
    return k >= 0 && g.floor[k] === 1;
  };
  let best: (Entrance & { score: number }) | null = null;
  for (const d of doorsOf(scene)) {
    if (Math.abs(d.z0 - g.level.z) > 0.35) continue;
    const [at, n] = [d.at, d.across];
    // Outside doors have floor on one side only.
    const inA = floorAt([at[0] + n[0] * 1.2, at[1] + n[1] * 1.2]), inB = floorAt([at[0] - n[0] * 1.2, at[1] - n[1] * 1.2]);
    if (inA === inB) continue;
    const out: Pt2 = inA ? [-n[0], -n[1]] : n;
    let score = out[0] * street[0] + out[1] * street[1] + Math.min(d.width, 2.2) * 0.3;
    const k = cellOf(g, [at[0] - out[0] * 1.2, at[1] - out[1] * 1.2]);
    if (far && k >= 0 && far[k] >= 0) score += 1.5 * Math.exp(-far[k] / 15);
    if (/entrance|entry|main|front|lobby|vestibule/i.test(d.name)) score += 3;
    if (/sliding|pair|double|glazed|storefront|automatic/i.test(d.name)) score += 0.6;
    if (/overhead|roll-?up|garage|sectional|exit|service|mech|elec|loading|stair/i.test(d.name)) score -= 2.5;
    if (!best || score > best.score) best = { at, out, z: g.level.z, name: d.name, score };
  }
  return best && { at: best.at, out: best.out, z: best.z, name: best.name };
}

// ---------------------------------------------------------------------------- the plan

/** A place to stand and look, in model metres (eye height included). */
export interface Stop {
  at: Pt3;
  look: Pt3;
  title: string;
  text: string;
  /** Route to it from the stop before (eye height), or none to fly straight. */
  route?: Pt3[];
  level?: number;
}

export interface WalkPlan {
  levels: Level[];
  /** Spots on each level with room to stand: where a level change lands you. */
  spots: Pt2[][];
  entrance: Entrance | null;
  street: Pt2;
  /** The building's box, model metres: [x0, y0, z0, x1, y1, z1]. */
  extent: [number, number, number, number, number, number] | null;
  /** Where Walk starts: outside the entrance, facing it. */
  start: Stop;
  /** The inside of the tour: the entrance, then rooms level by level. */
  stops: Stop[];
}

export const EYE = 1.6;

/** What catches the eye from a spot looking one way: a few element names. */
function ahead(scene: Scene3D, level: Level, p: Pt2, dir: Pt2, reach: number): string[] {
  const seen: { name: string; d: number }[] = [];
  for (const e of scene.elements) {
    if (!NOTABLE.has(e.category) || PART.test(shortName(e.name))) continue;
    const b = extentOf(e);
    if (!Number.isFinite(b[0]) || b[2] > level.z + 3.2 || b[5] < level.z + 0.2) continue;
    const c: Pt2 = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2];
    const v: Pt2 = [c[0] - p[0], c[1] - p[1]];
    const d = Math.hypot(v[0], v[1]);
    if (d < 0.8 || d > reach || (v[0] * dir[0] + v[1] * dir[1]) / d < Math.cos((40 * Math.PI) / 180)) continue;
    seen.push({ name: shortName(e.name), d });
  }
  const names: string[] = [];
  for (const s of seen.sort((a, b) => a.d - b.d)) {
    const key = s.name.replace(/\d+[a-z]?/gi, '#').toLowerCase();
    if (!names.some((n) => n.replace(/\d+[a-z]?/gi, '#').toLowerCase() === key)) names.push(s.name);
    if (names.length === 3) break;
  }
  return names;
}
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Where to stand in a room and which way to look: back against one side, looking the way that shows the most floor. */
function viewIn(g: Grid, at: Pt2, from: Pt2 | null): { stand: Pt2; dir: Pt2; reach: number; score: number } {
  const dirOf = (a: number): Pt2 => [Math.cos(a), Math.sin(a)];
  let best = { a: 0, score: -1 };
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    // What a person sees: a fan of sight lines across the middle of the view.
    // A shut door at the end of a sight line is less to look at than the room.
    let score = 0;
    for (let f = -3; f <= 3; f++) {
      const s = sightLine(g, at, dirOf(a + (f * Math.PI) / 18));
      score += Math.min(12, s.run) ** 2 * (s.door ? 0.35 : 1);
    }
    // Slightly prefer carrying on the way you came in, so the camera doesn't spin round.
    if (from) {
      const v: Pt2 = [at[0] - from[0], at[1] - from[1]];
      const L = Math.hypot(v[0], v[1]) || 1;
      score *= 1 + 0.2 * ((v[0] * Math.cos(a) + v[1] * Math.sin(a)) / L);
    }
    if (score > best.score) best = { a, score };
  }
  const dir = dirOf(best.a);
  const fwd = sightRun(g, at, dir), back = sightRun(g, at, [-dir[0], -dir[1]]);
  const step = Math.max(0, Math.min(back - 0.5, fwd * 0.5, 6));
  const stand: Pt2 = [at[0] - dir[0] * step, at[1] - dir[1] * step];
  return { stand, dir, reach: fwd + step, score: best.score };
}

/** Orders rooms by walking from one to the nearest next. */
function nearestOrder(rooms: Room[], from: Pt2): Room[] {
  const left = [...rooms], out: Room[] = [];
  let p = from;
  while (left.length) {
    let k = 0;
    for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].at[0] - p[0], left[i].at[1] - p[1]) < Math.hypot(left[k].at[0] - p[0], left[k].at[1] - p[1])) k = i;
    const [r] = left.splice(k, 1);
    out.push(r);
    p = r.at;
  }
  return out;
}

export function walkPlan(scene: Scene3D, opts: { roomsPerLevel?: number } = {}): WalkPlan {
  const levels = floorLevels(scene);
  const grids = levels.map((l) => levelGrid(scene, l));
  const street = streetSide(scene);
  const roomsAll = grids.map((g) => (g ? roomsOf(scene, g) : []));
  const entrance = findEntrance(scene, grids[0], street, roomsAll[0][0]?.at ?? null);
  const mid = middleOf(scene);
  const spots = roomsAll.map((rs) => rs.map((r) => r.at));
  const lift = (p: Pt2, z: number): Pt3 => [p[0], p[1], z + EYE];

  // Walk starts outside the front door, or outside the middle of the longest outside wall.
  let start: Stop;
  if (entrance) {
    const p: Pt2 = [entrance.at[0] + entrance.out[0] * 3, entrance.at[1] + entrance.out[1] * 3];
    start = { at: lift(p, entrance.z), look: [entrance.at[0], entrance.at[1], entrance.z + EYE - 0.1], title: entrance.name, text: '' };
  } else {
    let wall: { a: Pt2; b: Pt2; z: number } | null = null;
    for (const e of scene.elements)
      for (const s of e.shapes)
        if (e.category === 'envelope' && s.type === 'wall' && (!wall || Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) > Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])))
          wall = { a: s.from, b: s.to, z: Math.max(levels[0].z, s.z0) };
    const c: Pt2 = wall ? [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2] : [mid[0], mid[1] - 10];
    let out: Pt2 = [c[0] - mid[0], c[1] - mid[1]];
    if (wall) {
      const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) || 1;
      const n: Pt2 = [-(wall.b[1] - wall.a[1]) / L, (wall.b[0] - wall.a[0]) / L];
      out = n[0] * out[0] + n[1] * out[1] >= 0 ? n : [-n[0], -n[1]];
    }
    const L = Math.hypot(out[0], out[1]) || 1;
    out = [out[0] / L, out[1] / L];
    const z = wall?.z ?? levels[0].z;
    start = { at: lift([c[0] + out[0] * 5, c[1] + out[1] * 5], z), look: [c[0], c[1], z + EYE - 0.1], title: 'Outside', text: '' };
  }

  const stops: Stop[] = [];
  let prev: Pt2 = entrance ? entrance.at : mid;
  if (entrance) {
    const p: Pt2 = [entrance.at[0] + entrance.out[0] * 4.5, entrance.at[1] + entrance.out[1] * 4.5];
    stops.push({ at: lift(p, entrance.z), look: [entrance.at[0], entrance.at[1], entrance.z + 1.3], title: 'Front entrance', text: `${entrance.name}, on the ${levels[0].name.toLowerCase()}.`, level: 0 });
  }
  const per = opts.roomsPerLevel ?? 5;
  levels.forEach((level, li) => {
    const g = grids[li];
    if (!g) return;
    // Rooms worth a look: the biggest few with something to see (not a closet facing its door).
    const views = new Map(roomsAll[li].map((r) => [r, viewIn(g, r.at, null)]));
    const worth = roomsAll[li].filter((r, i) => i === 0 || views.get(r)!.score >= 50).slice(0, per);
    const rooms = nearestOrder(worth, prev);
    let first = true;
    for (const r of rooms) {
      const v = viewIn(g, r.at, prev);
      let route: Pt3[] | undefined;
      const last = stops[stops.length - 1];
      if (li === 0 && first && entrance) {
        // In through the front door, then on to the room.
        const inside: Pt2 = [entrance.at[0] - entrance.out[0] * 1.2, entrance.at[1] - entrance.out[1] * 1.2];
        const rest = findPath(g, inside, v.stand);
        route = [last.at, lift(entrance.at, level.z), ...(rest ?? [inside, v.stand]).map((p) => lift(p, level.z))];
      } else if (last && last.level === li) {
        const path = findPath(g, [last.at[0], last.at[1]], v.stand);
        if (path) route = path.map((p) => lift(p, level.z));
      }
      const seen = ahead(scene, level, v.stand, v.dir, Math.min(v.reach + 1, 16));
      const name = r.name ?? describe(r.area);
      stops.push({
        at: lift(v.stand, level.z),
        look: [v.stand[0] + v.dir[0] * Math.min(8, Math.max(3, v.reach)), v.stand[1] + v.dir[1] * Math.min(8, Math.max(3, v.reach)), level.z + EYE - 0.25],
        title: `${level.name} · ${name}`,
        text: seen.length ? `Ahead: ${list(seen)}.` : `${Math.round(r.area)} m² of open floor.`,
        route,
        level: li,
      });
      prev = r.at;
      first = false;
    }
  });
  return { levels, spots, entrance, street, extent: buildingExtent(scene), start, stops };
}
