import type { Project } from '../model';
import type { Segment } from '../fill/vectors';
import { gridAxes, registerSheets, type DrawingTexts } from './building';
import type { BuildModel, SourceRef } from './types';
export type DrawingLines = Record<string, Segment[]>;

/** Recover a single-pitch roof only when elevation linework, datums and plan grids agree.
 * No project names, assumed slope directions or fixed elevations are used. */
export function recoverRoof(model: BuildModel, project: Project, texts: DrawingTexts, lines: DrawingLines, origin: [number, number]) {
  const registration = registerSheets(project, texts);
  const plans = project.sheets.filter((s) => registration[s.id]);
  const plan = plans.sort((a, b) => registration[b.id].grids.length - registration[a.id].grids.length)[0];
  if (!plan?.metersPerPoint) return;
  const axes = gridAxes(texts[plan.id] ?? [], plan.width, plan.height);
  const candidates: { gx: number; gy: number; z: number; source: SourceRef }[] = [];
  for (const sheet of project.sheets.filter(
    (s) => /ELEVATION|BUILDING SECTION/i.test(s.title ?? '') && !/INTERIOR|DETAIL/i.test(s.title ?? ''),
  )) {
    const ts = texts[sheet.id] ?? [];
    for (const high of ts.filter((t) => /T\/?O HIGH BEAM/i.test(t.str))) {
      const numeric = ts
        .filter((t) => /^\d{4,5}$/.test(t.str) && Math.abs(t.cy - high.cy) < 5 && Math.abs(t.cx - high.cx) < 140)
        .sort((a, b) => Math.abs(a.cx - high.cx) - Math.abs(b.cx - high.cx))[0];
      const low = ts.filter(
        (t) => /T\/?O LOW BEAM/i.test(t.str) && t.cy > high.cy && t.cy - high.cy < 200 && Math.abs(t.cx - high.cx) < 20,
      )[0];
      if (!numeric || !low) continue;
      const lowNumeric = ts
        .filter((t) => /^\d{4,5}$/.test(t.str) && Math.abs(t.cy - low.cy) < 5 && Math.abs(t.cx - low.cx) < 140)
        .sort((a, b) => Math.abs(a.cx - low.cx) - Math.abs(b.cx - low.cx))[0];
      if (!lowNumeric) continue;
      const highZ = Number(numeric.str) / 1000,
        lowZ = Number(lowNumeric.str) / 1000;
      const scale = (highZ - lowZ) / (low.cy - high.cy);
      if (scale <= 0 || scale > 0.2) continue;
      // This elevation's grid bubbles are above the high beam and beside its datum label.
      const labels = ts.filter((t) => axes[t.str.trim()] && t.cy < high.cy && high.cy - t.cy < 140 && Math.abs(t.cx - high.cx) < 1300);
      const rows: (typeof labels)[] = [];
      for (const t of labels) {
        const row = rows.find((r) => Math.abs(r[0].cy - t.cy) < 4);
        if (row) row.push(t);
        else rows.push([t]);
      }
      for (const row of rows) {
        // Opposing elevations may share a row. Split at gaps much wider than a grid bay.
        row.sort((a, b) => a.cx - b.cx);
        const groups: (typeof row)[] = [];
        for (const t of row) {
          const g = groups.at(-1);
          if (!g || t.cx - g.at(-1)!.cx > 250) groups.push([t]);
          else g.push(t);
        }
        for (const group of groups) {
          if (group.length < 3) continue;
          const first = group[0],
            last = group.at(-1)!;
          const aa = axes[first.str.trim()],
            bb = axes[last.str.trim()];
          if (aa.axis !== bb.axis || Math.abs(last.cx - first.cx) < 150) continue;
          const reg = registration[plan.id];
          const toPlan = (a: typeof aa) => a.at * plan.metersPerPoint! - (a.axis === 'x' ? reg.x + origin[0] : reg.y + origin[1]);
          const u0 = toPlan(aa),
            u1 = toPlan(bb);
          if (Math.abs(u1 - u0) < 2) continue;
          const roofLines = (lines[sheet.id] ?? []).filter(
            (l) =>
              !l.curve &&
              !l.dashed &&
              Math.abs(l.x2 - l.x1) > Math.abs(last.cx - first.cx) * 0.8 &&
              Math.min(l.x1, l.x2) < first.cx + 20 &&
              Math.max(l.x1, l.x2) > last.cx - 20 &&
              Math.min(l.y1, l.y2) > high.cy - 60 &&
              Math.max(l.y1, l.y2) < low.cy + 40 &&
              Math.abs((l.y2 - l.y1) / (l.x2 - l.x1)) > 0.02 &&
              Math.abs((l.y2 - l.y1) / (l.x2 - l.x1)) < 0.4,
          );
          // Uppermost continuous line is the roof skin; lower parallel lines are fascia/beams.
          roofLines.sort((a, b) => a.y1 + a.y2 - (b.y1 + b.y2));
          const line = roofLines[0];
          if (!line) continue;
          const at = (x: number) => line.y1 + ((x - line.x1) * (line.y2 - line.y1)) / (line.x2 - line.x1);
          const z0 = highZ + (high.cy - at(first.cx)) * scale,
            z1 = highZ + (high.cy - at(last.cx)) * scale;
          const slope = (z1 - z0) / (u1 - u0);
          if (Math.abs(slope) > 0.4 || Math.abs(slope) < 0.02) continue;
          candidates.push({
            gx: aa.axis === 'x' ? slope : 0,
            gy: aa.axis === 'y' ? slope : 0,
            z: z0 - slope * u0,
            source: {
              kind: 'sheet',
              id: sheet.id,
              page: sheet.page,
              label: sheet.name,
              box: [
                Math.min(line.x1, line.x2),
                Math.min(line.y1, line.y2) - 20,
                Math.max(line.x1, line.x2),
                Math.max(line.y1, line.y2) + 20,
              ],
            },
          });
        }
      }
    }
  }
  // Two independently drawn opposing elevations must describe the same plane.
  const consistent = candidates.filter((a) =>
    candidates.some(
      (b) =>
        b !== a &&
        Math.abs(a.gx - b.gx) < 0.015 &&
        Math.abs(a.gy - b.gy) < 0.015 &&
        Math.abs(a.z - b.z) < 0.2 &&
        (a.source.id !== b.source.id || Math.abs(a.source.box![0] - b.source.box![0]) > 150),
    ),
  );
  if (!consistent.length) return;
  const p = consistent[0];
  for (const e of model.elements.filter((e) => e.origin === 'building' && e.id.endsWith(':roof'))) {
    if (e.shape?.type !== 'surface') continue;
    const floor = model.levels.find((l) => l.id === e.level)?.elevation ?? 0;
    const heights = e.shape.ring.map(([x, y]) => p.z + p.gx * x + p.gy * y);
    if (heights.some((z) => z < floor + 1.8 || z > floor + 15)) continue;
    e.shape.z = p.z;
    e.shape.slope = [p.gx, p.gy];
    e.name = 'Sloping roof — elevation linework';
    e.placement = 'inferred';
    e.sources.push(...consistent.map((c) => c.source));
    for (const wall of model.elements) {
      const run = wall.shape;
      if (run?.type !== 'run' || wall.level !== e.level || !/\bEW\d|EXTERIOR WALL/i.test(wall.name)) continue;
      run.topPlane = [p.gx, p.gy, p.z];
      run.height = Math.max(...run.points.map(([x, y]) => p.z + p.gx * x + p.gy * y - run.z0));
      wall.issues.push('Exterior wall head fitted to recovered roof plane; assembly junction remains inferred.');
    }
    for (const wall of model.elements.filter((w) => w.level === 'roof' && /\bEW\d/i.test(w.name) && w.shape?.type === 'run')) {
      wall.shape = null;
      wall.placement = 'unknown';
      wall.issues.push(
        'Roof-plan wall mark retained without geometry: parapet/screen base and height require a section, not a full-storey extrusion.',
      );
    }
    e.issues = [
      'Roof pitch and height matched across elevation linework and plan grids. Outline/overhang and assembly thickness still require roof-plan verification.',
    ];
  }
}
