import { evaluate } from './formula';
import { polylineLength, ringArea, ringLength } from './geometry';
import { FINISH_ROLES, doorHeight, type FinishRole, type Measurement, type Project, type Sheet, type TakeoffType, type Units } from './model';
import { areaUnit, lengthUnit, toArea, toLength } from './units';
import { viewScaleAt } from './sheetViews';

/** Formula variables in project units. */
export interface Vars {
  /** Length (linear types). */
  L: number;
  /** Type height. */
  H: number;
  /** Area: measured area for area types, L × H for linear types. */
  A: number;
  /** Perimeter (area types). */
  P: number;
  /** Number of measurements (runs, rooms or counted items). */
  N: number;
  /** Inner perimeter: the edges of cutouts in area measurements (included in P). */
  I: number;
  /** Openings: the part of filled rooms' perimeters that crosses doorways (included in P). */
  O?: number;
}

/**
 * The names a formula can use: the totals, the type's own sizes (W, D, T), and the
 * long names Autodesk Takeoff formulas use (Distance, Area, Perimeter, …), so
 * formulas written there work here.
 */
export function formulaVars(vars: Vars, type: TakeoffType): Record<string, number> {
  const W = type.width ?? 0;
  const D = type.depth ?? 0;
  const T = type.thickness ?? 0;
  return {
    ...vars,
    O: vars.O ?? 0,
    W,
    D,
    T,
    Distance: vars.L,
    Length: vars.L,
    Height: vars.H,
    Area: vars.A,
    Perimeter: vars.P,
    InnerPerimeter: vars.I,
    Openings: vars.O ?? 0,
    Count: vars.N,
    Width: W,
    Depth: D,
    Thickness: T,
  };
}

/** Quantities of one measurement, or null when its sheet has no scale yet. */
export function measurementVars(m: Measurement, type: TakeoffType, sheet: Sheet, units: Units): Vars | null {
  const H = type.height;
  if (type.kind === 'count') return { L: 0, H, A: 0, P: 0, N: 1, I: 0 };
  // A length the drawing writes needs no scale.
  if (type.kind === 'linear' && m.statedLength !== undefined) {
    const L = toLength(m.statedLength, units);
    return { L, H, A: L * H, P: 0, N: 1, I: 0 };
  }
  // The sheet's scale; with none set, that of the one drawing on it the takeoff lies in. A takeoff
  // inside an inset drawn at its own scale (Kelso S1.0's 1:50 canopy foundation plan on a 1:100
  // sheet) takes the inset's, when the sheet's scale was read off the sheet (detected, or checked by the user), not preset or calibrated by hand, and
  // the inset is under half the size of the sheet's main drawing (two
  // drawings side by side, a key plan beside a site plan, are not an inset in either).
  const view = viewScaleAt(sheet.views, m.points as [number, number][]);
  const inset =
    !!view &&
    sheet.metersPerPoint !== null &&
    (sheet.scaleSource === 'detected' || sheet.scaleSource === 'verified') &&
    Math.abs(view.metersPerPoint / sheet.metersPerPoint - 1) > 0.01 &&
    (sheet.views ?? []).some((v) => (v.box[2] - v.box[0]) * (v.box[3] - v.box[1]) >= 2 * (view.box[2] - view.box[0]) * (view.box[3] - view.box[1]));
  const mpp = inset ? view!.metersPerPoint : (sheet.metersPerPoint ?? view?.metersPerPoint ?? null);
  if (mpp === null) return null;
  if (type.kind === 'linear') {
    const L = toLength(polylineLength(m.points) * mpp, units);
    return { L, H, A: L * H, P: 0, N: 1, I: 0 };
  }
  const areaPts = ringArea(m.points) - m.holes.reduce((sum, h) => sum + ringArea(h), 0);
  const perimPts = ringLength(m.points) + m.holes.reduce((sum, h) => sum + ringLength(h), 0);
  return {
    L: 0,
    H,
    A: toArea(Math.max(0, areaPts) * mpp * mpp, units),
    P: toLength(perimPts * mpp, units),
    N: 1,
    I: toLength(m.holes.reduce((sum, h) => sum + ringLength(h), 0) * mpp, units),
    O: toLength(Math.min(m.openings ?? 0, perimPts) * mpp, units),
  };
}

/**
 * What a room counts toward a finish type: an area type takes the room's area (and
 * perimeter), a linear type its perimeter as length, so A = perimeter × the type's height
 * (or the room's own ceiling height, when its finish schedule gives one).
 */
export function finishVars(room: Measurement, type: TakeoffType, sheet: Sheet, units: Units): Vars | null {
  if (type.kind === 'count') return { L: 0, H: type.height, A: 0, P: 0, N: 1, I: 0 };
  if (type.kind === 'area') return measurementVars(room, type, sheet, units);
  const mpp = sheet.metersPerPoint;
  if (mpp === null) return null;
  // Base and wall finishes stop at doorways: the perimeter less its openings. Walls go on
  // above a door, so the area loses only the door opening.
  const perim = toLength((ringLength(room.points) + room.holes.reduce((sum, h) => sum + ringLength(h), 0)) * mpp, units);
  const doors = Math.min(toLength((room.openings ?? 0) * mpp, units), perim);
  const L = perim - doors;
  // Wall finishes run up to the room's ceiling when the schedule gave its height.
  const H = room.ceilingHeight && room.ceilingHeight > 0 ? room.ceilingHeight : type.height;
  const A = perim * H - doors * Math.min(H, doorHeight(units));
  return { L, H, A, P: 0, N: 1, I: 0 };
}

