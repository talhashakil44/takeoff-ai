/**
 * The project's 3D model as an AI (or a person) builds it from the drawings: elements made of a
 * few simple shapes (a wall along a line, a slab over an outline, a box, a column, a pipe), in
 * metres with X east, Y up the sheet (project north) and Z up, 0 at the ground floor. It is
 * kept with the project and drawn in Build It; it is never part of the takeoff.
 */

export type Pt2 = [number, number];
export type Pt3 = [number, number, number];

export type Shape3D =
  /** An axis-aligned box. */
  | { type: 'box'; min: Pt3; max: Pt3 }
  /** A wall or any straight run: along from→to, `thickness` across (centred, or shifted left by `offset`), from z0 to z1, with openings cut through it. */
  | { type: 'wall'; from: Pt2; to: Pt2; thickness: number; z0: number; z1: number; offset?: number; openings?: { start: number; end: number; sill: number; head: number }[] }
  /** A slab, roof or pad over a plan outline: top at z1 (or sloping: z1 + dzdx·x + dzdy·y), thickness z1 − z0. */
  | { type: 'slab'; polygon: Pt2[]; z0: number; z1: number; slope?: { dzdx?: number; dzdy?: number } }
  | { type: 'cylinder'; at: Pt2; radius: number; z0: number; z1: number }
  /** A pipe, duct, rail or member between two points. */
  | { type: 'tube'; from: Pt3; to: Pt3; radius: number }
  | { type: 'cone'; at: Pt2; radius: number; z0: number; z1: number }
  | { type: 'sphere'; at: Pt3; radius: number };

export interface Element3D {
  id: string;
  name: string;
  /** Layer: see CATEGORIES. */
  category: string;
  /** The level it belongs to, as the drawings name it ("Ground floor", "Mezzanine", "Roof", "Site"). */
  level: string;
  /** Finish: see MATERIALS (or a colour). */
  material: string;
  color?: string;
  /** Sheet(s) it was read from, e.g. "A2-1 ground floor plan; A3-1 north elevation". */
  source: string;
  /** How sure: "dimensioned", "scaled from the elevation (±100 mm)", "assumed: …". */
  basis: string;
  shapes: Shape3D[];
}

export interface Scene3D {
  version: 1;
  title: string;
  /** What the model's 0,0,0 is on the drawings (e.g. "grid 1/A at ground floor FFE 178.30"). */
  origin: string;
  /** Who built it and when. */
  builtBy: string;
  updated: string;
  elements: Element3D[];
}

/** The layers, in the order Build It lists them. */
export const CATEGORIES: [string, string][] = [
  ['envelope', 'Exterior walls'], ['roof', 'Roof & canopies'], ['glazing', 'Windows & glazing'], ['doors', 'Doors'],
  ['structure', 'Structure'], ['floor', 'Slabs & floor finishes'], ['interior', 'Interior walls'], ['stairs', 'Stairs, ramps & guards'],
  ['mechanical', 'Mechanical'], ['electrical', 'Electrical & lighting'], ['plumbing', 'Plumbing & drains'], ['fixtures', 'Fixtures & millwork'],
  ['furniture', 'Furniture & equipment'], ['ceiling', 'Ceilings'], ['foundation', 'Foundations'], ['civil', 'Civil & underground'],
  ['paving', 'Paving & walks'], ['site', 'Ground & landscape'], ['context', 'Context (neighbours, trees, vehicles)'],
];

