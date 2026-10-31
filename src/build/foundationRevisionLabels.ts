import type { DrawingText } from './building';
import type { DrawingLines } from './roof';
import { sheetPoint, type SheetFrame } from './sheetCoordinates';
import type { BuildModel } from './types';

const label = 'Revised foundation wall label';
const prefix = 'Foundation revision type conflict:';
const code = (s: string) => /^FW-?\d+\b/i.exec(s)?.[0].toUpperCase().replace('-', '');

/** A perpendicular leader ending on the accepted axis can establish a revised
 * type label, but cannot establish revised extents, elevation or a physical solid. */
export function explainFoundationRevisionLabels(model: BuildModel, plan: {
  docId: string; page: number; sheetId: string; frame: SheetFrame;
  texts: DrawingText[]; lines: DrawingLines[string];
}): BuildModel {
  const scale = Math.hypot(plan.frame.a, plan.frame.b);
  if (!(scale > 0) || !Number.isFinite(scale)) return model;
  const tags = plan.texts.filter(t => /^FW-?\d+$/i.test(t.str.trim()));
  const pens = plan.lines.filter(l => !l.filled && !l.curve && (!l.color || l.color === '#000000'));
  return { ...model, elements: model.elements.map(e => {
    const clean = { ...e, sources: e.sources.filter(s => s.label !== label), issues: e.issues.filter(i => !i.startsWith(prefix)) };
    if (e.measurementSource !== 'foundations' || e.sheetId !== plan.sheetId ||
        !code(e.typeName) || e.shape?.type !== 'axis' ||
        !clean.issues.some(i => i.startsWith('Foundation revision unresolved:'))) return clean;
    const points = e.shape.points.map(p => sheetPoint(p, plan.frame));
    const matches: { tag: DrawingText; box: [number, number, number, number] }[] = [];
    for (let n = 1; n < points.length; n++) {
      const p = points[n - 1], q = points[n];
      const axis = Math.abs(q[0] - p[0]) > Math.abs(q[1] - p[1]) ? 0 : 1, cross = 1 - axis;
      if (Math.abs(q[cross] - p[cross]) * scale > .03) continue;
      const centre = (p[cross] + q[cross]) / 2;
      for (const l of pens) {
        const a = [l.x1, l.y1], b = [l.x2, l.y2];
        if (Math.abs(a[axis] - b[axis]) > .3 || Math.abs(a[cross] - b[cross]) < 12) continue;
        const tip = Math.abs(a[cross] - centre) < Math.abs(b[cross] - centre) ? a : b;
        const tail = tip === a ? b : a;
        if (Math.abs(tip[cross] - centre) * scale > .06 || tip[axis] < Math.min(p[axis], q[axis]) || tip[axis] > Math.max(p[axis], q[axis])) continue;
        const near = tags.filter(t => {
          const c = [t.cx, t.cy];
          const half = (cross === 0 ? t.w : t.h);
          if (!half || !Number.isFinite(half)) return false;
          return Math.abs(c[axis] - tail[axis]) < 3 &&
            Math.abs(c[cross] - tail[cross]) <= half / 2 + 9 &&
            (c[cross] - tail[cross]) * (tip[cross] - tail[cross]) < 0;
        });
        if (near.length !== 1) continue;
        // A heavy target bar centred at the leader tip distinguishes a wall
        // callout from a grid/dimension line passing near the measurement.
        if (!pens.some(v => v.width > l.width * 1.8 &&
          Math.hypot((v.x1 + v.x2) / 2 - tip[0], (v.y1 + v.y2) / 2 - tip[1]) < 1 &&
          Math.abs((axis === 0 ? v.x2 - v.x1 : v.y2 - v.y1)) < .3)) continue;
        const tag = near[0];
        matches.push({ tag, box: [Math.min(tag.cx - (tag.w ?? 0) / 2, tip[0]) - 5,
          Math.min(tag.cy - (tag.h ?? 0) / 2, tip[1]) - 5,
          Math.max(tag.cx + (tag.w ?? 0) / 2, tip[0]) + 5,
          Math.max(tag.cy + (tag.h ?? 0) / 2, tip[1]) + 5] });
      }
    }
    const codes = new Set(matches.map(m => code(m.tag.str)));
    if (codes.size !== 1) return clean; // conflicting leaders are not a type decision
    const revised = matches[0].tag.str;
    const conflict = code(revised) !== code(e.typeName);
    return { ...clean, issues: conflict ? [...clean.issues,
      `${prefix} revised plan identifies ${revised} at a location on this accepted ${code(e.typeName)} axis. Reconcile the re-issued drawing, wall extents and quantities before using physical geometry; the original takeoff is unchanged.`] : clean.issues,
      sources: [...clean.sources, { kind: 'spec' as const, id: plan.docId, page: plan.page, label,
        quote: `Revised leader identifies ${revised} at this accepted axis. ${conflict ? 'Type differs from the original takeoff.' : 'Matching type does not validate old extents.'} Revised extents and elevations still require reconciliation.`,
        box: matches[0].box }] };
  }) };
}
