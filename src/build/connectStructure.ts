import { connectSourceColumns } from "./columnGeometry";
import { recoverRoofCantilevers } from "./roofCantileverGeometry";
import { connectStructuralWalls } from "./structuralWallGeometry";
import { withRevisedRoofSources } from "./structuralRevisions";
import {
  beginPhysicalGeometry,
  endPhysicalGeometry,
} from "./physicalGeometryLifecycle";
import { suppressCoincidentStructure } from "./coincidentStructure";
import { canopyRegistrations } from "./canopyRegistration";
import { canopyMemberGeometry } from "./canopyMemberGeometry";
import { connectFlatRoofMembers } from "./flatRoofBeamGeometry";
import { connectRoofMembers } from "./roofMemberGeometry";
import { connectFloorBeams } from "./floorBeamGeometry";
import { recoverFoundationGeometry } from "./foundationGeometry";
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
  return suppressCoincidentStructure(
    connectPhysicalStructure(
      project,
      connectStructuralModel(project, model, evidence, {}, frames),
      texts,
      lines,
      frames,
    ),
  );
}

/** Shared source-backed geometry pipeline for Build, Explore and IFC. */
export function connectPhysicalStructure(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
  registeredFrames: Record<string, SheetFrame> = {},
): BuildModel {
  const baseline = connectStructuralWalls(
    project,
    beginPhysicalGeometry(project, model),
    texts,
    lines,
  );
  const floor = connectFloorBeams(project, baseline, texts, lines);
  const roof = withRevisedRoofSources(
    project,
    floor,
    texts,
    lines,
    (sourceProject, sourceModel, sourceTexts, sourceLines) => {
      const supportedRoof = connectRoofMembers(
        sourceProject,
        sourceModel,
        sourceTexts,
        sourceLines,
      );
      const highRoof = recoverRoofCantilevers(
        sourceProject,
        supportedRoof,
        sourceTexts,
        sourceLines,
      );
      const lowRoof = connectFlatRoofMembers(
        sourceProject,
        highRoof,
        sourceTexts,
        sourceLines,
      );
      const columns = connectSourceColumns(
        sourceProject,
        lowRoof,
        sourceTexts,
        sourceLines,
        registeredFrames,
      );
      const canopy = canopyMemberGeometry(
        sourceProject,
        sourceTexts,
        sourceLines,
        canopyRegistrations(sourceProject, columns, sourceTexts, sourceLines),
      );
      return {
        ...columns,
        elements: columns.elements.map((e) => {
          const member = canopy[e.measurementId];
          if (!member) return e;
          return {
            ...e,
            shape: member.shape,
            placement: "inferred" as const,
            sources: [
              ...new Map(
                [...e.sources, ...member.sources].map((s) => [
                  JSON.stringify(s),
                  s,
                ]),
              ).values(),
            ],
            issues: [
              ...new Set([
                ...e.issues.filter(
                  (i) => !i.includes("Calibrated") && !i.includes("plan only"),
                ),
                ...member.issues,
              ]),
            ],
          };
        }),
      };
    },
  );
  return endPhysicalGeometry(
    recoverFoundationGeometry(project, roof, texts, lines),
  );
}
