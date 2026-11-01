import type { Project, Pt } from '../model';
import type { SourceRef } from './types';
import type { DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import type { RoofViewportRegistration } from './roofRegistration';
import type { StructuralSection } from './structural';
/** Audit a horizontal plan member against a section cut on a numbered grid.
 * Failure to find a direct cut leaves applicability inferred, never verified. */
export function flatRoofSectionEvidence(
  project: Project,
  sheetId: string,
  points: Pt[],
  r: RoofViewportRegistration,
  sec: StructuralSection,
  texts: DrawingTexts,
  lines: DrawingLines,
  datums: SourceRef[],
): { sources: SourceRef[]; issues: string[] } {
  const fallback =
    'Flat-roof section applicability: the beam-top datum agrees across sections; this individual bay has no mechanically matched section cut. Bearing connections and detail applicability remain inferred.';
  if (points.length < 2 || Math.abs(points[0][1] - points.at(-1)![1]) > 0.3)
    return { sources: [], issues: [fallback] };
  const ts = texts[sheetId] ?? [],
    y = points[0][1],
    lo = Math.min(...points.map((p) => p[0])),
    hi = Math.max(...points.map((p) => p[0]));
  const letter = ts
    .filter(
      (t) =>
        /^[A-Z]$/.test(t.str.trim()) &&
        Math.abs(t.cy - y) < 15 &&
        t.cx < r.bounds[0],
    )
    .sort((a, b) => Math.abs(a.cy - y) - Math.abs(b.cy - y))[0];
  if (!letter) return { sources: [], issues: [fallback] };
  const sources: SourceRef[] = [],
    issues: string[] = [];
  for (const ref of ts.filter(
    (t) =>
      /^S\d/.test(t.str.trim()) &&
      t.cy < r.bounds[1] &&
      r.bounds[1] - t.cy < 150,
  )) {
    const number = ts.find(
      (t) =>
        /^\d+$/.test(t.str.trim()) &&
        Math.abs(t.cx - ref.cx) < 2 &&
        ref.cy - t.cy > 8 &&
        ref.cy - t.cy < 18,
    );
    if (!number) continue;
    const grids = ts.filter(
      (t) =>
        /^\d+$/.test(t.str.trim()) &&
        t.cy < ref.cy &&
        Math.abs(t.cx - ref.cx) < 20 &&
        ts.filter(
          (u) => /^\d+$/.test(u.str.trim()) && Math.abs(u.cy - t.cy) < 1,
        ).length >= 3,
    );
    if (grids.length !== 1 || grids[0].cx < lo - 2 || grids[0].cx > hi + 2)
      continue;
    const sheet = project.sheets.find(
      (s) => s.name === ref.str.trim() && !s.superseded,
    );
    if (!sheet) continue;
    const st = texts[sheet.id] ?? [],
      sl = lines[sheet.id] ?? [];
    const title = st.find((t) =>
      new RegExp(`^BUILDING SECTION\\s*-\\s*${number.str.trim()}$`, 'i').test(
        t.str.trim(),
      ),
    );
    if (!title) continue;
    const scaleText = st.find(
      (t) =>
        /1\s*:\s*\d+/.test(t.str) &&
        t.cy > title.cy &&
        t.cy - title.cy < 25 &&
        Math.abs(t.cx - title.cx) < 110,
    );
    const scaleMatch = scaleText?.str.match(/1\s*:\s*(\d+)/);
    if (!scaleMatch) continue;
    const scale = (+scaleMatch[1] * 0.0254) / 72;
    const grid = st
      .filter(
        (t) =>
          t.str.trim() === letter.str.trim() &&
          t.cx > title.cx - 50 &&
          t.cx < title.cx + 850 &&
          t.cy < title.cy - 100 &&
          title.cy - t.cy < 650,
      )
      .sort((a, b) => b.cy - a.cy)[0];
    if (!grid) continue;
    for (const datum of datums.filter(
      (d) =>
        d.id === sheet.id &&
        d.box &&
        d.box[0] > title.cx &&
        d.box[0] < title.cx + 850 &&
        d.box[1] > grid.cy &&
        d.box[1] < title.cy,
    )) {
      const leaderY = (datum.box![1] + datum.box![3]) / 2;
      const tops = sl.filter(
        (l) =>
          l.color === '#000000' &&
          !l.filled &&
          !l.curve &&
          Math.abs(l.y1 - l.y2) < 0.05 &&
          Math.abs(l.y1 - leaderY) < 0.5 &&
          Math.abs((l.x1 + l.x2) / 2 - grid.cx) * scale < 0.35 &&
          Math.abs(l.x2 - l.x1) * scale > 0.08 &&
          Math.abs(l.x2 - l.x1) * scale < 0.5,
      );
      for (const top of tops) {
        const bottom = sl.find(
          (l) =>
            l.color === '#000000' &&
            Math.abs(l.y1 - l.y2) < 0.05 &&
            Math.abs((l.y1 - top.y1) * scale - sec.depth) < 0.012 &&
            Math.abs(Math.min(l.x1, l.x2) - Math.min(top.x1, top.x2)) < 0.2 &&
            Math.abs(Math.max(l.x1, l.x2) - Math.max(top.x1, top.x2)) < 0.2,
        );
        if (!bottom) continue;
        const width = Math.abs(top.x2 - top.x1) * scale;
        sources.push({
          kind: 'sheet',
          id: sheet.id,
          page: sheet.page,
          label: sheet.name,
          box: [grid.cx - 20, top.y1 - 10, grid.cx + 25, bottom.y1 + 10],
          quote: `${title.str}, grid ${letter.str}, plan cut at grid ${grids[0].str}: black beam top at flat-roof datum; traced depth ${(sec.depth * 1000).toFixed(0)}mm, drawn width ${(width * 1000).toFixed(0)}mm. Section scale ${scaleText!.str}.`,
        });
        issues.push(
          `Flat-roof section applicability: matched ${number.str}/${sheet.name} at grid ${grids[0].str}/${letter.str}. This cut corroborates the beam top and depth; connection details and extension through the bay remain inferred.`,
        );
        if (Math.abs(width - sec.width) > 0.015)
          issues.push(
            `Flat-roof section discrepancy: ${sec.code} schedule width ${(sec.width * 1000).toFixed(0)}mm differs from approximately ${(width * 1000).toFixed(0)}mm drawn at ${number.str}/${sheet.name}, grid ${letter.str}. Geometry retains the schedule size; resolve the drawing/detail discrepancy before treating it as verified.`,
          );
      }
    }
  }
  return {
    sources: [...new Map(sources.map((s) => [JSON.stringify(s), s])).values()],
    issues: issues.length ? [...new Set(issues)] : [fallback],
  };
}
