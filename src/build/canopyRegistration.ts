import type { Project, Pt } from '../model';
import type { Segment } from '../fill/vectors';
import type { BuildModel, SourceRef } from './types';
import { gridAxes, type DrawingText, type DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import { sheetFrame, worldPoint, type SheetFrame } from './sheetCoordinates';

export interface CanopyRegistration {
  frame: SheetFrame;
  metersPerPoint: number;
  title: string;
  bounds: [number, number, number, number];
  grids: string[];
  sources: SourceRef[];
  /** Drawing's T/O ENTRY CANOPY datum. Not automatically the top of every beam. */
  topDatum: number;
}

/** Follow a grid bubble's straight leader and optional dogleg to the actual axis.
 * Bubble text is not an axis: offset labels must not become building coordinates.
 * Require a continuation on the final axis, and reject branching/ambiguous leaders. */
export function traceGridStroke(
  tag: DrawingText,
  lines: Segment[],
  axis: 'x' | 'y',
  inward: 1 | -1,
): number | null {
  const valid = lines.filter(
    (l) => !l.filled && !l.curve && l.width > 0 && l.width <= 0.6,
  );
  const at = (p: Pt) => (axis === 'x' ? p[0] : p[1]);
  const along = (p: Pt) => (axis === 'x' ? p[1] : p[0]);
  const centre: Pt = [tag.cx, tag.cy];
  const endpoints = (l: Segment): [Pt, Pt] => [
    [l.x1, l.y1],
    [l.x2, l.y2],
  ];
  const starts = valid.flatMap((l) => {
    const [a, b] = endpoints(l).sort((a, b) => inward * (along(a) - along(b)));
    const offset = Math.abs(at(a) - at(centre)),
      distance = inward * (along(a) - along(centre));
    return Math.abs(at(a) - at(b)) < 0.3 &&
      offset < 1 &&
      distance > 8 &&
      distance < 24 &&
      inward * (along(b) - along(a)) > 8
      ? [{ a, b }]
      : [];
  });
  const unique = starts.filter(
    (v, i) =>
      !starts
        .slice(0, i)
        .some(
          (w) =>
            Math.hypot(v.a[0] - w.a[0], v.a[1] - w.a[1]) < 0.5 &&
            Math.hypot(v.b[0] - w.b[0], v.b[1] - w.b[1]) < 0.5,
        ),
  );
  if (unique.length !== 1) return null;
  let endpoint = unique[0].b;
  const diagonal = valid.flatMap((l) => {
    const ps = endpoints(l),
      near = ps.findIndex(
        (p) => Math.hypot(p[0] - endpoint[0], p[1] - endpoint[1]) < 0.5,
      );
    if (near < 0) return [];
    const other = ps[1 - near];
    return Math.abs(at(other) - at(endpoint)) > 2 &&
      inward * (along(other) - along(endpoint)) > 2 &&
      Math.hypot(other[0] - endpoint[0], other[1] - endpoint[1]) < 80
      ? [other]
      : [];
  });
  const turns = diagonal.filter(
    (v, i) =>
      !diagonal
        .slice(0, i)
        .some((w) => Math.hypot(v[0] - w[0], v[1] - w[1]) < 0.5),
  );
  if (turns.length > 1) return null;
  if (turns[0]) endpoint = turns[0];
  const support = valid
    .filter((l) => {
      const [a, b] = endpoints(l);
      return (
        Math.abs(at(a) - at(endpoint)) < 0.3 &&
        Math.abs(at(b) - at(endpoint)) < 0.3 &&
        Math.max(
          inward * (along(a) - along(endpoint)),
          inward * (along(b) - along(endpoint)),
        ) > 15
      );
    })
    .reduce((sum, l) => sum + Math.hypot(l.x2 - l.x1, l.y2 - l.y1), 0);
  return support > 60 ? at(endpoint) : null;
}

function canopyDatum(
  project: Project,
  texts: DrawingTexts,
): { value: number; sources: SourceRef[] } | null {
  const found: { value: number; source: SourceRef }[] = [];
  for (const sheet of project.sheets.filter(
    (s) => !s.superseded && /^S/i.test(s.name),
  )) {
    const ts = texts[sheet.id] ?? [];
    for (const label of ts.filter((t) =>
      /^T\/O ENTRY CANOPY$/i.test(t.str.trim()),
    )) {
      const values = ts.filter(
        (t) =>
          /^\d{4,5}$/.test(t.str.trim()) &&
          t.cy > label.cy &&
          t.cy - label.cy < 15 &&
          Math.abs(t.cx - label.cx) < 45,
      );
      if (values.length !== 1) continue;
      const t = values[0];
      found.push({
        value: Number(t.str) / 1000,
        source: {
          kind: 'sheet',
          id: sheet.id,
          page: sheet.page,
          label: sheet.name,
          box: [label.cx - 65, label.cy - 10, t.cx + 20, t.cy + 10],
          quote: `${label.str}: ${t.str} mm`,
        },
      });
    }
  }
  if (
    new Set(found.map((f) => f.source.id)).size < 2 ||
    found.some((f) => Math.abs(f.value - found[0].value) > 0.01)
  )
    return null;
  return { value: found[0].value, sources: found.map((f) => f.source) };
}

/** Per-measurement registration for a named canopy viewport. One shared letter /
 * number intersection fixes translation; a second parallel grid independently
 * corroborates printed scale and rotation using actual strokes on both plans.
 * Does not alter sheet scale, measured quantities, or generate member solids. */
export function canopyRegistrations(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
): Record<string, CanopyRegistration> {
  const output: Record<string, CanopyRegistration> = {},
    datum = canopyDatum(project, texts);
  if (!datum) return output;
  const references = project.sheets
    .filter(
      (s) =>
        !s.superseded &&
        /^A/i.test(s.name) &&
        s.metersPerPoint &&
        /FLOOR PLAN/i.test(s.title ?? '') &&
        !/FIRE|CEILING|DETAIL|ENLARG/i.test(s.title ?? ''),
    )
    .flatMap((sheet) => {
      const frame = sheetFrame(project, model, sheet),
        ts = texts[sheet.id] ?? [];
      return frame
        ? [{ sheet, frame, ts, axes: gridAxes(ts, sheet.width, sheet.height) }]
        : [];
    });
  for (const sheet of project.sheets.filter(
    (s) => !s.superseded && /^S/i.test(s.name),
  )) {
    const ts = texts[sheet.id] ?? [],
      ls = lines[sheet.id] ?? [];
    for (const title of ts.filter((t) =>
      /^CANOPY FRAMING PLAN$/i.test(t.str.trim()),
    )) {
      const scales = ts.flatMap((t) => {
        const m = /^1\s*:\s*(\d+)$/.exec(t.str.trim());
        return m &&
          t.cy > title.cy &&
          t.cy - title.cy < 30 &&
          Math.abs(t.cx - title.cx) < 180
          ? [(Number(m[1]) * 0.0254) / 72]
          : [];
      });
      if (scales.length !== 1) continue;
      const scale = scales[0],
        local = ts.filter(
          (t) =>
            t.cx > title.cx - 220 &&
            t.cx < title.cx + 220 &&
            t.cy > title.cy - 450 &&
            t.cy < title.cy - 30,
        );
      // A suffixed grid corroborates its parent without assuming bubble spacing.
      const parents = local.filter((t) => /^[A-Z]$/.test(t.str.trim()));
      const candidates: CanopyRegistration[] = [];
      for (const parent of parents) {
        const suffix = local.find(
          (t) =>
            t.str.trim() === parent.str.trim() + 'f' &&
            Math.abs(t.cx - parent.cx) < 3 &&
            t.cy > parent.cy,
        );
        const numbers = local.filter(
          (t) =>
            /^\d+$/.test(t.str.trim()) &&
            t.cy < parent.cy - 50 &&
            t.cx > parent.cx + 40,
        );
        if (!suffix || numbers.length !== 1) continue;
        const number = numbers[0],
          y = traceGridStroke(parent, ls, 'y', 1),
          yf = traceGridStroke(suffix, ls, 'y', 1),
          x = traceGridStroke(number, ls, 'x', 1);
        if (x === null || y === null || yf === null || yf - y < 5) continue;
        for (const ref of references) {
          const letterAxis = ref.axes[parent.str.trim()],
            numberAxis = ref.axes[number.str.trim()];
          if (letterAxis?.axis !== 'x' || numberAxis?.axis !== 'y') continue;
          const letterTags = ref.ts
            .filter(
              (t) =>
                t.str.trim() === parent.str.trim() &&
                Math.abs(t.cx - letterAxis.at) < 2,
            )
            .sort((a, b) => a.cy - b.cy);
          const lt = letterTags[0],
            nt = ref.ts
              .filter(
                (t) =>
                  t.str.trim() === number.str.trim() &&
                  Math.abs(t.cy - numberAxis.at) < 2,
              )
              .sort((a, b) => a.cx - b.cx)[0];
          if (!lt || !nt) continue;
          const ft = ref.ts.find(
            (t) =>
              t.str.trim() === suffix.str.trim() &&
              Math.abs(t.cy - lt.cy) < 3 &&
              t.cx > lt.cx &&
              t.cx - lt.cx < 100,
          );
          if (!ft) continue;
          const rx = traceGridStroke(lt, lines[ref.sheet.id] ?? [], 'x', 1),
            rxf = traceGridStroke(ft, lines[ref.sheet.id] ?? [], 'x', 1),
            ry = traceGridStroke(nt, lines[ref.sheet.id] ?? [], 'y', 1);
          if (rx === null || rxf === null || ry === null) continue;
          const residual = Math.abs(
            (yf - y) * scale - (rxf - rx) * ref.sheet.metersPerPoint!,
          );
          if (residual > 0.03) continue;
          const ratio = scale / ref.sheet.metersPerPoint!,
            a = ref.frame.b * ratio,
            b = -ref.frame.a * ratio,
            anchor = worldPoint([rx, ry], ref.frame);
          const frame: SheetFrame = {
            a,
            b,
            tx: anchor[0] - a * x + b * y,
            ty: anchor[1] - b * x - a * y,
            residual: Math.max(ref.frame.residual, residual),
          };
          const bounds: [number, number, number, number] = [
            parent.cx - 20,
            number.cy + 15,
            number.cx + 100,
            title.cy - 30,
          ];
          candidates.push({
            frame,
            metersPerPoint: scale,
            title: title.str,
            bounds,
            grids: [parent.str, suffix.str, number.str],
            topDatum: datum.value,
            sources: [
              {
                kind: 'sheet',
                id: sheet.id,
                page: sheet.page,
                label: sheet.name,
                box: [bounds[0], number.cy - 20, bounds[2], title.cy + 30],
                quote: `${title.str}; printed 1:${Math.round((scale * 72) / 0.0254)}; grid ${parent.str}/${number.str}, ${parent.str}–${suffix.str} ${(scale * (yf - y)).toFixed(3)} m from actual grid strokes`,
              },
              {
                kind: 'sheet',
                id: ref.sheet.id,
                page: ref.sheet.page,
                label: ref.sheet.name,
                box: [
                  Math.min(nt.cx, lt.cx) - 20,
                  Math.min(nt.cy, lt.cy) - 20,
                  Math.max(ft.cx, rx) + 20,
                  Math.max(nt.cy, lt.cy) + 20,
                ],
                quote: `Independent ${parent.str}–${suffix.str} spacing ${((rxf - rx) * ref.sheet.metersPerPoint!).toFixed(3)} m; dogleg traced to axis`,
              },
              ...datum.sources,
            ],
          });
        }
      }
      if (!candidates.length) continue;
      const best = candidates[0];
      if (
        candidates.some((c) =>
          [
            [best.bounds[0], best.bounds[1]],
            [best.bounds[2], best.bounds[3]],
          ].some(
            (p) =>
              Math.hypot(
                ...worldPoint(p as Pt, c.frame).map(
                  (v, i) => v - worldPoint(p as Pt, best.frame)[i],
                ),
              ) > 0.05,
          ),
        )
      )
        continue;
      for (const m of project.measurements.filter(
        (m) => m.sheetId === sheet.id && m.points.length,
      ))
        if (
          m.points.every(
            ([x, y]) =>
              x >= best.bounds[0] &&
              x <= best.bounds[2] &&
              y >= best.bounds[1] &&
              y <= best.bounds[3],
          )
        )
          output[m.id] = best;
    }
  }
  return output;
}