/** A room's wall finish shares, while they include its wall finish (see `Measurement.wallShares`); else null. */
export function wallSharesOf(m: Measurement): [string, number][] | null {
  const walls = m.finishes?.walls;
  if (!walls || !m.wallShares || !(walls in m.wallShares)) return null;
  const shares = Object.entries(m.wallShares).filter(([, v]) => v > 0);
  return shares.length > 1 ? shares : null;
}

/** One measurement's share of one type: drawn as that type, or a room finished with it. */
export interface Contribution {
  m: Measurement;
  type: TakeoffType;
  sheet: Sheet;
  /** Null when the sheet has no scale. */
  vars: Vars | null;
  /** Set when the share comes from a room's finishes. */
  role?: FinishRole;
}

/** How many times a sheet counts: a typical floor drawn once for several. */
export const sheetRepeat = (sheet: Sheet): number => (sheet.repeat && sheet.repeat > 1 ? Math.floor(sheet.repeat) : 1);

const times = (v: Vars | null, k: number): Vars | null => (v && k !== 1 ? { ...v, L: v.L * k, A: v.A * k, P: v.P * k, N: v.N * k, I: v.I * k, O: (v.O ?? 0) * k } : v);

/** Every measurement's share of every type, in measurement order; a repeated sheet's shares are multiplied. */
export function contributions(project: Project): Contribution[] {
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  const types = new Map(project.types.map((t) => [t.id, t]));
  const out: Contribution[] = [];
  for (const m of project.measurements) {
    const sheet = sheets.get(m.sheetId);
    if (!sheet) continue;
    const type = types.get(m.typeId);
    const k = sheetRepeat(sheet);
    if (type) out.push({ m, type, sheet, vars: times(measurementVars(m, type, sheet, project.units), k) });
    if (!m.finishes) continue;
    for (const { role } of FINISH_ROLES) {
      // A finish of the room's own type would count the room twice.
      const t = m.finishes[role] && m.finishes[role] !== m.typeId ? types.get(m.finishes[role]!) : undefined;
      if (!t) continue;
      const shares = role === 'walls' ? wallSharesOf(m) : null;
      if (!shares) {
        out.push({ m, type: t, sheet, vars: times(finishVars(m, t, sheet, project.units), k), role });
        continue;
      }
      // Walls finished several ways: each type its share of them.
      for (const [id, share] of shares) {
        const st = types.get(id);
        if (!st || id === m.typeId) continue;
        const v = times(finishVars(m, st, sheet, project.units), k);
        // Its share of the walls' length and area; still one room.
        out.push({ m, type: st, sheet, vars: v && { ...v, L: v.L * share, A: v.A * share, P: v.P * share, O: (v.O ?? 0) * share }, role });
      }
    }
  }
  return out;
}

/** The headline quantity for a type kind: area, length or count. */
export function primaryOf(kind: TakeoffType['kind'], vars: Vars): number {
  return kind === 'area' ? vars.A : kind === 'linear' ? vars.L : vars.N;
}

export function primaryUnit(kind: TakeoffType['kind'], units: Units): string {
  return kind === 'area' ? areaUnit(units) : kind === 'linear' ? lengthUnit(units) : 'ea';
}

export interface ItemResult {
  name: string;
  unit: string;
  formula: string;
  value: number | null;
  error: string | null;
}

export interface TypeTotals {
  type: TakeoffType;
  vars: Vars;
  primary: number;
  unit: string;
  /** Measurements left out because their sheet has no scale. */
  unscaled: number;
  items: ItemResult[];
}

export function typeTotals(project: Project): TypeTotals[] {
  const byType = new Map<string, Contribution[]>();
  for (const c of contributions(project)) {
    const list = byType.get(c.type.id);
    if (list) list.push(c);
    else byType.set(c.type.id, [c]);
  }
  return project.types.map((type) => {
    const vars: Vars = { L: 0, H: type.height, A: 0, P: 0, N: 0, I: 0 };
    let unscaled = 0;
    for (const { vars: v } of byType.get(type.id) ?? []) {
      if (!v) {
        unscaled++;
        continue;
      }
      vars.L += v.L;
      vars.A += v.A;
      vars.P += v.P;
      vars.N += v.N;
      vars.I += v.I;
      vars.O = (vars.O ?? 0) + (v.O ?? 0);
    }
    const items = type.items.map((it): ItemResult => {
      const r = evaluate(it.formula, formulaVars(vars, type));
      return r.ok
        ? { name: it.name, unit: it.unit, formula: it.formula, value: r.value, error: null }
        : { name: it.name, unit: it.unit, formula: it.formula, value: null, error: r.error };
    });
    // Wall finishes are priced by area: their total shows as one.
    const asArea = type.kind === 'linear' && type.headline === 'area';
    return {
      type,
      vars,
      primary: asArea ? vars.A : primaryOf(type.kind, vars),
      unit: asArea ? areaUnit(project.units) : primaryUnit(type.kind, project.units),
      unscaled,
      items,
    };
  });
}
