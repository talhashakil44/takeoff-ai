import type { Project } from '../model';
import type { BuildModel, SourceRef } from './types';
import { gridAxes, type DrawingText, type DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import { sheetFrame, worldPoint } from './sheetCoordinates';

export interface RoofBeamPlane {
  topPlane: [number, number, number];
  sources: SourceRef[];
  grids: [string, string];
  heights: [number, number];
}
/** Recover primary roof-beam TOPS, not roof decking: explicit high/low beam
 * datums, their horizontal leaders, dark beam-section top edges at labelled grids,
 * and two independently drawn sections must all agree. */
export function roofBeamPlane(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
): RoofBeamPlane | null {
  const base = project.sheets.find(
    (s) =>
      !s.superseded &&
      /^A/.test(s.name) &&
      /FLOOR PLAN/.test(s.title ?? '') &&
      !/CEILING|FIRE|ENLARG/.test(s.title ?? '') &&
      sheetFrame(project, model, s),
  );
  if (!base) return null;
  const frame = sheetFrame(project, model, base)!,
    axes = gridAxes(texts[base.id] ?? [], base.width, base.height);
  const candidates: RoofBeamPlane[] = [];
  for (const sheet of project.sheets.filter(
    (s) =>
      !s.superseded &&
      /^S/.test(s.name) &&
      /SECTION|ELEVATION/i.test(s.title ?? ''),
  )) {
    const ts = texts[sheet.id] ?? [],
      ls = lines[sheet.id] ?? [];
    const numeric = (label: DrawingText) =>
      ts
        .filter(
          (t) =>
            /^\d{4,5}$/.test(t.str.trim()) &&
            Math.abs(t.cx - label.cx) < 60 &&
            t.cy > label.cy &&
            t.cy - label.cy < 15,
        )
        .sort(
          (a, b) => Math.abs(a.cx - label.cx) - Math.abs(b.cx - label.cx),
        )[0];
    const leader = (label: DrawingText) => {
      const ys = ls
        .filter(
          (l) =>
            !l.filled &&
            !l.curve &&
            Math.abs(l.y1 - l.y2) < 0.05 &&
            Math.abs(l.y1 - label.cy) < 10 &&
            Math.abs((l.x1 + l.x2) / 2 - label.cx) < 100 &&
            Math.abs(l.x2 - l.x1) > 3,
        )
        .map((l) => l.y1);
      const groups = ys
        .map((y) => ({ y, n: ys.filter((v) => Math.abs(v - y) < 0.15).length }))
        .sort((a, b) => b.n - a.n);
      return groups[0]?.n >= 3 ? groups[0].y : null;
    };
    for (const high of ts.filter((t) =>
      /^T\/?O HIGH BEAM$/i.test(t.str.trim()),
    )) {
      const low = ts.find(
        (t) =>
          /^T\/?O LOW BEAM$/i.test(t.str.trim()) &&
          Math.abs(t.cx - high.cx) < 20 &&
          t.cy > high.cy &&
          t.cy - high.cy < 200,
      );
      if (!low) continue;
      const hn = numeric(high),
        ln = numeric(low),
        hy = leader(high),
        ly = leader(low);
      if (!hn || !ln || hy === null || ly === null) continue;
      const hz = +hn.str / 1000,
        lz = +ln.str / 1000,
        scale = (hz - lz) / (ly - hy);
      if (!(scale > 0.005 && scale < 0.2)) continue;
      const grid = ts.filter(
        (t) =>
          /^[A-Z]$/.test(t.str.trim()) &&
          axes[t.str.trim()] &&
          t.cy < high.cy &&
          high.cy - t.cy < 150 &&
          t.cx < high.cx + 40 &&
          t.cx > high.cx - 1000,
      );
      const groups = grid.map((t) =>
        grid.filter((v) => Math.abs(v.cy - t.cy) < 3),
      );
      const row = groups.sort((a, b) => b.length - a.length)[0];
      if (!row || new Set(row.map((t) => t.str)).size < 3) continue;
      const at = (y: number) =>
        row.filter((g) =>
          ls.some((l) => {
            const ink = l.color ?? '';
            const rgb = /^#([0-9a-f]{6})$/i.exec(ink);
            if (!rgb) return false;
            const n = parseInt(rgb[1], 16),
              bright = Math.max(n >> 16, (n >> 8) & 255, n & 255);
            const w = Math.abs(l.x2 - l.x1) * scale;
            return (
              bright < 64 &&
              !l.filled &&
              !l.curve &&
              Math.abs(l.y1 - l.y2) < 0.05 &&
              Math.abs(l.y1 - y) < 0.3 &&
              Math.abs((l.x1 + l.x2) / 2 - g.cx) < 2 &&
              w > 0.15 &&
              w < 0.5
            );
          }),
        );
      const hi = at(hy),
        lo = at(ly);
      if (hi.length !== 1 || lo.length !== 1 || hi[0].str === lo[0].str)
        continue;
      const ha = axes[hi[0].str],
        la = axes[lo[0].str];
      if (ha.axis !== la.axis) continue;
      const wp = (a: typeof ha) =>
        worldPoint(a.axis === 'x' ? [a.at, 0] : [0, a.at], frame);
      const hp = wp(ha),
        lp = wp(la),
        dx = hp[0] - lp[0],
        dy = hp[1] - lp[1],
        den = dx * dx + dy * dy;
      if (den < 4) continue;
      const gx = ((hz - lz) * dx) / den,
        gy = ((hz - lz) * dy) / den,
        c = lz - gx * lp[0] - gy * lp[1];
      candidates.push({
        topPlane: [gx, gy, c],
        grids: [hi[0].str, lo[0].str],
        heights: [hz, lz],
        sources: [
          {
            kind: 'sheet',
            id: sheet.id,
            page: sheet.page,
            label: sheet.name,
            box: [
              Math.min(...row.map((t) => t.cx)) - 25,
              row[0].cy - 15,
              high.cx + 65,
              ly + 20,
            ],
            quote: `T/O HIGH BEAM ${hn.str} at grid ${hi[0].str}; T/O LOW BEAM ${ln.str} at grid ${lo[0].str}; datum leaders matched to drawn primary beam-section tops, not roof skin.`,
          },
        ],
      });
    }
  }
  const agreed = candidates.filter((a) =>
    candidates.some(
      (b) =>
        a !== b &&
        (a.sources[0].id !== b.sources[0].id ||
          Math.abs(a.sources[0].box![1] - b.sources[0].box![1]) > 100 ||
          Math.abs(a.sources[0].box![0] - b.sources[0].box![0]) > 100) &&
        a.topPlane.every(
          (v, i) => Math.abs(v - b.topPlane[i]) < (i === 2 ? 0.15 : 0.01),
        ),
    ),
  );
  if (!agreed.length) return null;
  const first = agreed[0];
  if (
    agreed.some((a) =>
      a.topPlane.some(
        (v, i) => Math.abs(v - first.topPlane[i]) > (i === 2 ? 0.15 : 0.01),
      ),
    )
  )
    return null;
  return { ...first, sources: agreed.flatMap((a) => a.sources) };
}
