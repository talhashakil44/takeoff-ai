import { recoverRoofBeamSpan } from './roofSpanEvidence';
import type { Project } from '../model';
import type { BuildModel } from './types';
import type { DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import { structuralSections } from './structural';
import { roofViewportRegistrations } from './roofRegistration';
import { roofBeamPlane } from './roofBeamPlane';
import { worldPoint } from './sheetCoordinates';
/** High-roof measured spans only. Keep multi-scale low-roof/canopy records
 * unresolved rather than applying the high-roof transform to a whole sheet. */
export function connectRoofMembers(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
): BuildModel {
  const regs = roofViewportRegistrations(project, model, texts),
    plane = roofBeamPlane(project, model, texts, lines),
    sections = structuralSections(project, texts);
  if (!plane) return model;
  const girts = new Set(
    Object.values(texts).flatMap((ts) =>
      ts
        .filter((t) => /^GIRT$/i.test(t.str.trim()))
        .flatMap((g) =>
          ts
            .filter(
              (t) =>
                /^B\d+$/.test(t.str.trim()) &&
                Math.abs(t.cx - g.cx) < 30 &&
                Math.abs(t.cy - g.cy) < 30,
            )
            .map((t) => t.str.trim()),
        ),
    ),
  );
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
        girts.has(code ?? '') ||
        !/^HIGH ROOF/i.test(r.title) ||
        !sec ||
        sec.conflict ||
        m.points.length !== 2 ||
        project.types.find((t) => t.id === e.typeId)?.kind !== 'linear'
      )
        return e;
      const conflicting = project.measurements.some((other) => {
        if (
          other.id === m.id ||
          other.sheetId !== m.sheetId ||
          other.points.length !== 2
        )
          return false;
        const otherCode = project.types
          .find((t) => t.id === other.typeId)
          ?.name.match(/^(B\d+)\b/)?.[1];
        if (!otherCode || otherCode === code) return false;
        const close = (a: number[], b: number[]) =>
          Math.hypot(a[0] - b[0], a[1] - b[1]) * r.metersPerPoint < 0.02;
        return (
          (close(m.points[0], other.points[0]) &&
            close(m.points[1], other.points[1])) ||
          (close(m.points[0], other.points[1]) &&
            close(m.points[1], other.points[0]))
        );
      });
      if (conflicting)
        return {
          ...e,
          shape: null,
          issues: [
            ...e.issues.filter(
              (i) => !i.startsWith('Physical high-roof beam:'),
            ),
            'Conflicting beam marks share this measured span; resolve the source bay before physical placement.',
          ],
        };
      const sourcePoints = recoverRoofBeamSpan(
        m.points,
        code!,
        r,
        texts[m.sheetId] ?? [],
        lines[m.sheetId] ?? [],
        Object.values(sections).filter((s) => /^C\d+$/.test(s.code)),
      );
      if (!sourcePoints)
        return {
          ...e,
          shape: null,
          issues: [
            ...e.issues.filter(
              (i) => !i.startsWith('Physical high-roof beam:'),
            ),
            'Roof beam bearings could not be matched to drawn supports and bay labels.',
          ],
        };
      const pts = sourcePoints.map((p) => worldPoint(p, r.frame));
      if (
        pts.some(
          (p, i) =>
            i > 0 &&
            Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) < 0.02,
        )
      )
        return e;
      const [gx, gy, z] = plane.topPlane;
      const span = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      const pitch =
        (gx * (pts[1][0] - pts[0][0]) + gy * (pts[1][1] - pts[0][1])) / span;
      const verticalDepth = sec.depth * Math.sqrt(1 + pitch * pitch),
        bottom: [number, number, number] = [gx, gy, z - verticalDepth];
      const tops = pts.map((p) => gx * p[0] + gy * p[1] + z);
      if (
        tops.some(
          (h) =>
            h < Math.min(...plane.heights) - 0.2 ||
            h > Math.max(...plane.heights) + 0.2,
        )
      )
        return e;
      return {
        ...e,
        shape: {
          type: 'run' as const,
          points: pts,
          z0: Math.min(...tops) - verticalDepth,
          height: verticalDepth,
          thickness: sec.width,
          topPlane: plane.topPlane,
          bottomPlane: bottom,
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
                  Math.min(...sourcePoints.map((p) => p[0])) - 10,
                  Math.min(...sourcePoints.map((p) => p[1])) - 25,
                  Math.max(...sourcePoints.map((p) => p[0])) + 25,
                  Math.max(...sourcePoints.map((p) => p[1])) + 10,
                ] as [number, number, number, number],
                quote: `${code}: bearing centres traced from closed scheduled column rectangles, with a matching beam mark in each bay; source takeoff quantity retained.`,
              },
              ...plane.sources,
            ].map((s) => [JSON.stringify(s), s]),
          ).values(),
        ],
        issues: [
          ...e.issues.filter(
            (i) =>
              !i.startsWith('Physical high-roof beam:') &&
              !i.startsWith('Roof framing detail:') &&
              !i.includes('no scale') &&
              !i.includes('Calibrated') &&
              !i.includes('plan only'),
          ),
          ...((texts[m.sheetId] ?? []).some(
            (t) =>
              /CANT/i.test(t.str) &&
              t.cx > Math.min(...sourcePoints.map((p) => p[0])) - 25 &&
              t.cx < Math.max(...sourcePoints.map((p) => p[0])) + 25 &&
              Math.abs(t.cy - sourcePoints[0][1]) < 30,
          )
            ? [
                'Roof framing detail: cantilever callout applies near this member. Current support-to-support envelope does not establish free-end extensions or continuous-member connections.',
              ]
            : []),
          `Physical high-roof beam: viewport scale and ${r.grids.length} matching grids; drawn bearing centres associated with the measured span and schedule section; top tied to structural beam datums. Connections and bearings remain unmodelled. Source quantity is unchanged.`,
        ],
      };
    }),
  };
}