/** Finishes with how they look (colour, roughness, metalness, opacity). */
export const MATERIALS: Record<string, { color: string; rough?: number; metal?: number; opacity?: number; pattern?: string }> = {
  block: { color: '#8c8984', rough: 0.9, pattern: 'block' }, brick: { color: '#9a5a44', rough: 0.9, pattern: 'brick' }, stone: { color: '#8f8a80', rough: 0.95 },
  concrete: { color: '#b9b7b0', rough: 0.9, pattern: 'noise' }, metal_panel: { color: '#cdbf9f', rough: 0.45, metal: 0.35, pattern: 'ribs' },
  siding: { color: '#c9c3b6', rough: 0.7, pattern: 'ribs' }, stucco: { color: '#e4ddcf', rough: 0.95 }, wood: { color: '#a37a4f', rough: 0.7 },
  timber: { color: '#cfa06a', rough: 0.7 }, gypsum: { color: '#efebe3', rough: 0.9 },
  roof_metal: { color: '#4b3c34', rough: 0.4, metal: 0.5, pattern: 'seam' }, roof_membrane: { color: '#55595b', rough: 0.85 }, roof_shingle: { color: '#3d3d3f', rough: 0.95 },
  glass: { color: '#9cc4d6', rough: 0.05, metal: 0.1, opacity: 0.38 }, frame: { color: '#3a3f42', rough: 0.4, metal: 0.6 },
  door: { color: '#a87c52', rough: 0.6 }, door_metal: { color: '#5b4637', rough: 0.5, metal: 0.3 }, overhead_door: { color: '#ecebe6', rough: 0.5, metal: 0.2, pattern: 'panels' },
  steel: { color: '#b4532a', rough: 0.55, metal: 0.45 }, steel_grey: { color: '#7d8589', rough: 0.5, metal: 0.6 },
  epoxy: { color: '#9ea6ab', rough: 0.25, metal: 0.05 }, vinyl: { color: '#b89a76', rough: 0.55, pattern: 'planks' }, carpet: { color: '#6f7479', rough: 1 },
  tile: { color: '#d9d8d2', rough: 0.3, pattern: 'tile' }, sealed_concrete: { color: '#b0aea7', rough: 0.5 }, act: { color: '#f3f3ef', rough: 0.95 },
  asphalt: { color: '#45494b', rough: 0.95, pattern: 'noise' }, gravel: { color: '#9a958a', rough: 1, pattern: 'noise' }, grass: { color: '#6f8a4f', rough: 1, pattern: 'grass' },
  soil: { color: '#7a5f43', rough: 1 }, water: { color: '#4f7f99', rough: 0.1, opacity: 0.7 }, paint_line: { color: '#f4f1e6', rough: 0.8 },
  duct: { color: '#c5cbce', rough: 0.35, metal: 0.8 }, pipe: { color: '#3f8fb0', rough: 0.4, metal: 0.4 }, gas: { color: '#e2c321', rough: 0.5 }, equipment: { color: '#8e989c', rough: 0.5, metal: 0.5 },
  light: { color: '#fffbe6', rough: 0.4 }, porcelain: { color: '#fbfbf8', rough: 0.2 }, millwork: { color: '#e6e0d4', rough: 0.6 }, furniture: { color: '#d8cbb4', rough: 0.6 },
  rail: { color: '#2f3a41', rough: 0.4, metal: 0.6 }, tree: { color: '#5b7a3f', rough: 1 }, trunk: { color: '#5a4532', rough: 1 }, vehicle: { color: '#f2f3f2', rough: 0.3, metal: 0.4 },
  safety: { color: '#f0c419', rough: 0.5 }, context: { color: '#c9c2b4', rough: 0.85 },
};

// ---------------------------------------------------------------------------- meshes

export interface Mesh3D {
  positions: number[];
  indices: number[];
}

const area2 = (p: Pt2[]) => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2;

/** Ear clipping for a simple polygon; index triples. */
export function triangulate(poly: Pt2[]): [number, number, number][] {
  const idx = poly.map((_, i) => i);
  if (area2(poly) < 0) idx.reverse();
  const out: [number, number, number][] = [];
  const cross = (o: Pt2, a: Pt2, b: Pt2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: Pt2, a: Pt2, b: Pt2, c: Pt2) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  for (let guard = 0; idx.length > 3 && guard < 20000; guard++) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const [a, b, c] = [poly[i0], poly[i1], poly[i2]];
      if (cross(a, b, c) <= 1e-12) continue;
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(poly[j], a, b, c))) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

function prism(poly: Pt2[], z0: number, z1: number, top?: (x: number, y: number) => number): Mesh3D {
  if (area2(poly) < 0) poly = [...poly].reverse();
  const n = poly.length;
  const positions: number[] = [];
  const t = (x: number, y: number) => (top ? top(x, y) : z1);
  for (const [x, y] of poly) positions.push(x, y, top ? t(x, y) - (z1 - z0) : z0);
  for (const [x, y] of poly) positions.push(x, y, t(x, y));
  const indices: number[] = [];
  for (const [a, b, c] of triangulate(poly)) indices.push(n + a, n + b, n + c, c, b, a);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i);
  }
  return { positions, indices };
}

