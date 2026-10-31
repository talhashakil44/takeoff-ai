import { roofSectionEndEvidence } from './roofSectionEndEvidence';
import type { Project, Pt } from "../model";
import type { BuildModel, SourceRef } from "./types";
import { gridAxes, type DrawingTexts } from "./building";
import type { DrawingLines } from "./roof";
import { structuralSections } from "./structural";
import { roofViewportRegistrations } from "./roofRegistration";
import {
  recoverRoofBeamSpan,
  joinCollinearRoofStrokes,
} from "./roofSpanEvidence";
import { roofBeamPlane } from "./roofBeamPlane";
import { worldPoint } from "./sheetCoordinates";
/** A cantilever's free end must be actual member ink, corroborated across
 * repeated roof rows, inside a printed maximum. Never substitute that maximum. */
export function roofCantileverExtension(
  points: Pt[],
  lines: DrawingLines[string],
  scale: number,
  maximum: number,
  direction?: -1 | 1,
): Pt[] | null {
  if (points.length !== 2 || Math.abs(points[0][1] - points[1][1]) > 0.3)
    return null;
  const lo = Math.min(points[0][0], points[1][0]),
    hi = Math.max(points[0][0], points[1][0]),
    y = points[0][1];
  const ink = lines.filter(
    (l) =>
      l.color === "#000000" &&
      !l.filled &&
      !l.curve &&
      (l.width ?? 0) >= 1 &&
      Math.abs(l.y1 - l.y2) < 0.05,
  );
  const candidates: Pt[][] = [];
  for (const dir of direction ? [direction] : [-1, 1]) {
    const direction = dir;
    const outer = direction < 0 ? lo : hi;
    const spans = ink
      .filter((l) => Math.abs(l.y1 - y) < 0.5)
      .map((l) => ({
        free: direction < 0 ? Math.min(l.x1, l.x2) : Math.max(l.x1, l.x2),
        near: direction < 0 ? Math.max(l.x1, l.x2) : Math.min(l.x1, l.x2),
      }));
    for (const s of spans) {
      const extension = (s.free - outer) * direction * scale;
      if (
        extension < 0.5 ||
        extension > maximum + 0.02 ||
        Math.abs(s.near - outer) * scale > 0.8
      )
        continue;
      const rows = new Set(
        ink
          .filter(
            (l) =>
              Math.abs(
                (direction < 0 ? Math.min(l.x1, l.x2) : Math.max(l.x1, l.x2)) -
                  s.free,
              ) < 0.2 && Math.abs(l.x2 - l.x1) * scale > 1,
          )
          .map((l) => Math.round(l.y1)),
      );
      if (rows.size < 3) continue;
      const candidate: Pt[] =
        direction < 0
          ? [
              [s.free, y],
              [hi, y],
            ]
          : [
              [lo, y],
              [s.free, y],
            ];
      if (
        !candidates.some(
          (c) =>
            Math.abs(c[0][0] - candidate[0][0]) < 0.2 &&
            Math.abs(c[1][0] - candidate[1][0]) < 0.2,
        )
      )
        candidates.push(candidate);
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}
/** Only a closed, scheduled-width/depth black end section can establish this
 * beam level. Purlins and column outlines have different sections. */
export function roofEndSection(
  lines: DrawingLines[string],
  x: number,
  scale: number,
  width: number,
  depth: number,
  yMin: number,
  yMax: number,
): { top: number; bottom: number } | null {
  const local = lines.filter(
      (l) =>
        l.color === "#000000" &&
        !l.filled &&
        !l.curve &&
        Math.abs((l.x1 + l.x2) / 2 - x) * scale < width &&
        Math.min(l.y1, l.y2) > yMin - 1 &&
        Math.max(l.y1, l.y2) < yMax + depth / scale + 1,
    ),
    ink = [...local, ...joinCollinearRoofStrokes(local)];
  const candidates: { top: number; bottom: number }[] = [];
  for (const top of ink.filter(
    (l) =>
      Math.abs(l.y1 - l.y2) < 0.05 &&
      l.y1 >= yMin &&
      l.y1 <= yMax &&
      Math.abs(Math.abs(l.x2 - l.x1) * scale - width) < 0.008 &&
      Math.abs((l.x1 + l.x2) / 2 - x) * scale < 0.01,
  )) {
    const x0 = Math.min(top.x1, top.x2),
      x1 = Math.max(top.x1, top.x2),
      bottom = ink.find(
        (l) =>
          Math.abs(l.y1 - l.y2) < 0.05 &&
          Math.abs(Math.min(l.x1, l.x2) - x0) < 0.1 &&
          Math.abs(Math.max(l.x1, l.x2) - x1) < 0.1 &&
          Math.abs((l.y1 - top.y1) * scale - depth) < 0.008,
      );
    if (
      !bottom ||
      ![x0, x1].every((xx) =>
        ink.some(
          (l) =>
            Math.abs(l.x1 - l.x2) < 0.05 &&
            Math.abs(l.x1 - xx) < 0.1 &&
            Math.min(l.y1, l.y2) <= top.y1 + 0.1 &&
            Math.max(l.y1, l.y2) >= bottom.y1 - 0.1,
        ),
      )
    )
      continue;
    if (!candidates.some((c) => Math.abs(c.top - top.y1) < 0.3))
      candidates.push({ top: top.y1, bottom: bottom.y1 });
  }
  return candidates.length === 1 ? candidates[0] : null;
}
/** Recover only roof members with corroborated plan/end-profile evidence.
 * Conflicting titles require an explicit plan reference and remain inferred. */
export function recoverRoofCantilevers(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
): BuildModel {
  const regs = roofViewportRegistrations(project, model, texts),
    sections = structuralSections(project, texts),
    plane = roofBeamPlane(project, model, texts, lines);
  return {
    ...model,
    elements: model.elements.map((e) => {
      const m = project.measurements.find((m) => m.id === e.measurementId),
        r = regs[e.measurementId],
        code = e.typeName.match(/^(B\d+)\b/)?.[1],
        sec = code ? sections[code] : undefined;
      if (!m || !r || !/^HIGH ROOF/.test(r.title) || !sec || sec.conflict)
        return e;
      const ts = texts[m.sheetId] ?? [],
        ls = lines[m.sheetId] ?? [],
        supports = recoverRoofBeamSpan(
          m.points,
          code!,
          r,
          ts,
          ls,
          Object.values(sections).filter((s) => /^C\d+$/.test(s.code)),
        );
      if (!supports || supports.length !== 2) return e;
      if (
        !ts.some(
          (c) =>
            /^\(?CANT\.?\)?$/i.test(c.str.trim()) &&
            ts.some(
              (t) =>
                t.str.trim() === code &&
                Math.abs(t.cx - c.cx) < 30 &&
                Math.abs(t.cy - c.cy) < 30,
            ),
        )
      )
        return e;
      const maxes = ts.flatMap((t) => {
        const n = t.str.match(/^MAX\.?\s*(\d+)$/i);
        return n &&
          ts.some(
            (v) =>
              /ROOF CANTILEVER/i.test(v.str) &&
              Math.abs(v.cx - t.cx) < 70 &&
              Math.abs(v.cy - t.cy) < 20,
          )
          ? [+n[1] / 1000]
          : [];
      });
      if (!maxes.length || maxes.some((v) => Math.abs(v - maxes[0]) > 0.001))
        return e;
      const planSheet = project.sheets.find((s) => s.id === m.sheetId);
      if (!planSheet) return e;
      const axes = gridAxes(ts, planSheet.width, planSheet.height),
        numberAxes = Object.entries(axes)
          .filter(
            ([k, v]) =>
              /^\d+$/.test(k) && r.grids.includes(k) && v.axis === "x",
          )
          .map(([, v]) => v.at);
      if (numberAxes.length < 3) return e;
      const direction: -1 | 1 | null =
        Math.abs(
          Math.min(...supports.map((p) => p[0])) - Math.min(...numberAxes),
        ) < 1
          ? -1
          : Math.abs(
                Math.max(...supports.map((p) => p[0])) -
                  Math.max(...numberAxes),
              ) < 1
            ? 1
            : null;
      if (direction === null) return e;
      const extended = roofCantileverExtension(
        supports,
        ls,
        r.metersPerPoint,
        maxes[0],
        direction,
      );
      if (!extended) return e;
      const letter = ts
        .filter(
          (t) =>
            /^[A-Z]$/.test(t.str) &&
            Math.abs(t.cy - supports[0][1]) < 2 &&
            t.cx < r.bounds[0],
        )
        .sort(
          (a, b) =>
            Math.abs(a.cy - supports[0][1]) - Math.abs(b.cy - supports[0][1]),
        )[0];
      if (!letter) return e;
      const grid = supports.map(
        (p) =>
          ts
            .filter(
              (t) =>
                /^\d+$/.test(t.str) &&
                Math.abs(t.cx - p[0]) < 1 &&
                t.cy < r.bounds[1] &&
                ts.filter(
                  (v) => /^\d+$/.test(v.str) && Math.abs(v.cy - t.cy) < 1,
                ).length >= 3,
            )
            .sort((a, b) => b.cy - a.cy)[0]?.str,
      );
      if (grid.some((v) => !v)) return e;
      const evidence: {
        top: number;
        source: SourceRef;
        references?: SourceRef[];
        discrepancy?: string;
      }[] = [];
      for (const sheet of project.sheets.filter(
        (s) =>
          !s.superseded &&
          /^S/.test(s.name) &&
          /ELEVATION/i.test(s.title ?? ""),
      )) {
        const st = texts[sheet.id] ?? [],
          sl = lines[sheet.id] ?? [];
        for (const title of st) {
          const match = title.str.match(
            /^FRAMING ELEVATION - GRIDLINE '([A-Z]+)' FROM (\d+) TO (\d+)$/,
          );
          if (
            !match ||
            match[1] !== letter.str ||
            ![match[2], match[3]].every((v) => grid.includes(v))
          )
            continue;
          const row = st.filter(
            (t) =>
              [match[2], match[3]].includes(t.str) &&
              t.cx > title.cx - 300 &&
              t.cx < title.cx + 300 &&
              t.cy < title.cy - 100 &&
              title.cy - t.cy < 800,
          );
          const rows = row.filter((t) =>
            row.some((v) => v.str !== t.str && Math.abs(v.cy - t.cy) < 2),
          );
          if (new Set(rows.map((t) => t.str)).size !== 2) continue;
          const rowY = Math.max(...rows.map((t) => t.cy)),
            sx0 = Math.min(...rows.map((t) => t.cx)),
            sx1 = Math.max(...rows.map((t) => t.cx));
          const scaleText = st.find(
              (t) =>
                /1\s*:\s*\d+/.test(t.str) &&
                t.cy > title.cy &&
                t.cy - title.cy < 25 &&
                Math.abs(t.cx - title.cx) < 300,
            ),
            sm = scaleText?.str.match(/1\s*:\s*(\d+)/);
          if (!sm) continue;
          const scale = (+sm[1] * 0.0254) / 72;
          const label = st.find(
            (t) =>
              /^T\/?O (?:HIGH|LOW) BEAM$/.test(t.str) &&
              Math.abs(t.cx - title.cx) < 300 &&
              t.cy > rowY &&
              t.cy < title.cy - 100,
          );
          if (!label) continue;
          const number = st.filter(
            (t) =>
              /^\d{4,5}$/.test(t.str) &&
              Math.abs(t.cx - label.cx) < 50 &&
              t.cy - label.cy > 5 &&
              t.cy - label.cy < 11,
          );
          if (number.length !== 1) continue;
          const approxY = (label.cy + number[0].cy) / 2,
            topLines = sl.filter(
              (l) =>
                l.color === "#000000" &&
                !l.filled &&
                !l.curve &&
                Math.abs(l.y1 - l.y2) < 0.05 &&
                Math.abs(l.y1 - approxY) < 0.5 &&
                Math.abs(l.x2 - l.x1) * scale > 0.3 &&
                Math.min(l.x1, l.x2) < sx1 &&
                Math.max(l.x1, l.x2) > sx0,
            );
          const intervals = topLines
            .map((l) => [
              Math.max(sx0, Math.min(l.x1, l.x2)),
              Math.min(sx1, Math.max(l.x1, l.x2)),
            ])
            .sort((a, b) => a[0] - b[0]);
          let cursor = sx0,
            coverage = 0,
            maxGap = 0;
          for (const v of intervals) {
            maxGap = Math.max(maxGap, (v[0] - cursor) * scale);
            coverage += Math.max(0, v[1] - Math.max(cursor, v[0]));
            cursor = Math.max(cursor, v[1]);
          }
          maxGap = Math.max(maxGap, (sx1 - cursor) * scale);
          if (coverage < (sx1 - sx0) * 0.6 || maxGap > 0.25) continue;
          for (const topLine of topLines) {
            const bottom = sl.find(
              (l) =>
                l.color === "#000000" &&
                Math.abs(l.y1 - l.y2) < 0.05 &&
                Math.abs((l.y1 - topLine.y1) * scale - sec.depth) < 0.012 &&
                Math.abs(l.x2 - l.x1) > (sx1 - sx0) * 0.4 &&
                Math.min(l.x1, l.x2) < sx1 &&
                Math.max(l.x1, l.x2) > sx0,
            );
            if (
              !bottom ||
              !st.some(
                (t) =>
                  t.str === code &&
                  t.cx > sx0 &&
                  t.cx < sx1 &&
                  t.cy > topLine.y1 &&
                  t.cy < bottom.y1,
              )
            )
              continue;
            evidence.push({
              top: +number[0].str / 1000,
              source: {
                kind: "sheet",
                id: sheet.id,
                page: sheet.page,
                label: sheet.name,
                box: [sx0 - 60, topLine.y1 - 10, sx1 + 60, bottom.y1 + 10],
                quote: `${title.str}; actual numbered grid bubbles agree with title. ${code} labelled inside drawn section; top ${number[0].str}mm and ${(sec.depth * 1000).toFixed(0)}mm drawn depth at ${scaleText!.str}.`,
              },
            });
          }
        }
      }

      // A transverse elevation on the outer numbered grid corroborates intermediate
      // roof rows by its actual letter bubbles and closed scheduled beam end section.
      if (plane)
        for (const sheet of project.sheets.filter(
          (s) =>
            !s.superseded &&
            /^S/.test(s.name) &&
            /ELEVATION/i.test(s.title ?? ""),
        )) {
          const st = texts[sheet.id] ?? [],
            sl = lines[sheet.id] ?? [];
          for (const title of st) {
            const match = title.str.match(
              /^FRAMING ELEVATION - GRIDLINE '(\d+|[A-Z])' FROM ([A-Z]) TO ([A-Z])$/,
            );
            if (!match) continue;
            let fixed = match[1],
              discrepancy: string | undefined;
            const references: SourceRef[] = [];
            if (!/^\d+$/.test(fixed)) {
              // Some issued elevation titles conflict with their own grid family. Resolve
              // only through an explicit numbered plan reference AND named adjacent girt.
              const titleLeft = title.w ? title.cx - title.w / 2 : null;
              if (titleLeft === null) continue;
              const detailNumbers = st.filter(
                (t) =>
                  /^\d+$/.test(t.str) &&
                  Math.abs(t.cy - title.cy) < 3 &&
                  t.cx < titleLeft &&
                  titleLeft - t.cx < 50,
              );
              if (detailNumbers.length !== 1) continue;
              const routes = ts.flatMap((ref) => {
                if (ref.str !== sheet.name) return [];
                if (
                  !ts.some(
                    (t) =>
                      t.str === detailNumbers[0].str &&
                      Math.abs(t.cx - ref.cx) < 2 &&
                      ref.cy - t.cy > 8 &&
                      ref.cy - t.cy < 18,
                  )
                )
                  return [];
                return ts.flatMap((note) => {
                  const n = note.str.match(/^LOW GIRT ALONG GRIDLINE '(\d+)'$/);
                  if (
                    !n ||
                    !grid.includes(n[1]) ||
                    Math.abs(note.cx - ref.cx) > 100 ||
                    Math.abs(note.cy - ref.cy) > 180
                  )
                    return [];
                  const outer = axes[n[1]];
                  if (
                    !outer ||
                    outer.axis !== "x" ||
                    Math.abs(ref.cx - outer.at) > 220 ||
                    ref.cx > Math.min(...numberAxes)
                  )
                    return [];
                  if (
                    !st.some(
                      (t) =>
                        /^B\d+$/.test(t.str) &&
                        st.some(
                          (g) =>
                            /^GIRT$/.test(g.str) &&
                            Math.abs(t.cx - g.cx) < 40 &&
                            Math.abs(t.cy - g.cy) < 30,
                        ) &&
                        t.cx > title.cx - 250 &&
                        t.cx < title.cx + 500 &&
                        t.cy > title.cy - 800 &&
                        t.cy < title.cy,
                    )
                  )
                    return [];
                  return [{ fixed: n[1], ref, note }];
                });
              });
              if (routes.length !== 1) continue;
              fixed = routes[0].fixed;
              discrepancy = `Roof cantilever source discrepancy: elevation title names grid ${match[1]} with lettered range ${match[2]}–${match[3]}; plan reference ${detailNumbers[0].str}/${sheet.name} and adjacent low-girt grid-${fixed} note establish this frame location. Title discrepancy remains unresolved; geometry association is inferred from those explicit plan references.`;
              references.push({
                kind: "sheet",
                id: m.sheetId,
                page: r.source.page,
                label: r.source.label,
                box: [
                  Math.min(routes[0].ref.cx, routes[0].note.cx) - 100,
                  Math.min(routes[0].ref.cy, routes[0].note.cy) - 20,
                  Math.max(routes[0].ref.cx, routes[0].note.cx) + 120,
                  Math.max(routes[0].ref.cy, routes[0].note.cy) + 20,
                ],
                quote: `${detailNumbers[0].str}/${sheet.name}: ${routes[0].note.str}; matches the elevation's girt and lettered grid range despite its inconsistent fixed-grid title.`,
              });
            }
            if (!grid.includes(fixed)) continue;
            const row = st.filter(
              (t) =>
                /^[A-Z]$/.test(t.str) &&
                t.cx > title.cx - 250 &&
                t.cx < title.cx + 500 &&
                t.cy < title.cy - 300 &&
                title.cy - t.cy < 900,
            );
            const end = row.find(
                (t) =>
                  t.str === match[2] &&
                  row.some(
                    (v) => v.str === match[3] && Math.abs(v.cy - t.cy) < 2,
                  ),
              ),
              at = end
                ? row.find(
                    (t) => t.str === letter.str && Math.abs(t.cy - end.cy) < 2,
                  )
                : undefined;
            if (!at) continue;
            const scaleText = st.find(
                (t) =>
                  /1\s*:\s*\d+/.test(t.str) &&
                  t.cy > title.cy &&
                  t.cy - title.cy < 25 &&
                  Math.abs(t.cx - title.cx) < 300,
              ),
              sm = scaleText?.str.match(/1\s*:\s*(\d+)/);
            if (!sm) continue;
            const scale = (+sm[1] * 0.0254) / 72;
            const datum = (label: string) => {
              const t = st.find(
                (t) =>
                  t.str === label &&
                  t.cx > title.cx - 250 &&
                  t.cx < title.cx + 500 &&
                  t.cy > at.cy &&
                  t.cy < title.cy - 100,
              );
              if (!t) return null;
              const ns = st.filter(
                (v) =>
                  /^\d{4,5}$/.test(v.str) &&
                  Math.abs(v.cx - t.cx) < 50 &&
                  v.cy - t.cy > 5 &&
                  v.cy - t.cy < 11,
              );
              if (ns.length !== 1) return null;
              const y = (t.cy + ns[0].cy) / 2,
                ls = sl.filter(
                  (l) =>
                    !l.filled &&
                    Math.abs(l.y1 - l.y2) < 0.05 &&
                    Math.abs(l.y1 - y) < 0.4 &&
                    Math.abs((l.x1 + l.x2) / 2 - t.cx) < 80 &&
                    Math.abs(l.x1 - l.x2) > 3,
                ),
                groups = ls
                  .map((l) => ({
                    y: l.y1,
                    n: ls.filter((v) => Math.abs(v.y1 - l.y1) < 0.05).length,
                  }))
                  .filter((v) => v.n >= 3)
                  .sort((a, b) => b.n - a.n);
              return groups[0]
                ? { y: groups[0].y, z: +ns[0].str / 1000 }
                : null;
            };
            const high = datum("T/O HIGH BEAM"),
              low = datum("T/O LOW BEAM");
            if (
              !high ||
              !low ||
              Math.abs((low.y - high.y) * scale - (high.z - low.z)) > 0.02
            )
              continue;
            const profile = roofEndSection(
              sl,
              at.cx,
              scale,
              sec.width,
              sec.depth,
              high.y - 1,
              low.y + 1,
            );
            if (!profile) continue;
            const measuredTop = high.z - (profile.top - high.y) * scale,
              world = supports.map((p) => worldPoint(p, r.frame)),
              tops = world.map(
                (p) =>
                  plane.topPlane[0] * p[0] +
                  plane.topPlane[1] * p[1] +
                  plane.topPlane[2],
              );
            if (
              tops.some((z) => Math.abs(z - measuredTop) > 0.02) ||
              Math.abs(tops[0] - tops[1]) > 0.005
            )
              continue;
            evidence.push({
              top: tops[0],
              references,
              discrepancy,
              source: {
                kind: "sheet",
                id: sheet.id,
                page: sheet.page,
                label: sheet.name,
                box: [
                  at.cx - 20,
                  profile.top - 10,
                  at.cx + 20,
                  profile.bottom + 10,
                ],
                quote: `${title.str}, actual grid ${letter.str}: closed ${(sec.width * 1000).toFixed(0)}×${(sec.depth * 1000).toFixed(0)}mm beam end section, calibrated ${scaleText!.str}. Traced top ${measuredTop.toFixed(3)}m corroborates structural beam plane ${tops[0].toFixed(3)}m within20mm; roof purlin section is not substituted.`,
              },
            });
          }
        }
      if (!evidence.length && plane) {
        const tops = supports.map(p => worldPoint(p, r.frame)).map(p => plane.topPlane[0]*p[0]+plane.topPlane[1]*p[1]+plane.topPlane[2]);
        if (Math.abs(tops[0]-tops[1])<.005) evidence.push(...roofSectionEndEvidence(project,texts,lines,m.sheetId,r.bounds,supports,letter.str,sec.width,sec.depth,tops[0],roofEndSection));
      }
      if (
        !evidence.length ||
        evidence.some((v) => Math.abs(v.top - evidence[0].top) > 0.001)
      ) {
        const issue = `Roof cantilever elevation unresolved: ${code} at row ${letter.str}, grids ${grid.join("–")}, has a drawn free end but no unique matching section/profile level. Extension withheld; the current support-to-support beam does not represent the full cantilever. Conflicting elevation titles or unmatched grid bubbles are not accepted as proof.`;
        return {
          ...e,
          issues: [
            ...e.issues.filter(
              (i) => !i.startsWith("Roof cantilever elevation unresolved:"),
            ),
            issue,
          ],
        };
      }
      const top = evidence[0].top,
        points = extended.map((p) => worldPoint(p, r.frame));
      return {
        ...e,
        shape: {
          type: "run" as const,
          points,
          z0: top - sec.depth,
          height: sec.depth,
          thickness: sec.width,
          topPlane: [0, 0, top] as [number, number, number],
          bottomPlane: [0, 0, top - sec.depth] as [number, number, number],
        },
        placement: "inferred" as const,
        sources: [
          ...new Map(
            [
              ...e.sources,
              r.source,
              sec.source,
              ...evidence.flatMap((v) => [v.source, ...(v.references ?? [])]),
              {
                kind: "sheet" as const,
                id: m.sheetId,
                page: r.source.page,
                label: r.source.label,
                box: [
                  Math.min(...extended.map((p) => p[0])) - 10,
                  extended[0][1] - 25,
                  Math.max(...extended.map((p) => p[0])) + 10,
                  extended[0][1] + 25,
                ] as [number, number, number, number],
                quote: `${code}: cantilever free-end axis traced from repeated aligned black member strokes; measured extension obeys printed maximum ${maxes[0]}m. Maximum is a check, not the modelled length.`,
              },
            ].map((s) => [JSON.stringify(s), s]),
          ).values(),
        ],
        issues: [
          ...e.issues.filter(
            (i) =>
              !i.startsWith("Roof cantilever elevation unresolved:") &&
              !i.startsWith("Physical roof cantilever:") &&
              !i.startsWith("Physical high-roof beam:") &&
              !i.startsWith("Roof cantilever source discrepancy:") &&
              !i.startsWith("Roof framing detail: cantilever callout"),
          ),
          ...[
            ...new Set(
              evidence.flatMap((v) => (v.discrepancy ? [v.discrepancy] : [])),
            ),
          ],
          `Physical roof cantilever: free end from actual plan member ink; scheduled section and calibrated beam-end/profile elevation corroborate the level. ${evidence.some((v) => v.discrepancy) ? "Frame association is inferred from the explicit plan reference and adjacent named girt; the conflicting elevation title remains unresolved." : "Frame location is corroborated by the elevation grids or an explicit plan cut inside the bearing bay."} Separate roof-purlin assembly and connection fabrication remain outside this beam geometry. Original takeoff quantity retained and unreconciled.`,
        ],
      };
    }),
  };
}
