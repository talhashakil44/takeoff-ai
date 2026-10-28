import type { PageText } from '../pageText';

/**
 * The drawings on a sheet, by their titles: "1 ENLARGED LEVEL 1 FLOOR PLAN, SCALE: 1/4" = 1'-0"",
 * "5 OPERABLE PARTITION BEAM SECTION DETAIL". A callout bubble on another sheet (5 over A5.0)
 * points at one by its number, so following it lands on that drawing, not just the sheet.
 */
export interface View {
  /** Its number in the title bubble (1, 5, A). */
  number: string;
  title: string;
  /** The title (number, name and scale): x0, y0, x1, y1. */
  titleBox: [number, number, number, number];
  /** Roughly the drawing itself, above its title, for bringing it into view. */
  box: [number, number, number, number];
}

const level = (t: PageText) => !t.angle || Math.abs(Math.sin(t.angle)) < 0.1;
/** A view title's scale line, or its NOT TO SCALE. */
const SCALE_LINE = /^SCALE\s*:?\s*(?=.*\d)|^(N\.?T\.?S\.?|NOT TO SCALE)$/i;
const NUMBER = /^(?:[A-Z]?\d{1,2}[A-Z]?|[A-Z])$/;

export function findViews(texts: PageText[], sheetW: number, sheetH: number): View[] {
  const flat = texts.filter(level);
  const out: View[] = [];
  for (const sc of flat) {
    // SCALE: with its value, or with the value written beside it.
    const lone = /^SCALE\s*:$/i.test(sc.str.trim()) && flat.some((o) => o !== sc && Math.abs(o.cy - sc.cy) < 0.4 * sc.h && o.cx > sc.cx && o.cx - o.w / 2 - (sc.cx + sc.w / 2) < 3 * sc.h && /\d|N\.?T\.?S|NOT TO/i.test(o.str));
    if (!lone && !SCALE_LINE.test(sc.str.trim())) continue;
    const x0 = sc.cx - sc.w / 2;
    // The title: the lines just above the scale, lined up with it on the left (or centred over it).
    const lines: PageText[] = [];
    let cur = sc;
    for (let k = 0; k < 4; k++) {
      const up = flat
        .filter((o) => o !== sc && !lines.includes(o) && o.cy < cur.cy - 0.3 * cur.h && cur.cy - o.cy < 2.6 * Math.max(o.h, cur.h) && (Math.abs(o.cx - o.w / 2 - x0) < 12 || Math.abs(o.cx - sc.cx) < 12 || (lone && o.cx - o.w / 2 - x0 > -12 && o.cx - o.w / 2 - x0 < 90)) && /[A-Z]{2}/i.test(o.str) && !NUMBER.test(o.str.trim()))
        .sort((a, b) => b.cy - a.cy)[0];
      if (!up) break;
      lines.unshift(up);
      cur = up;
    }
    if (!lines.length) continue;
    const top = Math.min(...lines.map((t) => t.cy - t.h));
    const th = Math.max(...lines.map((t) => t.h));
    // Its number: a short code in the bubble beside the title, the largest near it.
    const num = flat
      .filter((o) => NUMBER.test(o.str.trim()) && o.cy > top - 2 * th && o.cy < sc.cy + 2 * th && Math.abs(o.cx - sc.cx) < 260 && !lines.includes(o) && o !== sc && (o.cx < x0 || o.cx > Math.max(...lines.map((t) => t.cx + t.w / 2))))
      .sort((a, b) => b.h - a.h || Math.abs(a.cx - x0) - Math.abs(b.cx - x0))[0];
    // Or its number written into the title (C-UNIVERSAL WASHROOM 029, DETAIL 3 - …).
    const inTitle = /^([A-Z0-9]{1,2})\s*[-–:]\s*\S/.exec(lines[0].str.trim());
    if (!num && !inTitle) continue;
    const parts = [...(num ? [num] : []), sc, ...lines];
    const tb: [number, number, number, number] = [Math.min(...parts.map((t) => t.cx - t.w / 2)) - 6, Math.min(...parts.map((t) => t.cy - t.h)) - 6, Math.max(...parts.map((t) => t.cx + t.w / 2)) + 6, Math.max(...parts.map((t) => t.cy + t.h)) + 6];
    const w = Math.min(sheetW * 0.5, 700);
    out.push({
      number: num ? num.str.trim() : inTitle![1],
      title: lines
        .map((t) => t.str.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .replace(num ? /^$/ : /^[A-Z0-9]{1,2}\s*[-–:]\s*/, ''),
      titleBox: tb,
      box: [Math.max(0, tb[0] - 30), Math.max(0, tb[1] - Math.min(sheetH * 0.45, 520)), Math.min(sheetW, tb[0] + w), tb[3]],
    });
  }
  // One per number (a title read twice).
  const seen = new Set<string>();
  return out.filter((v) => (seen.has(v.number) ? false : (seen.add(v.number), true)));
}
