import type { Project } from "../model";
import type { BuildModel } from "./types";
import { registerSheets, type DrawingTexts } from "./building";
import type { DrawingLines } from "./roof";
import { sheetFrame, type SheetFrame } from "./sheetCoordinates";
import { structuralEvidence, connectStructuralModel } from "./structural";
/** Register structural evidence into the existing model's coordinate system, not an independent scene. */
export function connectStructure(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
): BuildModel {
  const frames: Record<string, SheetFrame> = {};
  const anchors = project.sheets.filter(
    (s) =>
      !s.superseded &&
      /^A/.test(s.name) &&
      /FLOOR PLAN/i.test(s.title ?? "") &&
      !/CEILING|FIRE SEPARATION|ENLARG/i.test(s.title ?? ""),
  );
  for (const base of anchors) {
    const bf = sheetFrame(project, model, base);
    if (!bf || !base.metersPerPoint) continue;
    frames[base.id] = bf;
    for (const source of project.sheets.filter(
      (s) => !s.superseded && s.id !== base.id && s.metersPerPoint,
    )) {
      if (frames[source.id]) continue;
      const regs = registerSheets(
          { ...project, sheets: [base, source] },
          texts,
        ),
        br = regs[base.id],
        sr = regs[source.id];
      if (!br || !sr) continue;
      const ba = Math.cos(br.rotation ?? 0) * base.metersPerPoint,
        bb = Math.sin(br.rotation ?? 0) * base.metersPerPoint,
        den = ba * ba + bb * bb,
        ca = (bf.a * ba + bf.b * bb) / den,
        cb = (bf.b * ba - bf.a * bb) / den;
      const sa = Math.cos(sr.rotation ?? 0) * source.metersPerPoint!,
        sb = Math.sin(sr.rotation ?? 0) * source.metersPerPoint!;
      frames[source.id] = {
        a: ca * sa - cb * sb,
        b: cb * sa + ca * sb,
        tx: bf.tx + ca * (-sr.x + br.x) - cb * (-sr.y + br.y),
        ty: bf.ty + cb * (-sr.x + br.x) + ca * (-sr.y + br.y),
        residual: 0,
      };
    }
  }
  const evidence = structuralEvidence(project, model, texts, lines, frames);
  return connectStructuralModel(project, model, evidence, {}, frames);
}
