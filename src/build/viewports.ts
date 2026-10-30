import { gridAxes, matchGridAxes, type DrawingText, type DrawingTexts, type Registration } from './building';
import type { Measurement, Project, Sheet } from '../model';

export interface ViewportLevel {
  id: string;
  title: string;
  dividerX: number;
}

/**
 * Resolve side-by-side plan levels only when two labelled viewports and a clear
 * gap in their takeoffs agree. This identifies the level, not a building XY
 * registration for the viewport's paper coordinates.
 */
export function viewportLevels(sheet: Sheet, texts: DrawingText[], measurements: Measurement[]): Map<string, ViewportLevel> {
  const titles = texts.flatMap((t) => {
    const title = t.str.trim();
    const match = /^L(?:EVEL)?\s*(\d{1,2})\s*[-–:]\s*(?:PLUMBING|HVAC|HEATING|MECHANICAL)\b/i.exec(title);
    return match && title.length < 48 && t.cy > sheet.height * 0.72 && t.cx < sheet.width * 0.8
      ? [{ id: `L${Number(match[1])}`, title, x: t.cx, y: t.cy }]
      : [];
  }).sort((a, b) => a.x - b.x);
  if (titles.length !== 2 || titles[0].id === titles[1].id ||
      titles[1].x - titles[0].x < sheet.width * 0.2 ||
      Math.abs(titles[0].y - titles[1].y) > sheet.height * 0.08) return new Map();

  const centers = measurements
    .filter((m) => m.points.length > 0)
    .map((m) => m.points.reduce((sum, p) => sum + p[0], 0) / m.points.length)
    .sort((a, b) => a - b);
  const minSide = Math.max(1, Math.min(5, Math.floor(centers.length * 0.05)));
  const gaps = centers.slice(1).flatMap((right, i) => {
    const left = centers[i], middle = (left + right) / 2;
    return i + 1 >= minSide && centers.length - i - 1 >= minSide &&
      middle > titles[0].x && middle < titles[1].x &&
      right - left > Math.max(40, sheet.width * 0.04)
      ? [{ middle, width: right - left }]
      : [];
  }).sort((a, b) => b.width - a.width);
  if (!gaps.length) return new Map();
  const dividerX = gaps[0].middle;
  const found = new Map<string, ViewportLevel>();
  for (const m of measurements) {
    if (!m.points.length) continue;
    const side = m.points.every((p) => p[0] < dividerX) ? 0 :
      m.points.every((p) => p[0] > dividerX) ? 1 : -1;
    if (side >= 0) found.set(m.id, { id: titles[side].id, title: titles[side].title, dividerX });
  }
  return found;
}

/** Independently fit each side's letter and number grid to the architectural plan. */
export function registerViewportMeasurements(project: Project, texts: DrawingTexts, levels: Map<string, ViewportLevel>): Map<string, Registration> {
  const registered = new Map<string, Registration>();
  if (!levels.size) return registered;
  const references = project.sheets
    .filter((s) => s.metersPerPoint && !s.superseded && /PLAN/i.test(s.title ?? '') && !/DETAIL|ENLARG|SITE/i.test(s.title ?? ''))
    .map((s) => {
      const points = project.measurements.filter((m) => m.sheetId === s.id).flatMap((m) => m.points);
      const median = (axis: number) => points.map((p) => p[axis]).sort((a, b) => a - b)[Math.floor(points.length / 2)];
      const focus: [number, number] | undefined = points.length ? [median(0), median(1)] : undefined;
      return { sheet: s, axes: gridAxes(texts[s.id] ?? [], s.width, s.height, focus) };
    })
    .sort((a, b) => Object.keys(b.axes).length - Object.keys(a.axes).length);
  const reference = references[0];
  if (!reference) return registered;
  const bySheet = new Map<string, Measurement[]>();
  for (const measurement of project.measurements) if (levels.has(measurement.id))
    bySheet.set(measurement.sheetId, [...(bySheet.get(measurement.sheetId) ?? []), measurement]);
  for (const [sheetId, measurements] of bySheet) {
    const sheet = project.sheets.find((s) => s.id === sheetId);
    if (!sheet?.metersPerPoint || sheet.superseded) continue;
    const divider = levels.get(measurements[0].id)!.dividerX;
    for (const side of [0, 1]) {
      const origin = side ? divider : 0;
      const width = side ? sheet.width - divider : divider;
      const localTexts = (texts[sheetId] ?? [])
        .filter((t) => side ? t.cx > divider : t.cx < divider)
        .map((t) => ({ ...t, cx: t.cx - origin }));
      // Widen the analysis window only for gridAxes' right-margin exclusion:
      // bubbles near a viewport's right edge are valid, unlike title-block marks.
      const axes = gridAxes(localTexts, width * 1.2, sheet.height);
      const absolute = Object.fromEntries(Object.entries(axes).map(([key, axis]) =>
        [key, { ...axis, at: axis.axis === 'x' ? axis.at + origin : axis.at }]));
      const matched = matchGridAxes(absolute, sheet.metersPerPoint, reference.axes, reference.sheet.metersPerPoint!);
      if (!matched || matched.grids.filter((key) => /^[A-Z]$/.test(key)).length < 3 ||
          matched.grids.filter((key) => /^\d+$/.test(key)).length < 3) continue;
      for (const measurement of measurements) if ((measurement.points[0][0] > divider ? 1 : 0) === side)
        registered.set(measurement.id, matched);
    }
  }
  return registered;
}
