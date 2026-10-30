import type { Project } from '../model';
import { gridAxes, registerSheets, type DrawingTexts } from './building';
import { readOpeningDetails } from './openingDetails';
import type { DrawingLines } from './roof';
import type { BuildModel } from './types';

/** Elevation counts have an address: view grids give the horizontal coordinate,
 * the opening detail supplies floor/sill/size, and the outer wall supplies its host plane. */
export function recoverFacadeOpenings(
  model: BuildModel,
  project: Project,
  texts: DrawingTexts,
  lines: DrawingLines,
  origin: [number, number],
) {
  const details = readOpeningDetails(project, texts, lines);
  const regs = registerSheets(project, texts);
  const reference = project.sheets
    .filter((s) => regs[s.id] && !regs[s.id].rotation)
    .sort((a, b) => regs[b.id].grids.length - regs[a.id].grids.length)[0];
  if (!reference?.metersPerPoint) return;
  const axes = gridAxes(texts[reference.id] ?? [], reference.width, reference.height);
  const measurements = new Map(project.measurements.map((m) => [m.id, m]));
  for (const e of model.elements.filter((e) => e.trade === 'doors' && /window|glaz|curtain/i.test(e.name))) {
    const m = measurements.get(e.measurementId),
      sheet = project.sheets.find((s) => s.id === e.sheetId);
    if (!m || !sheet) continue;
    const code = m.label?.trim() ?? e.typeName.split(/\s+[–-]\s+/)[0];
    const detail = details[code];
    if (!detail) continue;
    const level = model.levels
      .filter((l) => !['roof', 'fdn'].includes(l.id))
      .sort((a, b) => Math.abs(a.elevation - detail.floor) - Math.abs(b.elevation - detail.floor))[0];
    if (!level || Math.abs(level.elevation - detail.floor) > 0.15) continue;
    if (/ELEVATION/i.test(sheet.title ?? '') && !/WINDOW ELEVATION|CURTAIN WALL/i.test(sheet.title ?? '')) {
      const [px, py] = m.points[0];
      const ts = texts[sheet.id] ?? [];
      const labels = ts.filter((t) => axes[t.str.trim()] && t.cy < py && py - t.cy < 500 && t.cx < sheet.width * 0.87);
      const rows: (typeof labels)[] = [];
      for (const t of labels) {
        const row = rows.find((r) => Math.abs(r[0].cy - t.cy) < 4 && axes[r[0].str.trim()].axis === axes[t.str.trim()].axis);
        if (row) row.push(t);
        else rows.push([t]);
      }
      const matches: { u: number; axis: 'x' | 'y'; sign: number; rowY: number; sourceX: [number, number] }[] = [];
      for (const row of rows) {
        row.sort((a, b) => a.cx - b.cx);
        const groups: (typeof row)[] = [];
        for (const t of row) {
          const group = groups.at(-1);
          if (!group || t.cx - group.at(-1)!.cx > 300 || group.some((x) => x.str === t.str)) groups.push([t]);
          else group.push(t);
        }
        for (const group of groups) {
          if (group.length < 3 || px < group[0].cx - 80 || px > group.at(-1)!.cx + 80) continue;
          const first = group[0],
            last = group.at(-1)!,
            axis = axes[first.str.trim()].axis;
          const at = (t: typeof first) =>
            axes[t.str.trim()].at * reference.metersPerPoint! -
            (axis === 'x' ? regs[reference.id].x + origin[0] : regs[reference.id].y + origin[1]);
          const scale = (at(last) - at(first)) / (last.cx - first.cx);
          if (!scale || group.some((t) => Math.abs(at(t) - (at(first) + (t.cx - first.cx) * scale)) > 0.15)) continue;
          matches.push({
            u: at(first) + (px - first.cx) * scale,
            axis,
            sign: Math.sign(scale),
            rowY: first.cy,
            sourceX: [first.cx, last.cx],
          });
        }
      }
      matches.sort((a, b) => b.rowY - a.rowY);
      const match = matches[0];
      if (!match) continue;
      const normal = match.axis === 'x' ? [0, match.sign] : [-match.sign, 0];
      const hosts: { at: [number, number]; score: number }[] = [];
      for (const wall of model.elements) {
        const run = wall.shape;
        if (wall.level !== level.id || run?.type !== 'run' || !/\bEW\d|EXTERIOR WALL|ENVELOPE/i.test(wall.name)) continue;
        for (let j = 1; j < run.points.length; j++) {
          const a = run.points[j - 1],
            b = run.points[j],
            axis = match.axis === 'x' ? 0 : 1,
            other = 1 - axis;
          if (
            Math.abs(b[other] - a[other]) > 0.4 ||
            match.u < Math.min(a[axis], b[axis]) - 0.1 ||
            match.u > Math.max(a[axis], b[axis]) + 0.1
          )
            continue;
          const at: [number, number] = axis === 0 ? [match.u, (a[1] + b[1]) / 2] : [(a[0] + b[0]) / 2, match.u];
          hosts.push({ at, score: at[0] * normal[0] + at[1] * normal[1] });
        }
      }
      hosts.sort((a, b) => b.score - a.score);
      if (!hosts[0]) continue;
      e.shape = {
        type: 'point',
        at: hosts[0].at,
        z: level.elevation + detail.sill,
        size: [detail.width, 0.15, detail.height],
        rotation: match.axis === 'x' ? 0 : Math.PI / 2,
      };
      e.level = level.id;
      e.placement = 'inferred';
      e.issues = e.issues.filter((i) => !/not a plan|not plans|isn't a plan|elevation|level.*known/i.test(i));
      e.issues.push('Façade position reconstructed from elevation grids and outer wall; opening size/sill read from window detail.');
    }
    if (e.shape?.type === 'point') {
      e.shape.size[0] = detail.width;
      e.shape.size[2] = detail.height;
      e.shape.z = level.elevation + detail.sill;
      e.opening = { width: detail.width, height: detail.height, sill: detail.sill };
      e.sources.push(detail.source);
    }
  }
}

/** A curtain-wall count is an assembly reference, not a dimensioned window.
 * Keep it in quantities until its full elevation profile can be reconstructed. */
export function rejectUnsupportedCurtainWalls(model: BuildModel) {
  const pending = model.elements.filter(
    (e) => e.origin === 'takeoff' && e.trade === 'doors' && !e.opening && /\bCW\d|curtain wall/i.test(`${e.name} ${e.typeName}`),
  );
  for (const e of pending) {
    e.shape = null;
    e.placement = 'unknown';
    e.issues.push(
      'Curtain-wall assembly profile is unresolved. Count and source are retained; a default window box would misrepresent its geometry.',
    );
  }
  if (pending.length)
    model.issues.push({
      id: 'curtain-wall-profiles',
      severity: 'warning',
      text: `${pending.length} curtain-wall assembly references need their full elevation profiles, stepped sills and mullion layout reconstructed. Quantities remain included; placeholder geometry is withheld.`,
      refs: pending.map((e) => e.id),
      sources: pending.flatMap((e) => e.sources),
    });
}
