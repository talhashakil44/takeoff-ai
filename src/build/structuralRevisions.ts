import type { Project } from '../model';
import type { BuildModel, SourceRef } from './types';
import { gridAxes, type DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import { roofViewportRegistrations } from './roofRegistration';
export interface StructuralReplacement {
  docId: string;
  page: number;
  key: string;
  name: string;
}
/** Change-index paragraphs are discovery only. Include intervening pages because
 * schedule-only replacement sheets may have no extracted change paragraph. */
export function structuralRevisionPages(
  project: Project,
): { docId: string; page: number }[] {
  const books = (project.specs ?? [])
    .flatMap((s) => (s.book ? [{ ...s, book: s.book }] : []))
    .filter(
      (s) =>
        s.book.addendum &&
        (s.book.changes ?? []).some((c) =>
          /Structural Addendum/i.test(c.text),
        ) &&
        (s.book.changes ?? []).some((c) =>
          /ROOF FRAMING PLAN|MAIN FRAMING PLAN|HIGH ROOF FRAMING PLAN/i.test(
            c.text,
          ),
        ),
    );
  if (!books.length) return [];
  const newest = Math.max(...books.map((s) => s.book.addendum!));
  return books
    .filter((s) => s.book.addendum === newest)
    .flatMap((s) => {
      const start = Math.min(
        ...(s.book.changes ?? [])
          .filter((c) =>
            /Structural Addendum|structural schedules/i.test(c.text),
          )
          .map((c) => c.page),
      );
      return Array.from(
        { length: Math.max(0, s.book.pages - start + 1) },
        (_, i) => ({ docId: s.id, page: start + i }),
      );
    });
}
export const roofRevisionPages = structuralRevisionPages;
export interface StructuralRevisionContext {
  project: Project;
  texts: DrawingTexts;
  lines: DrawingLines;
  replacements: Record<string, StructuralReplacement>;
  pending: boolean;
  unresolved: string[];
  source: (ref: SourceRef) => SourceRef;
}
/** Retain original measurement IDs and source locations. Revised drawings are
 * substituted only after title-block discovery and plan coordinate agreement.
 * A moved viewport needs a real transform; it cannot reuse old count positions. */
export function structuralRevisionContext(
  project: Project,
  texts: DrawingTexts,
  lines: DrawingLines,
): StructuralRevisionContext {
  const pages = structuralRevisionPages(project),
    replacements: Record<string, StructuralReplacement> = {},
    unresolved: string[] = [];
  const outTexts = { ...texts },
    outLines = { ...lines },
    sheets = [...project.sheets];
  const width = Math.max(
      ...project.sheets.filter((s) => /^S\d/.test(s.name)).map((s) => s.width),
      0,
    ),
    height = Math.max(
      ...project.sheets.filter((s) => /^S\d/.test(s.name)).map((s) => s.height),
      0,
    );
  let pending = false;
  for (const candidate of pages) {
    const key = `spec:${candidate.docId}:${candidate.page}`,
      ts = texts[key],
      ls = lines[key];
    if (!ts?.length) {
      const changes =
        project.specs
          ?.find((s) => s.id === candidate.docId)
          ?.book?.changes?.filter((c) => c.page === candidate.page) ?? [];
      const narrative =
        changes.length > 0 &&
        changes.every((c) => c.text.length < 180) &&
        !changes.some((c) =>
          /SCALE.*1\s*:|FRAMING PLAN|BEAM SCHEDULE|T\/O/i.test(c.text),
        );
      if (!narrative) pending = true;
      continue;
    }
    const names = [
      ...new Set(
        ts
          .filter(
            (t) =>
              /^S\d+\.\d+$/.test(t.str.trim()) &&
              t.cx > width * 0.92 &&
              t.cy > height * 0.8,
          )
          .map((t) => t.str.trim()),
      ),
    ];
    if (names.length !== 1) continue;
    if (!ls) {
      pending = true;
      continue;
    }
    const name = names[0],
      old = project.sheets.find((s) => !s.superseded && s.name === name),
      replacement = { ...candidate, key, name };
    if (old) {
      const plan = ts.some((t) =>
        /^(?:MAIN FRAMING|MAIN FLOOR FRAMING|HIGH ROOF FRAMING|LOW ROOF FRAMING|ROOF FRAMING|FOUNDATION|ROOF UPLIFT|FLOOR DIAPHRAGM|ROOF DIAPHRAGM) PLAN$/.test(
          t.str.trim(),
        ),
      );
      if (
        plan &&
        /PLAN|FRAMING/i.test(old.title ?? '') &&
        !/SECTION|DETAIL/i.test(old.title ?? '')
      ) {
        const a = gridAxes(texts[old.id] ?? [], old.width, old.height),
          b = gridAxes(ts, old.width, old.height);
        const matches = Object.keys(a).filter(
          (k) =>
            b[k] &&
            a[k].axis === b[k].axis &&
            Math.abs(a[k].at - b[k].at) < 0.5,
        );
        if (
          matches.filter((k) => /^\d+$/.test(k)).length < 3 ||
          matches.filter((k) => /^[A-Z]$/.test(k)).length < 3
        ) {
          unresolved.push(name);
          continue;
        }
      }
      replacements[old.id] = replacement;
      outTexts[old.id] = ts;
      outLines[old.id] = ls;
    } else {
      // New schedule/detail sheet: coordinates belong only to the replacement PDF.
      const template = project.sheets.find((s) => /^S\d/.test(s.name));
      if (!template) {
        pending = true;
        continue;
      }
      sheets.push({
        ...template,
        id: key,
        docId: candidate.docId,
        page: candidate.page,
        name,
        title: ts.some((t) => /SCHEDULE$/.test(t.str.trim()))
          ? 'SCHEDULES'
          : 'STRUCTURAL REVISION',
        metersPerPoint: null,
        superseded: false,
      });
      replacements[key] = replacement;
      outTexts[key] = ts;
      outLines[key] = ls;
    }
  }
  const source = (ref: SourceRef): SourceRef => {
    const replacement = replacements[ref.id];
    if (!replacement) return ref;
    return {
      ...ref,
      kind: 'spec',
      id: replacement.docId,
      page: replacement.page,
      label: `${replacement.name} · ${project.specs?.find((s) => s.id === replacement.docId)?.name ?? 'Structural revision'}`,
    };
  };
  return {
    project: { ...project, sheets },
    texts: outTexts,
    lines: outLines,
    replacements,
    pending: pending || unresolved.length > 0,
    unresolved,
    source,
  };
}

/** Apply replacement drawing evidence without rewriting any takeoff record.
 * The temporary member code selects a revised physical schedule section only. */
export function withRevisedRoofSources(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
  resolve: (
    project: Project,
    model: BuildModel,
    texts: DrawingTexts,
    lines: DrawingLines,
  ) => BuildModel,
): BuildModel {
  if (!structuralRevisionPages(project).length)
    return resolve(project, model, texts, lines);
  const ctx = structuralRevisionContext(project, texts, lines),
    regs = roofViewportRegistrations(project, model, texts);
  if (ctx.pending)
    return {
      ...model,
      elements: model.elements.map((e) =>
        regs[e.measurementId] ||
        e.issues.some((i) =>
          /^Physical (?:high-roof|low-roof|roof column|canopy)/.test(i),
        )
          ? {
              ...e,
              shape: null,
              placement: 'unknown' as const,
              issues: [
                ...e.issues.filter(
                  (i) => !i.startsWith('Structural roof revision:'),
                ),
                'Structural roof revision: replacement drawing evidence is missing or not registered; original-sheet physical geometry withheld. Quantities remain unchanged.',
              ],
            }
          : e,
      ),
    };
  const revisedRegs = roofViewportRegistrations(ctx.project, model, ctx.texts),
    codes = new Map<string, string>();
  const working = {
    ...model,
    elements: model.elements.map((e) => {
      const m = project.measurements.find((m) => m.id === e.measurementId),
        r = revisedRegs[e.measurementId],
        old = e.typeName.match(/^(B\d+)\b/)?.[1];
      if (
        !m ||
        !r ||
        !old ||
        !ctx.replacements[m.sheetId] ||
        m.points.length !== 2
      )
        return e;
      const horizontal = Math.abs(m.points[0][1] - m.points[1][1]) < 0.3,
        vertical = Math.abs(m.points[0][0] - m.points[1][0]) < 0.3;
      if (!horizontal && !vertical) return e;
      const axis = horizontal ? 0 : 1,
        cross = 1 - axis,
        lo = Math.min(m.points[0][axis], m.points[1][axis]),
        hi = Math.max(m.points[0][axis], m.points[1][axis]),
        at = (m.points[0][cross] + m.points[1][cross]) / 2;
      const marks = [
        ...new Set(
          (ctx.texts[m.sheetId] ?? [])
            .filter(
              (t) =>
                /^B\d+$/.test(t.str.trim()) &&
                (axis === 0 ? t.cx : t.cy) > lo &&
                (axis === 0 ? t.cx : t.cy) < hi &&
                Math.abs((cross === 0 ? t.cx : t.cy) - at) * r.metersPerPoint <
                  0.9,
            )
            .map((t) => t.str.trim()),
        ),
      ];
      if (marks.length !== 1) return e;
      codes.set(e.id, marks[0]);
      return { ...e, typeName: e.typeName.replace(/^B\d+\b/, marks[0]) };
    }),
  };
  const output = resolve(ctx.project, working, ctx.texts, ctx.lines);
  return {
    ...output,
    elements: output.elements.map((e) => {
      const original = model.elements.find((v) => v.id === e.id);
      if (!original) return e;
      const physical = e.shape?.type === 'run' || e.shape?.type === 'point';
      const code = codes.get(e.id),
        old = original.typeName.match(/^(B\d+)\b/)?.[1];
      const sources = e.sources.map((s) =>
        original.sources.includes(s) ? s : ctx.source(s),
      );
      return {
        ...e,
        typeName: original.typeName,
        name: original.name,
        quantity: original.quantity,
        unit: original.unit,
        sources: [
          ...new Map(sources.map((s) => [JSON.stringify(s), s])).values(),
        ],
        issues: [
          ...e.issues.filter((i) => !i.startsWith('Structural roof revision:')),
          ...(physical && code && old !== code
            ? [
                `Structural roof revision: revised plan marks this physical member ${code}, replacing takeoff designation ${old}. Physical section comes from the revised schedule; original takeoff type and quantity are retained and unreconciled.`,
              ]
            : []),
        ],
      };
    }),
  };
}
