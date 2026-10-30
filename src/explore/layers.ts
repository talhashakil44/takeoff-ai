import type { Project, Sheet } from "../model";
import type { BuildElement, BuildModel } from "../build/types";
import { gridAxes, registerSheets, type DrawingTexts } from "../build/building";
import { titleBlockWords } from "../build/extract";
import { sheetFrame, worldPoint, type SheetFrame } from "./spatial";
export const disciplines = [
  "Architecture",
  "Structure",
  "Mechanical",
  "Electrical",
  "Fire protection",
  "Ceilings",
] as const;
export type Discipline = (typeof disciplines)[number];
export function discipline(s: Sheet): Discipline {
  if (/CEILING|RCP/i.test(s.title ?? "")) return "Ceilings";
  if (/^S/i.test(s.name)) return "Structure";
  if (/^(FP|F\d)/i.test(s.name)) return "Fire protection";
  if (/^E/i.test(s.name)) return "Electrical";
  if (/^(M|P)/i.test(s.name)) return "Mechanical";
  return "Architecture";
}
export function floorPlans(project: Project, model: BuildModel) {
  return project.sheets.filter(
    (s) =>
      !s.superseded &&
      discipline(s) === "Architecture" &&
      !/CEILING|ROOF|SITE|DETAIL|ENLARG|FIRE SEPARATION|FOUNDATION/i.test(
        s.title ?? "",
      ) &&
      (/FLOOR PLAN/i.test(s.title ?? "") ||
        project.measurements.some(
          (m) => m.sheetId === s.id && m.source === "rooms",
        )) &&
      sheetFrame(project, model, s),
  );
}
export interface DrawingLayer {
  sheet: Sheet;
  discipline: Discipline;
  frame: SheetFrame | null;
  level: string | null;
  elements: BuildElement[];
  reason: string;
}
/** Grid registration must have evidence on both axes; equal page size/scale is not alignment. */
export function drawingLayers(
  project: Project,
  model: BuildModel,
  base: Sheet,
  texts: DrawingTexts,
): DrawingLayer[] {
  const registrationProject = {
    ...project,
    sheets: project.sheets.map((s) => ({
      ...s,
      title: s.title || titleBlockWords(texts[s.id] ?? [], s.width, s.height),
    })),
  };
  const baseFrame = sheetFrame(project, model, base);
  return project.sheets
    .filter((s) => !s.superseded)
    .map((sheet) => {
      const registrations = registerSheets(
          {
            ...registrationProject,
            sheets: registrationProject.sheets.filter(
              (s) => s.id === base.id || s.id === sheet.id,
            ),
          },
          texts,
        ),
        anchor = registrations[base.id];
      const baseReg =
        anchor && base.metersPerPoint
          ? {
              a: Math.cos(anchor.rotation ?? 0) * base.metersPerPoint,
              b: Math.sin(anchor.rotation ?? 0) * base.metersPerPoint,
              tx: -anchor.x,
              ty: -anchor.y,
              residual: 0,
            }
          : null;
      const elements = model.elements.filter((e) => e.sheetId === sheet.id);
      const levels = [
        ...new Set(
          elements.map((e) => e.level).filter((l): l is string => !!l),
        ),
      ];
      const level =
        levels.length === 1
          ? levels[0]
          : (model.levels.find((l) => l.sheets.includes(sheet.id))?.id ?? null);
      let frame: SheetFrame | null = sheet.id === base.id ? baseFrame : null;
      const reg = registrations[sheet.id];
      if (reg && baseReg && baseFrame && sheet.metersPerPoint) {
        const den = baseReg.a ** 2 + baseReg.b ** 2;
        const ca = (baseFrame.a * baseReg.a + baseFrame.b * baseReg.b) / den;
        const cb = (baseFrame.b * baseReg.a - baseFrame.a * baseReg.b) / den;
        const sa = Math.cos(reg.rotation ?? 0) * sheet.metersPerPoint,
          sb = Math.sin(reg.rotation ?? 0) * sheet.metersPerPoint;
        frame = {
          a: ca * sa - cb * sb,
          b: cb * sa + ca * sb,
          tx:
            baseFrame.tx +
            ca * (-reg.x - baseReg.tx) -
            cb * (-reg.y - baseReg.ty),
          ty:
            baseFrame.ty +
            cb * (-reg.x - baseReg.tx) +
            ca * (-reg.y - baseReg.ty),
          residual: 0,
        };
      }
      if (!frame && baseFrame && level && sheet.id !== base.id)
        frame = matchGridFrame(base, baseFrame, sheet, texts);
      return {
        sheet,
        discipline: discipline(sheet),
        frame,
        level,
        elements,
        reason:
          sheet.id === base.id
            ? "Base floor plan"
            : frame
              ? reg
                ? `Grid match: ${reg.grids.join(", ")}`
                : "Labelled grids matched · review overlay"
              : !sheet.metersPerPoint
                ? "Needs calibrated scale"
                : "Needs grid alignment",
      };
    });
}
export function layerElement(
  e: BuildElement,
  from: SheetFrame | null,
  to: SheetFrame | null,
): BuildElement | null {
  if (!e.shape || !from || !to) return null;
  // Reproject the measured model through its original sheet coordinates.
  const den = from.a ** 2 + from.b ** 2;
  const map = (p: [number, number]): [number, number] =>
    worldPoint(
      [
        (from.a * (p[0] - from.tx) + from.b * (p[1] - from.ty)) / den,
        (-from.b * (p[0] - from.tx) + from.a * (p[1] - from.ty)) / den,
      ],
      to,
    );
  const shape = e.shape;
  return {
    ...e,
    shape:
      shape.type === "run"
        ? { ...shape, points: shape.points.map(map) }
        : shape.type === "surface"
          ? {
              ...shape,
              ring: shape.ring.map(map),
              holes: shape.holes.map((h) => h.map(map)),
            }
          : {
              ...shape,
              at: map(shape.at),
              rotation:
                (shape.rotation ?? 0) +
                Math.atan2(to.b, to.a) -
                Math.atan2(from.b, from.a),
            },
  };
}

