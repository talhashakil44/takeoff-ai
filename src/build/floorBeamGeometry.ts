import type { Project } from '../model';
import type { BuildModel, SourceRef } from './types';
import type { DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import { structuralSections } from './structural';
import { recoverRoofBeamSpan } from './roofSpanEvidence';
import { worldPoint } from './sheetCoordinates';
import { structuralRevisionContext } from './structuralRevisions';

/** Floor beams are below the documented CLT/topping assembly, not at the plan's
 * storey datum. Require drawn section edges at that same top and schedule depth
 * before extruding measured beam axes. No correction to source quantities. */
export function connectFloorBeams(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
): BuildModel {
  const revision = structuralRevisionContext(project, texts, lines);
  if (revision.pending)
    return {
      ...model,
      elements: model.elements.map((e) =>
        e.trade === 'structure' && e.shape?.type === 'axis'
          ? {
              ...e,
              issues: [
                ...new Set([
                  ...e.issues,
                  'Floor revision evidence pending: latest structural replacement pages or coordinate agreement unavailable; physical solid withheld.',
                ]),
              ],
            }
          : e,
      ),
    };
  project = revision.project;
  texts = revision.texts;
  lines = revision.lines;
  const sections = structuralSections(project, texts);
  return {
    ...model,
    elements: model.elements.map((e) => {
      if (e.shape?.type !== 'axis' || e.trade !== 'structure') return e;
      const sheet = project.sheets.find((s) => s.id === e.sheetId);
      const level = model.levels.find((l) => l.id === e.level);
      const above = model.levels
        .filter(
          (l) =>
            !['roof', 'fdn'].includes(l.id) &&
            l.elevation > (level?.elevation ?? Infinity),
        )
        .sort((a, b) => a.elevation - b.elevation)[0];
      const sec = sections[e.typeName.match(/^(B\d+)\b/)?.[1] ?? ''];
      if (
        !sheet ||
        sheet.superseded ||
        !level ||
        !above ||
        !sec ||
        sec.conflict ||
        /ROOF/i.test(sheet.title ?? '') ||
        !/FRAMING/i.test(sheet.title ?? '')
      )
        return e;
      const ts = texts[sheet.id] ?? [];
      // Saved takeoff lines can stop at callouts or extend past a bearing. A
      // matching section does not validate those plan endpoints.
      const measurement = project.measurements?.find(
        (m) => m.id === e.measurementId,
      );
      const code = e.typeName.match(/^(B\d+)\b/)?.[1];
      if (
        !measurement ||
        measurement.points.length !== 2 ||
        e.shape.points.length !== 2 ||
        !sheet.metersPerPoint ||
        !code
      )
        return e;
      const [p, q] = measurement.points,
        [u, v] = e.shape.points;
      const dx = q[0] - p[0],
        dy = q[1] - p[1],
        den = dx * dx + dy * dy;
      if (den < 1) return e;
      const a = ((v[0] - u[0]) * dx + (v[1] - u[1]) * dy) / den;
      const b = ((v[1] - u[1]) * dx - (v[0] - u[0]) * dy) / den;
      if (Math.abs(Math.hypot(a, b) / sheet.metersPerPoint - 1) > 0.001)
        return e;
      const frame = {
        a,
        b,
        tx: u[0] - a * p[0] + b * p[1],
        ty: u[1] - b * p[0] - a * p[1],
        residual: 0,
      };
      const recovered = recoverRoofBeamSpan(
        measurement.points,
        code,
        {
          frame,
          metersPerPoint: sheet.metersPerPoint,
          title: sheet.title ?? '',
          bounds: [0, 0, sheet.width, sheet.height],
          grids: [],
          source: {
            kind: 'sheet',
            id: sheet.id,
            page: sheet.page,
            label: sheet.name,
          },
        },
        ts,
        lines[sheet.id] ?? [],
        Object.values(sections).filter((s) => /^C\d+$/.test(s.code)),
      );
      if (!recovered)
        return {
          ...e,
          issues: [
            ...new Set([
              ...e.issues,
              'Floor beam bearings unresolved: measured fragment cannot be associated with drawn scheduled supports and matching beam marks; physical solid withheld.',
            ]),
          ],
        };

      const panels = ts.flatMap((t) => {
        const m = /^PANELS:\s*(\d+(?:\.\d+)?)\s+\S+\s+CLT\b/i.exec(t.str);
        return m ? [{ t, n: +m[1] / 1000 }] : [];
      });
      const toppings = ts.flatMap((t) => {
        const m = /\b(\d+(?:\.\d+)?)\s*mm\s+CONCRETE TOPPING/i.exec(t.str);
        return m ? [{ t, n: +m[1] / 1000 }] : [];
      });
      if (
        panels.length !== 1 ||
        toppings.length !== 1 ||
        Math.abs(panels[0].t.cy - toppings[0].t.cy) > 50
      )
        return e;
      const assembly = panels[0].n + toppings[0].n;
      if (assembly <= 0 || assembly > 0.6) return e;
      const top = above.elevation - assembly;
      const evidence: SourceRef[] = [];
      for (const s of project.sheets.filter(
        (s) =>
          !s.superseded && /^S/.test(s.name) && /SECTION/i.test(s.title ?? ''),
      )) {
        const st = texts[s.id] ?? [],
          ls = lines[s.id] ?? [];
        const datums = st
          .filter((t) =>
            /^FIN\.?\s+(?:GROUND|SECOND|FIRST|THIRD|MAIN).*FLOOR$/i.test(
              t.str.trim(),
            ),
          )
          .flatMap((t) => {
            const n = st
              .filter(
                (n) =>
                  /^-?\d{1,5}$/.test(n.str.trim()) &&
                  n.cy > t.cy &&
                  n.cy - t.cy < 16 &&
                  Math.abs(n.cx - t.cx) < 75,
              )
              .sort((a, b) => Math.abs(a.cx - t.cx) - Math.abs(b.cx - t.cx))[0];
            if (!n) return [];
            // Dimension leaders are stroked vectors, not text bounding rectangles.
            const leaders = ls.filter(
              (l) =>
                l.width > 0 &&
                l.width < 0.6 &&
                !l.filled &&
                Math.abs(l.y2 - l.y1) < 0.02 &&
                l.y1 > t.cy &&
                l.y1 < n.cy &&
                Math.abs((l.x1 + l.x2) / 2 - t.cx) < 90,
            );
            const groups = new Map<number, number>();
            for (const l of leaders) {
              const y = Math.round(l.y1 * 10) / 10;
              groups.set(y, (groups.get(y) ?? 0) + 1);
            }
            const ys = [...groups].sort((a, b) => b[1] - a[1]);
            if (!ys.length || (ys[1] && ys[0][1] === ys[1][1])) return [];
            return [{ t, z: +n.str / 1000, y: ys[0][0] }];
          });
        for (const high of datums.filter(
          (d) => Math.abs(d.z - above.elevation) < 0.001,
        )) {
          const low = datums
            .filter(
              (d) =>
                Math.abs(d.z - level.elevation) < 0.001 &&
                d.y > high.y &&
                Math.abs(d.t.cx - high.t.cx) < 30,
            )
            .sort((a, b) => a.y - b.y)[0];
          if (!low) continue;
          const k = (high.z - low.z) / (low.y - high.y),
            beamY = high.y + assembly / k;
          if (k <= 0 || k > 0.2) continue;
          const edges = ls.filter(
            (l) =>
              !l.filled &&
              !l.curve &&
              Math.abs(l.x2 - l.x1) < 0.02 &&
              Math.abs(Math.min(l.y1, l.y2) - beamY) * k < 0.008 &&
              Math.abs(Math.abs(l.y2 - l.y1) * k - sec.depth) < 0.008 &&
              l.x1 < high.t.cx - 80 &&
              l.x1 > high.t.cx - 900,
          );
          // Both ends and a connecting top edge establish a drawn rectangular member.
          const supported = edges.filter((a) =>
            edges.some(
              (b) =>
                b !== a &&
                Math.abs(a.x1 - b.x1) * k > 0.25 &&
                ls.some(
                  (h) =>
                    !h.filled &&
                    !h.curve &&
                    Math.abs(h.y1 - beamY) * k < 0.008 &&
                    Math.abs(h.y2 - h.y1) < 0.02 &&
                    Math.abs(Math.min(h.x1, h.x2) - Math.min(a.x1, b.x1)) * k <
                      0.01 &&
                    Math.abs(Math.max(h.x1, h.x2) - Math.max(a.x1, b.x1)) * k <
                      0.01,
                ),
            ),
          );
          if (supported.length < 2) continue;
          evidence.push({
            kind: 'sheet',
            id: s.id,
            page: s.page,
            label: s.name,
            box: [
              Math.min(...supported.map((l) => l.x1)),
              beamY - 5,
              Math.max(...supported.map((l) => l.x1)),
              beamY + sec.depth / k + 5,
            ],
            quote: `Section beam top ${top.toFixed(3)} m: finished floor ${above.elevation.toFixed(3)} m minus ${(assembly * 1000).toFixed(0)} mm assembly; drawn depth agrees with ${sec.description}.`,
          });
        }
      }
      if (!evidence.length) return e;
      return {
        ...e,
        shape: {
          type: 'run' as const,
          points: recovered.map((p) => worldPoint(p, frame)),
          z0: top - sec.depth,
          height: sec.depth,
          thickness: sec.width,
        },
        placement: 'inferred' as const,
        sources: [
          ...e.sources,
          ...(
            [
              sec.source,
              {
                kind: 'sheet',
                id: sheet.id,
                page: sheet.page,
                label: sheet.name,
                box: [
                  Math.min(...recovered.map((p) => p[0])) - 10,
                  Math.min(...recovered.map((p) => p[1])) - 10,
                  Math.max(...recovered.map((p) => p[0])) + 10,
                  Math.max(...recovered.map((p) => p[1])) + 10,
                ],
                quote: `${code}: bearing centres from closed scheduled column outlines and matching beam marks in every bay. Original takeoff quantity retained; displayed span may differ from the saved fragment.`,
              },
              ...evidence,
              {
                kind: 'sheet' as const,
                id: sheet.id,
                page: sheet.page,
                label: sheet.name,
                box: [
                  Math.min(panels[0].t.cx, toppings[0].t.cx) - 150,
                  Math.min(panels[0].t.cy, toppings[0].t.cy) - 8,
                  Math.max(panels[0].t.cx, toppings[0].t.cx) + 150,
                  Math.max(panels[0].t.cy, toppings[0].t.cy) + 8,
                ],
                quote: `${panels[0].t.str}; ${toppings[0].t.str}`,
              },
            ] satisfies SourceRef[]
          ).map(revision.source),
        ],
        issues: [
          ...e.issues.filter(
            (i) =>
              !i.includes('plan only') &&
              !i.includes('endpoints and elevation') &&
              !i.startsWith('Floor beam bearings unresolved:') &&
              !i.startsWith('Floor revision evidence pending:'),
          ),
          `Physical floor beam: drawn bearing centres and matching bay marks, schedule section and section-checked top ${top.toFixed(3)} m. Bearings and connections remain unmodelled.`,
        ],
      };
    }),
  };
}
