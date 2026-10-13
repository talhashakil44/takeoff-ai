import type { PageText } from './pageText';

/** x0, y0, x1, y1 in sheet points. */
export type Box = [number, number, number, number];

/** A box on one sheet as fractions of its width and height, so the same spot can be found on other sheets. */
export function relativeBox([ax, ay, bx, by]: Box, width: number, height: number): Box {
  return [Math.min(ax, bx) / width, Math.min(ay, by) / height, Math.max(ax, bx) / width, Math.max(ay, by) / height];
}

/** The same spot on a sheet of this size. */
export const onSheet = ([x0, y0, x1, y1]: Box, width: number, height: number): Box => [x0 * width, y0 * height, x1 * width, y1 * height];

export interface Line {
  text: string;
  /** Height of its capitals: the sheet number is usually the biggest text in its box. */
  h: number;
}

/** The text inside a box, as lines in reading order (title blocks turned on their side read too). */
export function linesIn(texts: PageText[], [x0, y0, x1, y1]: Box): Line[] {
  const inside = texts.filter((t) => t.str.trim() && t.cx >= x0 && t.cx <= x1 && t.cy >= y0 && t.cy <= y1);
  if (!inside.length) return [];
  // Text running up or down the sheet: read it by swapping the axes.
  const vertical = inside.filter((t) => Math.abs(Math.sin(t.angle ?? 0)) > 0.7).length > inside.length / 2;
  const across = (t: PageText) => (vertical ? -t.cx : t.cy);
  const along = (t: PageText) => (vertical ? t.cy * (Math.sin(t.angle ?? 0) > 0 ? 1 : -1) : t.cx);
  const sorted = [...inside].sort((a, b) => across(a) - across(b) || along(a) - along(b));
  const lines: { items: PageText[]; at: number; h: number }[] = [];
  for (const t of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(across(t) - line.at) < 0.6 * Math.max(line.h, t.h)) {
      line.items.push(t);
      line.h = Math.max(line.h, t.h);
    } else lines.push({ items: [t], at: across(t), h: t.h });
  }
  return lines.map((l) => ({
    text: l.items
      .sort((a, b) => along(a) - along(b))
      .map((t) => t.str.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    h: l.h,
  }));
}

/** Title block captions beside the number or title: "SHEET NO.", "DRAWING TITLE:", "DWG #". */
const CAPTION = /^(?:(?:sheet|drawing|dwg)\s*(?:no|number|#|title|name)?|no|number|title|name)\s*[.:#]*\s*/i;
const ONLY_CAPTION = /^(?:(?:sheet|drawing|dwg|project)\s*)?(?:no|number|#|title|name|scale|date|drawn|checked|revision|rev)?\s*[.:#]*$/i;
/** A sheet number: A2.1, A-101, M2.01, S1, AD-1, E101A. */
const SHEET_NUMBER = /^[A-Z]{1,4}[-. ]?\d{1,4}(?:[.-]\d{1,3})*[A-Z]?$/i;

const uncaption = (s: string) => s.replace(CAPTION, '').trim();

/** The sheet number among the lines read from its box, or '' when there is none. */
export function readNumber(lines: Line[]): string {
  const byHeight = [...lines].sort((a, b) => b.h - a.h);
  for (const l of byHeight) {
    const text = uncaption(l.text);
    if (SHEET_NUMBER.test(text)) return text.replace(/\s+/g, '');
  }
  for (const l of byHeight) {
    const token = l.text.split(' ').find((w) => SHEET_NUMBER.test(w));
    if (token) return token;
  }
  // No usual pattern: the biggest text that isn't a caption.
  const text = byHeight.map((l) => uncaption(l.text)).find((t) => t && !ONLY_CAPTION.test(t));
  return text ?? '';
}

/** The sheet title read from its box: its lines in order, captions left out. */
export function readTitle(lines: Line[]): string {
  return lines
    .filter((l) => !ONLY_CAPTION.test(l.text))
    .map((l) => uncaption(l.text))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
