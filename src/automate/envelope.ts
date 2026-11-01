import { newId, type Measurement, type Project, type Pt, type TakeoffType } from '../model';
import { enclosedOutline } from './foundations';
import { replaceRun, type Automation } from './result';

/**
 * The roof, from the building's own outline: on each plan, the exterior walls taken off there
 * (EW1, EXT-2, or a wall type described as exterior) enclose the building's footprint; the
 * largest footprint over the plans is the roof's plan area, with the eaves added. It is one
 * roof area: a roof plan with several roof systems (R1, R2) is split by hand.
 */

export interface EnvelopeResult extends Automation {
  checks: string[];
}

/** An exterior wall type, by its name or what it says it is. */
export const isExteriorWall = (t: Pick<TakeoffType, 'name' | 'kind' | 'description' | 'assemblyTitle'>) =>
  t.kind === 'linear' && (/^(EW|XW|EXT)[-\s]?\d/i.test(t.name.trim()) || /\bexterior\s+wall|\bEXT(?:ERIOR)?\.?\s+WALL/i.test(`${t.name} ${t.assemblyTitle ?? ''} ${t.description ?? ''}`));

const ringArea = (r: Pt[]) => Math.abs(r.reduce((n, p, i) => n + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;

/** Eaves added round the footprint, in metres. */
export const EAVES = 0.3;

export function automateRoof(p: Project): EnvelopeResult {
  const checks: string[] = [];
  const exterior = new Set(p.types.filter(isExteriorWall).map((t) => t.id));
  if (!exterior.size) return { message: 'No exterior wall types taken off to find the building outline from.', checks };
  let best: { sheetId: string; ring: Pt[]; m2: number } | null = null;
  // Floor plans only: a foundation plan's walls are below grade (its outline is the slab's).
  const plans = p.sheets.filter((s) => !s.superseded && s.metersPerPoint && !/FOUNDATION|FOOTING|BASEMENT|SITE/i.test(s.title ?? ''));
  for (const s of plans) {
    if (!s.metersPerPoint) continue;
    const runs = p.measurements.filter((m) => m.sheetId === s.id && exterior.has(m.typeId) && m.points.length >= 2).map((m) => m.points);
    if (runs.length < 2) continue;
    const ring = enclosedOutline(runs, s.metersPerPoint, EAVES);
    if (!ring) continue;
    const m2 = ringArea(ring) * s.metersPerPoint * s.metersPerPoint;
    if (!best || m2 > best.m2) best = { sheetId: s.id, ring, m2 };
  }
  if (!best) return { message: 'The exterior walls taken off do not enclose a building outline on any plan.', checks };
  const metric = p.units === 'metric';
  const sheet = p.sheets.find((s) => s.id === best!.sheetId)!;
  const type: TakeoffType = {
    id: newId(),
    name: 'Roof – plan area (building outline + eaves)',
    color: '#8d6e63',
    kind: 'area',
    height: 0,
    division: '07 Thermal & Moisture Protection',
    package: 'Roofing sub',
    description: `An area proxy for the roof, not the roof plan's geometry: the building's outline from its exterior walls on ${sheet.name} (the largest floor plan footprint), with ${EAVES * 1000} mm eaves. Plan area: add for slope; split by roof system from the roof plan.`,
    items: [{ id: newId(), name: 'Roof area (plan)', unit: metric ? 'm²' : 'SF', formula: 'A' }],
  };
  const added: Measurement[] = [{ id: newId(), sheetId: best.sheetId, typeId: type.id, points: best.ring, holes: [], source: 'envelope', label: 'Roof' }];
  checks.push(`Roof area is the building outline from the exterior walls on ${sheet.name} plus ${EAVES * 1000} mm eaves, in plan: add for slope, and split it by roof system (R1, R2…) from the roof plan.`);
  const m2 = Math.round(best.m2);
  return {
    message: `${metric ? m2 : Math.round(m2 * 10.7639)} ${metric ? 'm²' : 'SF'} of roof (plan) from the exterior walls on ${sheet.name}`,
    checks,
    apply: (q) => replaceRun(q, 'envelope', [type], added),
  };
}
