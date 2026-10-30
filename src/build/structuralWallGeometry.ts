import type { Project } from '../model';
import type { BuildModel, SourceRef } from './types';
import type { DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import { structuralRevisionContext } from './structuralRevisions';

const issuePrefix = 'Structural wall geometry withheld:';
/** A framing-plan WT mark establishes an assembly, not a complete wall solid.
 * The accepted measurement can be a fragment or cross several window/lintel
 * bays. Retain its measured axis until a wall-specific footprint, opening and
 * vertical section association exists. Storey heights are not wall heights. */
export function connectStructuralWalls(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
): BuildModel {
  if (
    !model.elements.some(
      (e) =>
        e.origin === 'takeoff' &&
        e.trade === 'structure' &&
        /^WT-?\d+\b/i.test(e.typeName),
    )
  )
    return model;
  const revision = structuralRevisionContext(project, texts, lines);
  return {
    ...model,
    elements: model.elements.map((e) => {
      if (
        e.origin !== 'takeoff' ||
        e.trade !== 'structure' ||
        !/^WT-?\d+\b/i.test(e.typeName) ||
        (e.shape?.type !== 'run' && e.shape?.type !== 'axis')
      )
        return e;
      const measurement = project.measurements.find(
        (m) => m.id === e.measurementId,
      );
      const sheet = project.sheets.find((s) => s.id === e.sheetId);
      const code = e.typeName.match(/^WT-?\d+\b/i)![0];
      const sources: SourceRef[] = [...e.sources];
      if (
        measurement?.points.length &&
        sheet &&
        !revision.pending &&
        revision.replacements[sheet.id]
      ) {
        const ref = revision.source({
          kind: 'sheet',
          id: sheet.id,
          page: sheet.page,
          label: sheet.name,
          box: [
            Math.min(...measurement.points.map((p) => p[0])) - 10,
            Math.min(...measurement.points.map((p) => p[1])) - 10,
            Math.max(...measurement.points.map((p) => p[0])) + 10,
            Math.max(...measurement.points.map((p) => p[1])) + 10,
          ],
          quote: `${code} framing-plan measurement locator only. A framing schedule identifies the wall assembly; this record has no uniquely associated wall section, complete plan footprint or opening cuts.`,
        });
        sources.push(ref);
      }
      const z =
        model.levels.find((l) => l.id === e.level)?.elevation ??
        (e.shape.type === 'run' ? e.shape.z0 : e.shape.z);
      return {
        ...e,
        shape: {
          type: 'axis' as const,
          points: e.shape.points.map((p) => [...p] as [number, number]),
          z,
        },
        placement: 'inferred' as const,
        sources: [
          ...new Map(sources.map((s) => [JSON.stringify(s), s])).values(),
        ],
        issues: [
          ...new Set([
            ...e.issues.filter((i) => !i.startsWith(issuePrefix)),
            `${issuePrefix} ${code} has no uniquely mapped base/top section, complete wall footprint or window/door/lintel cuts. A full-storey extrusion and generic thickness are unsupported; measured axis and accepted quantity retained.${revision.pending ? ' Latest structural replacement evidence is also unavailable or unregistered.' : ''}`,
          ]),
        ],
      };
    }),
  };
}