/** Match labelled grids directly to this floor, including single-ended grid bubbles.
 * Repeated plan viewports with equally good matches are rejected as ambiguous. */
export function matchGridFrame(
  base: Sheet,
  baseFrame: SheetFrame,
  sheet: Sheet,
  texts: DrawingTexts,
): SheetFrame | null {
  if (!base.metersPerPoint || !sheet.metersPerPoint) return null;
  const axes = gridAxes(texts[base.id] ?? [], base.width, base.height);
  const labels = Object.keys(axes);
  const candidates: { frame: SheetFrame; score: number }[] = [];
  for (const quarter of [0, 1, 2, 3]) {
    const c = Math.round(Math.cos((quarter * Math.PI) / 2)),
      sn = Math.round(Math.sin((quarter * Math.PI) / 2));
    const groups = (axis: "x" | "y") => {
      const offsets = (texts[sheet.id] ?? []).flatMap((t) => {
        const key = t.str.trim(),
          ref = axes[key];
        if (!ref || ref.axis !== axis) return [];
        const coordinate =
          axis === "x" ? c * t.cx - sn * t.cy : sn * t.cx + c * t.cy;
        return [
          {
            key,
            value:
              coordinate * sheet.metersPerPoint! -
              ref.at * base.metersPerPoint!,
          },
        ];
      });
      const clusters = offsets
        .map((o) => {
          const hits = offsets.filter(
              (v) => Math.abs(v.value - o.value) < 0.12,
            ),
            byKey = new Map<string, number>();
          for (const h of hits)
            if (
              !byKey.has(h.key) ||
              Math.abs(h.value - o.value) <
                Math.abs(byKey.get(h.key)! - o.value)
            )
              byKey.set(h.key, h.value);
          const values = [...byKey.values()],
            mean = values.reduce((n, v) => n + v, 0) / values.length;
          return { n: byKey.size, mean };
        })
        .sort((a, b) => b.n - a.n);
      const unique: typeof clusters = [];
      for (const v of clusters)
        if (!unique.some((u) => Math.abs(u.mean - v.mean) < 0.2))
          unique.push(v);
      return unique.filter((v) => v.n >= 3);
    };
    for (const x of groups("x"))
      for (const y of groups("y")) {
        if (x.n + y.n < Math.min(labels.length * 0.6, 9)) continue;
        const scale = sheet.metersPerPoint / base.metersPerPoint,
          dx = -x.mean / base.metersPerPoint,
          dy = -y.mean / base.metersPerPoint;
        candidates.push({
          score: x.n + y.n,
          frame: {
            a: scale * (baseFrame.a * c - baseFrame.b * sn),
            b: scale * (baseFrame.b * c + baseFrame.a * sn),
            tx: baseFrame.a * dx - baseFrame.b * dy + baseFrame.tx,
            ty: baseFrame.b * dx + baseFrame.a * dy + baseFrame.ty,
            residual: 0.12,
          },
        });
      }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  if (
    candidates
      .slice(1)
      .some(
        (v) =>
          v.score >= best.score * 0.9 &&
          Math.hypot(v.frame.tx - best.frame.tx, v.frame.ty - best.frame.ty) >
            1,
      )
  )
    return null;
  return best.frame;
}

export function alignControlPoints(
  source: [number, number][],
  target: [number, number][],
  scale: number | null,
): SheetFrame | null {
  if (source.length !== 3 || target.length !== 3 || !scale) return null;
  const mean = (ps: [number, number][]) => [
    ps.reduce((n, p) => n + p[0], 0) / 3,
    ps.reduce((n, p) => n + p[1], 0) / 3,
  ];
  const p = mean(source),
    q = mean(target);
  let den = 0,
    a = 0,
    b = 0;
  for (let i = 0; i < 3; i++) {
    const x = source[i][0] - p[0],
      y = source[i][1] - p[1],
      u = target[i][0] - q[0],
      v = target[i][1] - q[1];
    den += x * x + y * y;
    a += x * u + y * v;
    b += x * v - y * u;
  }
  if (den * scale * scale < 4) return null;
  a /= den;
  b /= den;
  if (Math.abs(Math.hypot(a, b) / scale - 1) > 0.02) return null;
  const f = {
    a,
    b,
    tx: q[0] - a * p[0] + b * p[1],
    ty: q[1] - b * p[0] - a * p[1],
    residual: 0,
  };
  f.residual = Math.max(
    ...source.map((v, i) => {
      const w = worldPoint(v, f);
      return Math.hypot(w[0] - target[i][0], w[1] - target[i][1]);
    }),
  );
  return f.residual <= 0.15 ? f : null;
}
