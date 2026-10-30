import type { BuildElement, BuildModel } from './types';
const prefix = 'Coincident structural geometry candidate:';
/** A shared opening TYPE (W1 etc.) is insufficient: require the same placed
 * opening witness, including source sheet, page and nonzero location box. */
function openingWitness(e: BuildElement): string | null {
  const matches = e.sources.filter(
    (s) =>
      s.kind === 'sheet' &&
      s.box &&
      s.box[2] > s.box[0] &&
      s.box[3] > s.box[1] &&
      /^[^:]+: opening matched to lintel by drawing grids, position and span$/.test(
        s.quote ?? '',
      ),
  );
  // Multiple opening witnesses are ambiguous; do not choose one arbitrarily.
  const keys = [
    ...new Set(
      matches.map((s) => JSON.stringify([s.id, s.page, s.box, s.quote])),
    ),
  ];
  return keys.length === 1 ? keys[0] : null;
}
function geometryKey(e: BuildElement): string | null {
  if (
    e.trade !== 'structure' ||
    e.shape?.type !== 'run' ||
    !e.level ||
    e.shape.points.length < 2
  )
    return null;
  const { points, ...rest } = e.shape;
  if (
    points.some((p) => p.some((v) => !Number.isFinite(v))) ||
    ![rest.z0, rest.height, rest.thickness].every(Number.isFinite)
  )
    return null;
  // Exact equality only. Nearby members, different sections, heads or levels
  // remain separate; reverse point order describes the same physical run.
  const a = JSON.stringify(points),
    b = JSON.stringify([...points].reverse());
  const directed = !!(rest.openings?.length || rest.cornerFills?.length);
  return JSON.stringify([
    e.level,
    e.status ?? null,
    rest,
    directed ? a : a < b ? a : b,
  ]);
}
/** Suppress repeated display solids, not takeoff records or quantities. This is
 * deliberately a candidate annotation, never a quantity reconciliation. */
export function suppressCoincidentStructure(model: BuildModel): BuildModel {
  const groups = new Map<string, BuildElement[]>();
  for (const e of model.elements) {
    const opening = openingWitness(e),
      geometry = geometryKey(e);
    if (!opening || !geometry) continue;
    const key = JSON.stringify([opening, geometry]),
      items = groups.get(key) ?? [];
    items.push(e);
    groups.set(key, items);
  }
  const updates = new Map<string, BuildElement>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((a, b) => a.id.localeCompare(b.id)),
      canonical = ordered[0];
    // The stable ID picks a display representative, not a preferred takeoff.
    for (const e of ordered) {
      const note =
        e.id === canonical.id
          ? `${prefix} canonical display record ${canonical.id}; coincident records ${ordered
              .slice(1)
              .map((v) => v.id)
              .join(
                ', ',
              )} share the exact run and placed-opening source. All takeoff records and quantities remain unreconciled.`
          : `${prefix} display solid suppressed in favour of canonical record ${canonical.id}; same exact run and placed-opening source. This takeoff record and quantity are retained and remain unreconciled.`;
      updates.set(e.id, {
        ...e,
        shape: e.id === canonical.id ? e.shape : null,
        issues: [...e.issues.filter((i) => !i.startsWith(prefix)), note],
      });
    }
  }
  return updates.size
    ? { ...model, elements: model.elements.map((e) => updates.get(e.id) ?? e) }
    : model;
}
