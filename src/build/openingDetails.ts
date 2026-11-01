import type { Project } from '../model';
import type { Segment } from '../fill/vectors';
import type { DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import type { SourceRef } from './types';
export interface OpeningDetail {
  code: string;
  width: number;
  height: number;
  sill: number;
  floor: number;
  source: SourceRef;
}
type Rect = { x0: number; y0: number; x1: number; y1: number };
/** Closed rectilinear frame outlines, not dimension extension lines. */
export function frameRectangles(lines: Segment[], region: Rect): Rect[] {
  const inBox = (l: Segment) =>
    Math.min(l.x1, l.x2) >= region.x0 &&
    Math.max(l.x1, l.x2) <= region.x1 &&
    Math.min(l.y1, l.y2) >= region.y0 &&
    Math.max(l.y1, l.y2) <= region.y1;
  const ls = lines.filter((l) => !l.curve && !l.dashed && inBox(l));
  let horizontal = ls
    .filter((l) => Math.abs(l.y2 - l.y1) < 0.15 && Math.abs(l.x2 - l.x1) > 8)
    .map((l) => ({ x0: Math.min(l.x1, l.x2), x1: Math.max(l.x1, l.x2), y: (l.y1 + l.y2) / 2 }));
  let vertical = ls
    .filter((l) => Math.abs(l.x2 - l.x1) < 0.15 && Math.abs(l.y2 - l.y1) > 10)
    .map((l) => ({ y0: Math.min(l.y1, l.y2), y1: Math.max(l.y1, l.y2), x: (l.x1 + l.x2) / 2 }));
  const merge = (items: { at: number; lo: number; hi: number }[]) => {
    const groups: { at: number; lo: number; hi: number }[] = [];
    for (const item of items.sort((a, b) => a.at - b.at || a.lo - b.lo)) {
      const found = groups.find((g) => Math.abs(g.at - item.at) < 0.3 && item.lo <= g.hi + 1 && item.hi >= g.lo - 1);
      if (found) {
        found.lo = Math.min(found.lo, item.lo);
        found.hi = Math.max(found.hi, item.hi);
      } else groups.push({ ...item });
    }
    return groups;
  };
  horizontal = merge(horizontal.map((h) => ({ at: h.y, lo: h.x0, hi: h.x1 }))).map((h) => ({ y: h.at, x0: h.lo, x1: h.hi }));
  vertical = merge(vertical.map((v) => ({ at: v.x, lo: v.y0, hi: v.y1 }))).map((v) => ({ x: v.at, y0: v.lo, y1: v.hi }));
  const supports = (x: number, y0: number, y1: number) =>
    vertical.some((v) => Math.abs(v.x - x) < 0.5 && v.y0 <= y0 + 0.5 && v.y1 >= y1 - 0.5);
  const rects: Rect[] = [];
  for (const a of horizontal)
    for (const b of horizontal) {
      if (b.y - a.y < 15 || Math.abs(a.x0 - b.x0) > 0.5 || Math.abs(a.x1 - b.x1) > 0.5) continue;
      if (supports(a.x0, a.y, b.y) && supports(a.x1, a.y, b.y)) rects.push({ x0: a.x0, y0: a.y, x1: a.x1, y1: b.y });
    }
  return rects;
}
/** Read drawn opening frames at their calibrated scale, retaining the schedule/detail source. */
export function readOpeningDetails(project: Project, texts: DrawingTexts, lines: DrawingLines): Record<string, OpeningDetail> {
  const details: Record<string, OpeningDetail> = {};
  for (const sheet of project.sheets.filter((s) => /WINDOW ELEVATION|WINDOW SCHEDULE/i.test(s.title ?? ''))) {
    const k = sheet.metersPerPoint;
    if (!k) continue;
    const ts = texts[sheet.id] ?? [],
      ls = lines[sheet.id] ?? [];
    const tags = ts.filter((t) => /^(?:W|CW|S)\d+[A-Z]?$/.test(t.str.trim()) && t.cx < sheet.width * 0.87);
    for (const tag of tags) {
      const sameRow = tags.filter((t) => Math.abs(t.cy - tag.cy) < 20),
        prevRow = tags.filter((t) => t.cy < tag.cy - 30);
      const left = sameRow.filter((t) => t.cx < tag.cx - 20).sort((a, b) => b.cx - a.cx)[0];
      const right = sameRow.filter((t) => t.cx > tag.cx + 20).sort((a, b) => a.cx - b.cx)[0];
      const y0 = Math.max(0, ...prevRow.map((t) => t.cy + 20));
      const region = {
        x0: left ? (left.cx + tag.cx) / 2 - 20 : tag.cx - 180,
        x1: right ? (right.cx + tag.cx) / 2 + 20 : tag.cx + 180,
        y0,
        y1: tag.cy - 10,
      };
      const rects = frameRectangles(ls, region).filter((r) => (r.x1 - r.x0) * k > 0.2 && (r.y1 - r.y0) * k > 0.3);
      rects.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
      if (!rects.length) continue;
      const frame = {
        x0: Math.min(...rects.map((r) => r.x0)),
        y0: Math.min(...rects.map((r) => r.y0)),
        x1: Math.max(...rects.map((r) => r.x1)),
        y1: Math.max(...rects.map((r) => r.y1)),
      };
      for (let pass = 0; pass < 2; pass++)
        for (const l of ls) {
          if (l.curve || l.dashed) continue;
          const lx = Math.min(l.x1, l.x2),
            rx = Math.max(l.x1, l.x2),
            ty = Math.min(l.y1, l.y2),
            by = Math.max(l.y1, l.y2);
          if (lx < region.x0 || rx > region.x1 || ty < region.y0 || by > region.y1) continue;
          if (
            Math.abs(l.x1 - l.x2) < 0.2 &&
            (Math.abs(lx - frame.x0) < 6 || Math.abs(lx - frame.x1) < 6) &&
            ty <= frame.y1 &&
            by >= frame.y0
          ) {
            frame.y1 = Math.max(frame.y1, by);
          }
        }
      const datums = ts.filter((t) => /FIN\.? (?:GROUND|SECOND|FIRST|MAIN) FLOOR/i.test(t.str) && t.cy > frame.y0 && t.cy < tag.cy + 15);
      datums.sort((a, b) => Math.abs(a.cy - frame.y1) - Math.abs(b.cy - frame.y1));
      const datum = datums[0];
      if (!datum) continue;
      const value = ts
        .filter((t) => /^\d{1,5}$/.test(t.str) && Math.abs(t.cy - datum.cy) < 5 && Math.abs(t.cx - datum.cx) < 140)
        .sort((a, b) => Math.abs(a.cx - datum.cx) - Math.abs(b.cx - datum.cx))[0];
      if (!value) continue;
      const datumZ = Number(value.str) / 1000;
      const datumLines = ls.filter((l) => Math.abs(l.y1 - l.y2) < 0.2 && Math.abs(l.y1 - datum.cy) < 8 && Math.abs(l.x2 - l.x1) > 80);
      datumLines.sort((a, b) => Math.abs(a.y1 - datum.cy) - Math.abs(b.y1 - datum.cy));
      const datumY = datumLines[0]?.y1 ?? datum.cy;
      let width = (frame.x1 - frame.x0) * k,
        height = (frame.y1 - frame.y0) * k,
        sill = (datumY - frame.y1) * k;
      const numbers = ts.filter((t) => /^\d{3,5}$/.test(t.str)).map((t) => ({ ...t, value: Number(t.str) / 1000 }));
      const wd = numbers
        .filter(
          (t) =>
            t.cy < frame.y0 &&
            frame.y0 - t.cy < 60 &&
            Math.abs(t.cx - (frame.x0 + frame.x1) / 2) < 40 &&
            t.value / width > 0.9 &&
            t.value / width < 1.4,
        )
        .sort((a, b) => Math.abs(a.cx - (frame.x0 + frame.x1) / 2) - Math.abs(b.cx - (frame.x0 + frame.x1) / 2))[0];
      const hd = numbers
        .filter(
          (t) =>
            (Math.abs(t.cx - frame.x0) < 75 || Math.abs(t.cx - frame.x1) < 75) &&
            t.cy > frame.y0 &&
            t.cy < frame.y1 &&
            t.value / height > 0.95 &&
            t.value / height < 1.1,
        )
        .sort((a, b) => b.cx - a.cx)[0];
      const sd = numbers
        .filter((t) => t.cx < frame.x0 && frame.x0 - t.cx < 75 && t.cy > frame.y1 && t.cy < tag.cy && Math.abs(t.value - sill) < 0.3)
        .sort((a, b) => b.cx - a.cx)[0];
      if (wd) width = wd.value;
      if (hd) height = hd.value;
      if (sd) sill = sd.value;
      if (sill < -0.05 || sill > 4) continue;
      const code = tag.str.trim();
      details[code] = {
        code,
        width,
        height,
        sill: Math.max(0, sill),
        floor: datumZ,
        source: {
          kind: 'sheet',
          id: sheet.id,
          page: sheet.page,
          label: sheet.name,
          box: [frame.x0 - 30, frame.y0 - 30, frame.x1 + 30, tag.cy + 20],
          quote: `${code}: dimensions from calibrated frame outline and floor datum`,
        },
      };
    }
  }
  return details;
}
