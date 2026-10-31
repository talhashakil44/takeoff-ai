import {hasLocalRoofCantilever} from './roofCantileverMark';
import type { Project, Pt } from '../model';
import type { BuildModel, SourceRef } from './types';
import { gridAxes, matchGridAxes, type DrawingTexts } from './building';
import { sheetFrame, type SheetFrame } from './sheetCoordinates';

export interface RoofViewportRegistration {
  frame: SheetFrame;
  metersPerPoint: number;
  title: string;
  bounds: [number, number, number, number];
  grids: string[];
  source: SourceRef;
}
/** Recover placement for an uncalibrated multi-scale roof sheet from each named
 * viewport's printed scale AND independently matching architectural grids.
 * Never changes sheet calibration, quantities, or the source project. A frame
 * applies inside its supporting grid envelope, with a local CANT-noted span
 * allowed one free end outside it. Details/canopies and ambiguous frames remain
 * unresolved; this association alone never qualifies physical geometry. */
export function roofViewportRegistrations(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
): Record<string, RoofViewportRegistration> {
  const output: Record<string, RoofViewportRegistration> = {};
  const references = project.sheets
    .filter(
      (s) =>
        !s.superseded &&
        /^A/i.test(s.name) &&
        s.metersPerPoint &&
        /FLOOR PLAN/i.test(s.title ?? '') &&
        !/CEILING|ENLARG|FIRE|DETAIL/i.test(s.title ?? ''),
    )
    .flatMap((sheet) => {
      const frame = sheetFrame(project, model, sheet);
      return frame
        ? [
            {
              sheet,
              frame,
              axes: gridAxes(texts[sheet.id] ?? [], sheet.width, sheet.height),
            },
          ]
        : [];
    });
  for (const sheet of project.sheets.filter(
    (s) => !s.superseded && /^S/i.test(s.name) && !s.metersPerPoint,
  )) {
    const ts = texts[sheet.id] ?? [];
    const titles = ts
      .filter((t) => /^(?:HIGH |LOW )?ROOF FRAMING PLAN$/i.test(t.str.trim()))
      .sort((a, b) => a.cy - b.cy);
    const candidates: RoofViewportRegistration[] = [];
    for (const [index, title] of titles.entries()) {
      const scales = ts.flatMap((t) => {
        const m = /^1\s*:\s*(\d+(?:\.\d+)?)$/.exec(t.str.trim());
        return m &&
          t.cy > title.cy &&
          t.cy - title.cy < 35 &&
          Math.abs(t.cx - title.cx) < 180
          ? [{ t, scale: (Number(m[1]) * 0.0254) / 72 }]
          : [];
      });
      if (scales.length !== 1 || scales[0].scale <= 0) continue;
      // Titles beneath stacked viewports bound a conservative analysis strip.
      // Do not extend a frame through another viewport's printed title.
      const top = index ? titles[index - 1].cy + 35 : 0;
      const local = ts.filter((t) => t.cy > top && t.cy < title.cy - 15);
      const axes = gridAxes(local, sheet.width, title.cy - top);
      // Section callout numbers can sit 2-3 points from a grid-bubble row.
      // A tighter collinearity check preserves the actual grid row instead of
      // replacing one repeated label with a nearby callout number.
      for (const letters of [true, false]) {
        const labels = local.filter(
          (t) =>
            (letters ? /^[A-Z]$/ : /^(?:[1-9]|1[0-9])$/).test(t.str.trim()) &&
            t.cx < sheet.width * 0.87,
        );
        const rows = labels
          .flatMap((t) =>
            (['x', 'y'] as const).flatMap((axis) => {
              const family = labels.filter(
                (v) => Math.abs(axis === 'x' ? v.cy - t.cy : v.cx - t.cx) < 1,
              );
              const unique = new Map(family.map((v) => [v.str.trim(), v]));
              if (unique.size < 3 || unique.size !== family.length) return [];
              const points = [...unique.values()],
                ats = points.map((v) => (axis === 'x' ? v.cx : v.cy));
              return Math.max(...ats) - Math.min(...ats) >
                (axis === 'x' ? sheet.width : title.cy - top) * 0.2
                ? [{ axis, points }]
                : [];
            }),
          )
          .sort((a, b) => b.points.length - a.points.length);
        const best = rows[0];
        if (best)
          for (const t of best.points)
            axes[t.str.trim()] = {
              axis: best.axis,
              at: best.axis === 'x' ? t.cx : t.cy,
            };
      }
      if (Object.keys(axes).length < 6) continue;
      const scale = scales[0].scale;
      const matches = references.flatMap((ref) => {
        const reg = matchGridAxes(
          axes,
          scale,
          ref.axes,
          ref.sheet.metersPerPoint!,
        );
        if (
          !reg ||
          reg.grids.filter((k) => /^[A-Z]$/.test(k)).length < 3 ||
          reg.grids.filter((k) => /^\d+$/.test(k)).length < 3
        )
          return [];
        const theta = reg.rotation ?? 0,
          c = Math.cos(theta),
          s = Math.sin(theta);
        // reg maps source metres to reference metres. Compose with the known
        // reference's drawing-to-model transform (which already includes origin).
        const ratio = 1 / ref.sheet.metersPerPoint!;
        const frame: SheetFrame = {
          a: (ref.frame.a * c - ref.frame.b * s) * scale * ratio,
          b: (ref.frame.b * c + ref.frame.a * s) * scale * ratio,
          tx:
            ref.frame.tx - (ref.frame.a * reg.x - ref.frame.b * reg.y) * ratio,
          ty:
            ref.frame.ty - (ref.frame.b * reg.x + ref.frame.a * reg.y) * ratio,
          residual: ref.frame.residual,
        };
        return [{ frame, grids: reg.grids }];
      });
      if (!matches.length) continue;
      const best = matches.sort((a, b) => b.grids.length - a.grids.length)[0];
      // All independently calibrated architectural floors must agree in XY.
      const point = (p: Pt, f: SheetFrame): Pt => [
        f.a * p[0] - f.b * p[1] + f.tx,
        f.b * p[0] + f.a * p[1] + f.ty,
      ];
      if (
        matches.some((m) =>
          [
            [0, 0],
            [sheet.width, sheet.height],
          ].some(
            (p) =>
              Math.hypot(
                ...point(p as Pt, m.frame).map(
                  (v, i) => v - point(p as Pt, best.frame)[i],
                ),
              ) > 0.15,
          ),
        )
      )
        continue;
      const positions = (axis: 'x' | 'y') =>
        best.grids
          .filter((k) => axes[k].axis === axis)
          .map((k) => axes[k].at)
          .sort((a, b) => a - b);
      const xx = positions('x'),
        yy = positions('y');
      if (xx.length < 3 || yy.length < 3) continue;
      // Half the smallest verified bay admits off-grid tags, not a neighbouring view.
      const pad = (xs: number[]) =>
        Math.min(
          ...xs
            .slice(1)
            .map((x, i) => x - xs[i])
            .filter((d) => d > 1),
        ) * 0.5;
      const bounds: [number, number, number, number] = [
        xx[0] - pad(xx),
        Math.max(top, yy[0] - pad(yy)),
        xx.at(-1)! + pad(xx),
        Math.min(title.cy - 15, yy.at(-1)! + pad(yy)),
      ];
      candidates.push({
        frame: best.frame,
        metersPerPoint: scale,
        title: title.str,
        bounds,
        grids: best.grids,
        source: {
          kind: 'sheet',
          id: sheet.id,
          page: sheet.page,
          label: sheet.name,
          box: [
            Math.min(title.cx - 160, scales[0].t.cx - 30),
            title.cy - 10,
            title.cx + 180,
            scales[0].t.cy + 10,
          ],
          quote: `${title.str}; printed scale 1:${Math.round((scale * 72) / 0.0254)}; registered grids ${best.grids.join(', ')}`,
        },
      });
    }
    for (const measurement of project.measurements.filter(
      (m) => m.sheetId === sheet.id && m.points.length,
    )) {
      const hits = candidates.filter((c) =>
        measurement.points.every(
          ([x, y]) =>
            x >= c.bounds[0] &&
            x <= c.bounds[2] &&
            y >= c.bounds[1] &&
            y <= c.bounds[3],
        ) || (
          /^HIGH ROOF/.test(c.title) && measurement.points.length===2 &&
          Math.abs(measurement.points[0][1]-measurement.points[1][1])<.3 &&
          measurement.points.every(([,y])=>y>=c.bounds[1]&&y<=c.bounds[3]) &&
          measurement.points.some(([x])=>x>=c.bounds[0]&&x<=c.bounds[2]) &&
          hasLocalRoofCantilever(measurement.points,measurement.label??'',texts[sheet.id]??[])
        ),
      );
      if (hits.length === 1) output[measurement.id] = hits[0];
    }
  }
  return output;
}