const segPoly = (p: Pt2, q: Pt2, width: number, off = 0): Pt2[] => {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1e-9;
  const [nx, ny] = [-(q[1] - p[1]) / L, (q[0] - p[0]) / L];
  const [a, b] = [off + width / 2, off - width / 2];
  return [[p[0] + nx * b, p[1] + ny * b], [q[0] + nx * b, q[1] + ny * b], [q[0] + nx * a, q[1] + ny * a], [p[0] + nx * a, p[1] + ny * a]];
};

function merge(parts: Mesh3D[]): Mesh3D {
  const out: Mesh3D = { positions: [], indices: [] };
  for (const m of parts) {
    const o = out.positions.length / 3;
    out.positions.push(...m.positions);
    for (const i of m.indices) out.indices.push(i + o);
  }
  return out;
}

const ring = (cx: number, cy: number, r: number, n: number): Pt2[] => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

function tube(p: Pt3, q: Pt3, r: number, n = 10): Mesh3D {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const L = Math.hypot(...d) || 1e-9;
  const u0 = d.map((x) => x / L);
  const a = Math.abs(u0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const cr = (x: number[], y: number[]) => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const nz = (v: number[]) => v.map((x) => x / (Math.hypot(...v) || 1));
  const u = nz(cr(u0, a)), w = cr(u0, u);
  const positions: number[] = [];
  for (const base of [p, q])
    for (let i = 0; i < n; i++) {
      const [c, s] = [Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n)];
      positions.push(base[0] + r * (c * u[0] + s * w[0]), base[1] + r * (c * u[1] + s * w[1]), base[2] + r * (c * u[2] + s * w[2]));
    }
  positions.push(...p, ...q);
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i, 2 * n, j, i, 2 * n + 1, n + i, n + j);
  }
  return { positions, indices };
}

function wallMesh(s: Extract<Shape3D, { type: 'wall' }>): Mesh3D {
  const L = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]);
  if (L < 1e-6) return { positions: [], indices: [] };
  const [ux, uy] = [(s.to[0] - s.from[0]) / L, (s.to[1] - s.from[1]) / L];
  const at = (t: number): Pt2 => [s.from[0] + ux * t, s.from[1] + uy * t];
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
  return merge(pieces.filter(([a, b, z0, z1]) => b - a > 1e-4 && z1 - z0 > 1e-4).map(([a, b, z0, z1]) => prism(segPoly(at(a), at(b), s.thickness, s.offset ?? 0), z0, z1)));
}

/** A shape as triangles (Z-up metres). */
export function meshOf(s: Shape3D): Mesh3D {
  switch (s.type) {
    case 'box':
      return prism([[s.min[0], s.min[1]], [s.max[0], s.min[1]], [s.max[0], s.max[1]], [s.min[0], s.max[1]]], Math.min(s.min[2], s.max[2]), Math.max(s.min[2], s.max[2]));
    case 'wall':
      return wallMesh(s);
    case 'slab': {
      const sl = s.slope;
      return prism(s.polygon, s.z0, s.z1, sl ? (x, y) => s.z1 + (sl.dzdx ?? 0) * x + (sl.dzdy ?? 0) * y : undefined);
    }
    case 'cylinder':
      return prism(ring(s.at[0], s.at[1], s.radius, 16), s.z0, s.z1);
    case 'tube':
      return tube(s.from, s.to, s.radius);
    case 'cone': {
      const n = 14;
      const positions = [...ring(s.at[0], s.at[1], s.radius, n).flatMap(([x, y]) => [x, y, s.z0]), s.at[0], s.at[1], s.z1, s.at[0], s.at[1], s.z0];
      const indices: number[] = [];
      for (let i = 0; i < n; i++) indices.push(i, (i + 1) % n, n, (i + 1) % n, i, n + 1);
      return { positions, indices };
    }
    case 'sphere': {
      const [n, m] = [12, 8];
      const positions: number[] = [];
      for (let a = 0; a <= m; a++)
        for (let b = 0; b < n; b++) {
          const [th, ph] = [(Math.PI * a) / m, (2 * Math.PI * b) / n];
          positions.push(s.at[0] + s.radius * Math.sin(th) * Math.cos(ph), s.at[1] + s.radius * Math.sin(th) * Math.sin(ph), s.at[2] + s.radius * Math.cos(th));
        }
      const indices: number[] = [];
      for (let a = 0; a < m; a++)
        for (let b = 0; b < n; b++) {
          const [i, j] = [a * n + b, a * n + ((b + 1) % n)];
          indices.push(i, i + n, j + n, i, j + n, j);
        }
      return { positions, indices };
    }
  }
}

