import type { BuildModel } from './types';
/** Reject a paper-position fallback when an unregistered services sheet is clearly detached
 * from the architectural footprint. Preserve every element and quantity for review. */
export function quarantineDetachedSheets(model: BuildModel, registered: Set<string>) {
  const groups = new Map<string, typeof model.elements>();
  for (const e of model.elements) {
    if (e.origin !== 'takeoff' || registered.has(e.sheetId) || !/^(mech|elec|fire)-/.test(e.trade) || !e.shape) continue;
    groups.set(e.sheetId, [...(groups.get(e.sheetId) ?? []), e]);
  }
  for (const [sheetId, elements] of groups) {
    let outside = 0,
      checked = 0;
    for (const e of elements) {
      const slab = model.elements.find((s) => s.origin === 'building' && s.level === e.level && s.id.endsWith(':slab'))?.shape;
      const shape = e.shape;
      if (slab?.type !== 'surface' || !shape) continue;
      const points = shape.type === 'point' ? [shape.at] : shape.type === 'run' || shape.type === 'axis' ? shape.points : shape.ring;
      const x = points.reduce((n, p) => n + p[0], 0) / points.length,
        y = points.reduce((n, p) => n + p[1], 0) / points.length;
      const xs = slab.ring.map((p) => p[0]),
        ys = slab.ring.map((p) => p[1]);
      checked++;
      if (x < Math.min(...xs) - 5 || x > Math.max(...xs) + 5 || y < Math.min(...ys) - 5 || y > Math.max(...ys) + 5) outside++;
    }
    if (checked < 3 || outside / checked < 0.6) continue;
    for (const e of elements) {
      e.shape = null;
      e.placement = 'unknown';
      e.issues.push(
        'Sheet alignment could not be verified: most services sit outside the architectural footprint. Register this sheet before displaying its geometry.',
      );
    }
    model.issues.push({
      id: `detached:${sheetId}`,
      severity: 'warning',
      text: `${elements[0].sources[0]?.label ?? 'Services sheet'}: ${elements.length} elements retained without geometry because the paper-position fallback is detached from the building. Sheet registration needs review.`,
      refs: elements.map((e) => e.id),
      sources: elements[0].sources,
    });
  }
}
