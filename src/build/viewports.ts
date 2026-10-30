import type { DrawingText } from './building';
import type { Measurement, Sheet } from '../model';

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