export const elementMesh = (e: Element3D): Mesh3D => merge(e.shapes.map(meshOf));

// ---------------------------------------------------------------------------- checking what an AI sends

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const pt = (v: unknown, n: 2 | 3) => Array.isArray(v) && v.length === n && v.every(num);
const LIMIT = 2000; // metres from the origin: anything farther is a unit mistake

/** Why a shape can't be drawn, or null. */
export function shapeProblem(s: unknown): string | null {
  const o = s as Record<string, unknown>;
  if (!o || typeof o !== 'object') return 'a shape must be an object';
  const far = (...v: unknown[]) => v.flat(3).some((x) => num(x) && Math.abs(x as number) > LIMIT);
  switch (o.type) {
    case 'box':
      return !pt(o.min, 3) || !pt(o.max, 3) ? 'box needs min and max as [x, y, z]' : far(o.min, o.max) ? 'box is over 2 km from the origin: use metres' : null;
    case 'wall':
      if (!pt(o.from, 2) || !pt(o.to, 2) || !num(o.thickness) || !num(o.z0) || !num(o.z1)) return 'wall needs from, to ([x, y]), thickness, z0, z1';
      if ((o.thickness as number) <= 0 || (o.thickness as number) > 5) return 'wall thickness must be between 0 and 5 m';
      if (o.openings !== undefined && (!Array.isArray(o.openings) || !o.openings.every((x) => x && ['start', 'end', 'sill', 'head'].every((k) => num((x as Record<string, unknown>)[k])))))
        return 'wall openings need start, end (metres along the wall from `from`), sill and head (z)';
      return far(o.from, o.to, o.z0, o.z1) ? 'wall is over 2 km from the origin: use metres' : null;
    case 'slab':
      if (!Array.isArray(o.polygon) || o.polygon.length < 3 || !o.polygon.every((p) => pt(p, 2)) || !num(o.z0) || !num(o.z1)) return 'slab needs polygon (3+ [x, y]), z0, z1';
      if (Math.abs(area2(o.polygon as Pt2[])) < 1e-6) return 'slab polygon has no area';
      return far(o.polygon) ? 'slab is over 2 km from the origin: use metres' : null;
    case 'cylinder':
    case 'cone':
      return !pt(o.at, 2) || !num(o.radius) || !num(o.z0) || !num(o.z1) ? `${o.type} needs at ([x, y]), radius, z0, z1` : null;
    case 'tube':
      return !pt(o.from, 3) || !pt(o.to, 3) || !num(o.radius) ? 'tube needs from, to ([x, y, z]) and radius' : null;
    case 'sphere':
      return !pt(o.at, 3) || !num(o.radius) ? 'sphere needs at ([x, y, z]) and radius' : null;
    default:
      return `unknown shape type ${String(o.type)} (box, wall, slab, cylinder, tube, cone, sphere)`;
  }
}

/** Bounds of the model in metres: [minX, minY, minZ, maxX, maxY, maxZ]. */
export function bounds(elements: Element3D[]): [number, number, number, number, number, number] | null {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const e of elements) {
    const m = elementMesh(e);
    for (let i = 0; i < m.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k], m.positions[i + k]);
        b[k + 3] = Math.max(b[k + 3], m.positions[i + k]);
      }
  }
  return Number.isFinite(b[0]) ? (b as [number, number, number, number, number, number]) : null;
}

/** Which Build It trade an element's work belongs to, for the construction sequence. */
export function tradeOf(e: Pick<Element3D, 'category' | 'material'>): string {
  if (e.category === 'floor' && ['epoxy', 'vinyl', 'carpet', 'tile', 'sealed_concrete'].includes(e.material)) return 'flooring';
  if (e.category === 'electrical') return e.material === 'light' ? 'elec-trim' : 'elec-rough';
  if (e.category === 'glazing') return 'doors';
  return (
    ({ envelope: 'envelope', roof: 'envelope', doors: 'doors', structure: 'structure', floor: 'structure', foundation: 'structure', interior: 'partitions', stairs: 'structure',
      mechanical: 'mech-rough', plumbing: 'mech-rough', fixtures: 'mech-trim', furniture: 'specialties', ceiling: 'ceilings', civil: 'site', paving: 'site', site: 'site', context: 'site' } as Record<string, string>)[e.category] ?? 'other'
  );
}
