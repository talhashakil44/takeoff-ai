import type { Project } from '../model';
import type { BuildModel, SourceRef } from './types';
import type { DrawingText, DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import { structuralSections } from './structural';
import { roofViewportRegistrations } from './roofRegistration';
import { flatRoofSectionEvidence } from './flatRoofSectionEvidence';
import { recoverRoofBeamSpan } from './roofSpanEvidence';
import { worldPoint } from './sheetCoordinates';

/** Match the annotation's own baseline, not the closest number: ROOF and
 * T/O FLAT ROOF BEAM can overlap while referring to different elevations. */
export function flatRoofBeamDatum(
  project: Project,
  texts: DrawingTexts,
  lines: DrawingLines,
): { elevation: number; sources: SourceRef[] } | null {
  const found: {
    elevation: number;
    source: SourceRef;
    x: number;
    y: number;
  }[] = [];
  for (const sheet of project.sheets.filter(
    (s) =>
      !s.superseded &&
      /^S/.test(s.name) &&
      /SECTION|ELEVATION/i.test(s.title ?? ''),
  )) {
    const ts = texts[sheet.id] ?? [],
      ls = lines[sheet.id] ?? [];
    const numbers = (label: DrawingText) =>
      ts.filter(
        (t) =>
          /^\d{4,5}$/.test(t.str.trim()) &&
          Math.abs(t.cx - label.cx) < 65 &&
          t.cy > label.cy + 3 &&
          t.cy < label.cy + 15,
      );
    // Learn text spacing from unambiguous datum labels on this source sheet.
    const offsets = ts
      .filter((t) =>
        /^(?:T[/.]?O\b|ROOF$|SECOND FLOOR$|GROUND FLOOR$)/i.test(t.str.trim()),
      )
      .flatMap((t) => {
        const ns = numbers(t);
        return ns.length === 1 ? [ns[0].cy - t.cy] : [];
      })
      .sort((a, b) => a - b);
    if (offsets.length < 2) continue;
    const baseline = offsets[Math.floor(offsets.length / 2)];
    if (offsets.filter((v) => Math.abs(v - baseline) < 0.5).length < 2)
      continue;
    for (const label of ts.filter((t) =>
      /^T[/.]?O FLAT ROOF BEAM$/i.test(t.str.trim()),
    )) {
      const ns = numbers(label).filter(
        (t) => Math.abs(t.cy - label.cy - baseline) < 0.5,
      );
      if (ns.length !== 1) continue;
      // Datum leader lies midway between the label and its numeric baseline.
      const leaderY = label.cy + baseline / 2;
      const leaders = ls.filter(
        (l) =>
          !l.filled &&
          !l.curve &&
          Math.abs(l.y1 - l.y2) < 0.05 &&
          Math.abs(l.y1 - leaderY) < 0.5 &&
          Math.abs((l.x1 + l.x2) / 2 - label.cx) < 90 &&
          Math.abs(l.x2 - l.x1) > 3,
      );
      if (leaders.length < 3) continue;
      found.push({
        elevation: +ns[0].str / 1000,
        x: label.cx,
        y: label.cy,
        source: {
          kind: 'sheet',
          id: sheet.id,
          page: sheet.page,
          label: sheet.name,
          box: [label.cx - 60, label.cy - 8, ns[0].cx + 20, ns[0].cy + 8],
          quote: `${label.str} ${ns[0].str}; numeric baseline and datum leader independently matched; not the adjacent roof-surface datum.`,
        },
      });
    }
  }
  if (
    found.length < 2 ||
    !found.some((a) =>
      found.some(
        (b) =>
          a !== b &&
          (a.source.id !== b.source.id ||
            Math.hypot(a.x - b.x, a.y - b.y) > 100),
      ),
    )
  )
    return null;
  if (found.some((a) => Math.abs(a.elevation - found[0].elevation) > 0.001))
    return null;
  return { elevation: found[0].elevation, sources: found.map((a) => a.source) };
}

/** Only measured two-endpoint low-roof beams: no column heights, count-derived
 * spans or canopy locations are inferred from these flat roof datums. */
export function connectFlatRoofMembers(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
): BuildModel {
  const datum = flatRoofBeamDatum(project, texts, lines);
  if (!datum) return model;
  const regs = roofViewportRegistrations(project, model, texts),
    sections = structuralSections(project, texts);
  return {
    ...model,
    elements: model.elements.map((e) => {
      const m = project.measurements.find((m) => m.id === e.measurementId),
        r = regs[e.measurementId],
        code = e.typeName.match(/^(B\d+)\b/)?.[1],
        sec = code ? sections[code] : undefined;
      if (
        !m ||
        !r ||
        !/^LOW ROOF/i.test(r.title) ||
        !sec ||
        sec.conflict ||
        m.points.length !== 2 ||
        project.types.find((t) => t.id === e.typeId)?.kind !== 'linear'
      )
        return e;
      const recovered = recoverRoofBeamSpan(
        m.points,
        code!,
        r,
        texts[m.sheetId] ?? [],
        lines[m.sheetId] ?? [],
        Object.values(sections).filter((s) => /^C\d+$/.test(s.code)),
      );
      if (!recovered)
        return {
          ...e,
          shape: null,
          placement: 'unknown' as const,
          issues: [
            ...e.issues.filter(
              (i) =>
                !i.startsWith('Physical low-roof beam:') &&
                !i.startsWith('Low-roof bearing evidence:'),
            ),
            'Low-roof bearing evidence: source span cannot be assigned to drawn supports and matching member marks; physical geometry withheld.',
          ],
        };
      const detail = flatRoofSectionEvidence(
        project,
        m.sheetId,
        recovered,
        r,
        sec,
        texts,
        lines,
        datum.sources,
      );
      const points = recovered.map((p) => worldPoint(p, r.frame));
      if (
        Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) <
        0.02
      )
        return e;
      return {
        ...e,
        shape: {
          type: 'run' as const,
          points,
          z0: datum.elevation - sec.depth,
          height: sec.depth,
          thickness: sec.width,
          topPlane: [0, 0, datum.elevation] as [number, number, number],
          bottomPlane: [0, 0, datum.elevation - sec.depth] as [
            number,
            number,
            number,
          ],
        },
        placement: 'inferred' as const,
        sources: [
          ...new Map(
            [
              ...e.sources,
              r.source,
              sec.source,
              {
                kind: 'sheet' as const,
                id: m.sheetId,
                page: r.source.page,
                label: r.source.label,
                box: [
                  Math.min(...recovered.map((p) => p[0])) - 10,
                  Math.min(...recovered.map((p) => p[1])) - 25,
                  Math.max(...recovered.map((p) => p[0])) + 25,
                  Math.max(...recovered.map((p) => p[1])) + 10,
                ] as [number, number, number, number],
                quote: `${code}: bearing centres traced from closed scheduled column rectangles; matching member mark in every bay. Section tolerance8mm; fragment-to-bearing search maximum1.5m; takeoff quantity retained.`,
              },
              ...datum.sources,
              ...detail.sources,
            ].map((s) => [JSON.stringify(s), s]),
          ).values(),
        ],
        issues: [
          ...e.issues.filter(
            (i) =>
              !i.includes('no scale') &&
              !i.includes('Calibrated') &&
              !i.includes('plan only') &&
              !i.startsWith('Physical low-roof beam:') &&
              !i.startsWith('Flat-roof section'),
          ),
          ...detail.issues,
          'Physical low-roof beam: registered viewport, drawn column bearing centres and matching marks in every bay, scheduled section and corroborated flat-roof beam datum. Connections and bearings remain unmodelled. Source quantity is unchanged.',
        ],
      };
    }),
  };
}
