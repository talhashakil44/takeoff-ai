import type { Project, Pt } from "../model";
import type {
  BuildElement,
  BuildModel,
  ElementShape,
  SourceRef,
} from "./types";
import { gridAxes, type DrawingTexts } from "./building";
import type { DrawingLines } from "./roof";
import { readOpeningDetails } from "./openingDetails";
import { simpleRing } from "./surface";
import { worldPoint, type SheetFrame } from "./sheetCoordinates";

export interface StructuralSection {
  code: string;
  width: number;
  depth: number;
  description: string;
  posts?: string;
  source: SourceRef;
  conflict?: string;
}
export interface StructuralEvidence {
  section?: StructuralSection;
  span?: [Pt, Pt];
  head?: number;
  opening?: string;
  sources: SourceRef[];
  issues: string[];
  shape: ElementShape | null;
  reviewed?: boolean;
}
export interface StructuralPlacement {
  sheetId: string;
  points: Pt[];
  kind: "run" | "surface" | "point";
  width: number;
  depth: number;
  bottom: number;
  evidence: SourceRef[];
  note: string;
  fingerprint: string;
}
export const structuralFingerprint = (e: BuildElement, p: Project) =>
  JSON.stringify([
    p.measurements.find((m) => m.id === e.measurementId),
    p.types.find((t) => t.id === e.typeId),
    p.sheets.find((s) => s.id === e.sheetId),
  ]);
/** SIZE and POSTS are different columns. Never take the nearest dimensional text across column boundaries. */
export function structuralSections(
  project: Project,
  texts: DrawingTexts,
): Record<string, StructuralSection> {
  const out: Record<string, StructuralSection> = {};
  for (const sheet of project.sheets.filter(
    (s) => !s.superseded && /^S/.test(s.name),
  )) {
    const ts = texts[sheet.id] ?? [];
    for (const heading of ts.filter((t) =>
      /^(WOOD LINTEL|BEAM|COLUMN) SCHEDULE$/.test(t.str.trim()),
    )) {
      const header = ts.find(
        (t) =>
          t.str.trim() === "SIZE" &&
          t.cy > heading.cy &&
          t.cy - heading.cy < 35 &&
          Math.abs(t.cx - heading.cx) < 150,
      );
      if (!header) continue;
      const headers = ts.filter((t) => Math.abs(t.cy - header.cy) < 2);
      const right = headers
        .filter((t) => t.cx > header.cx + 10)
        .sort((a, b) => a.cx - b.cx)[0];
      const mark = headers
        .filter((t) => t.str === "MARK" && t.cx < header.cx)
        .sort((a, b) => b.cx - a.cx)[0];
      if (!mark) continue;
      const tags = ts.filter(
        (t) =>
          /^(L|B|BL|C)\d+$/.test(t.str.trim()) &&
          Math.abs(t.cx - mark.cx) < 10 &&
          t.cy > header.cy &&
          t.cy < header.cy + 100,
      );
      for (const tag of tags) {
        const size = ts.find(
          (t) =>
            Math.abs(t.cy - tag.cy) < 2 &&
            t.cx > mark.cx + 15 &&
            t.cx < (right?.cx ?? header.cx + 150),
        );
        if (!size) continue;
        const count = size.str.match(
          /^(\d+)\s*[-–]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
        );
        const rect = size.str.match(
          /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
        );
        if (!count && !rect) continue; // Steel shapes require section-table geometry, not a guessed bounding box.
        const width = count ? (+count[1] * +count[2]) / 1000 : +rect![1] / 1000,
          depth = count ? +count[3] / 1000 : +rect![2] / 1000;
        const posts =
          right?.str === "POSTS"
            ? ts.find(
                (t) =>
                  Math.abs(t.cy - tag.cy) < 2 &&
                  t.cx >= right.cx &&
                  t.cx < right.cx + 75,
              )?.str
            : undefined;
        const code = tag.str.trim();
        const entry = {
          code,
          width,
          depth,
          description: size.str,
          posts,
          source: {
            kind: "sheet" as const,
            id: sheet.id,
            page: sheet.page,
            label: sheet.name,
            box: [
              mark.cx - 12,
              tag.cy - 7,
              right?.str === "POSTS"
                ? right.cx + 75
                : (right?.cx ?? size.cx + 70),
              tag.cy + 12,
            ] as [number, number, number, number],
            quote: `${heading.str}: ${code} SIZE ${size.str}${posts ? `; POSTS ${posts}` : ""}`,
          },
        };
        if (
          out[code] &&
          (Math.abs(out[code].width - width) > 0.001 ||
            Math.abs(out[code].depth - depth) > 0.001)
        ) {
          out[code].conflict = "Conflicting schedule sizes; review revisions.";
        } else out[code] = entry;
      }
    }
  }
  return out;
}
/** Strong isolated member strokes under a tag, supported at both ends by perpendicular linework. */
export function lintelSpan(
  at: Pt,
  lines: DrawingLines[string],
  k: number,
): [Pt, Pt] | null {
  const ink = lines.filter(
    (l) =>
      !l.curve &&
      !l.dashed &&
      !l.filled &&
      (!l.color || /^#(?:00|11|22|33)/i.test(l.color)),
  );
  const candidates = ink
    .flatMap((l) => {
      const dx = l.x2 - l.x1,
        dy = l.y2 - l.y1,
        len = Math.hypot(dx, dy);
      if (len * k < 0.15 || len * k > 6 || l.width < 0.75) return [];
      const ux = dx / len,
        uy = dy / len,
        t = (at[0] - l.x1) * ux + (at[1] - l.y1) * uy,
        off = Math.abs((at[0] - l.x1) * uy - (at[1] - l.y1) * ux);
      if (
        t * k < -0.7 ||
        (t - len) * k > 0.7 ||
        off * k > 0.95 ||
        off * k < 0.12
      )
        return [];
      const support = ink.flatMap((s) => {
        const sx = s.x2 - s.x1,
          sy = s.y2 - s.y1,
          n = Math.hypot(sx, sy);
        if (
          n * k < 0.08 ||
          n * k > 0.3 ||
          Math.abs((sx * ux + sy * uy) / n) > 0.12
        )
          return [];
        const side1 = (s.x1 - l.x1) * uy - (s.y1 - l.y1) * ux,
          side2 = (s.x2 - l.x1) * uy - (s.y2 - l.y1) * ux;
        if (Math.min(side1, side2) > 0.3 || Math.max(side1, side2) < -0.3)
          return [];
        return [
          ((s.x1 + s.x2) / 2 - l.x1) * ux + ((s.y1 + s.y2) / 2 - l.y1) * uy,
        ];
      });
      const left = support.filter((v) => v < t - 3).sort((a, b) => b - a)[0],
        right = support.filter((v) => v > t + 3).sort((a, b) => a - b)[0];
      if (
        left === undefined ||
        right === undefined ||
        (right - left) * k < 0.25 ||
        (right - left) * k > 6 ||
        left > len ||
        right < 0
      )
        return [];
      const span: [[number, number], [number, number]] = [
        [l.x1 + left * ux, l.y1 + left * uy],
        [l.x1 + right * ux, l.y1 + right * uy],
      ];
      return [{ span, score: off + Math.abs(t - (left + right) / 2) * 0.1 }];
    })
    .sort((a, b) => a.score - b.score);
  if (!candidates.length) return null;
  const best = candidates[0];
  if (
    candidates.some(
      (c, i) =>
        i &&
        c.score < best.score + 2 &&
        Math.hypot(
          c.span[0][0] - best.span[0][0],
          c.span[0][1] - best.span[0][1],
        ) > 3 &&
        Math.hypot(
          c.span[1][0] - best.span[0][0],
          c.span[1][1] - best.span[0][1],
        ) > 3,
    )
  )
    return null;
  return best.span;
}
export function structuralEvidence(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
  frames: Record<string, SheetFrame>,
): Record<string, StructuralEvidence> {
  const sections = structuralSections(project, texts),
    openings = readOpeningDetails(project, texts, lines),
    out: Record<string, StructuralEvidence> = {};
  const arch = project.sheets.filter(
    (s) =>
      /^A/.test(s.name) &&
      frames[s.id] &&
      /FLOOR PLAN/i.test(s.title ?? "") &&
      !/CEILING|FIRE SEPARATION/.test(s.title ?? ""),
  );
  for (const e of model.elements.filter(
    (e) => e.origin === "takeoff" && e.trade === "structure",
  )) {
    const sheet = project.sheets.find((s) => s.id === e.sheetId),
      m = project.measurements.find((m) => m.id === e.measurementId),
      frame = frames[e.sheetId];
    const code = e.typeName.match(/^(L\d+|B\d+|C\d+|BL\d+)\b/)?.[1],
      section = code ? sections[code] : undefined;
    const item: StructuralEvidence = {
      section,
      sources: section ? [section.source] : [],
      issues: [],
      shape: null,
    };
    out[e.id] = item;
    if (section && /^L\d+$/.test(code!)) {
      const specs =
        project.specs?.flatMap((doc) =>
          (doc.book?.sections ?? [])
            .filter(
              (s) => s.number.replace(/\s/g, "") === "061000" && s.pages.length,
            )
            .map((s) => ({ doc, section: s })),
        ) ?? [];
      for (const { doc, section: spec } of specs)
        item.sources.push({
          kind: "spec",
          id: doc.id,
          page: spec.pages[0],
          label: spec.number,
          section: spec.key,
          quote:
            "Rough carpentry governs material/workmanship; member dimensions come from the structural schedule.",
        });
      if (!specs.length)
        item.issues.push(
          "Issued rough-carpentry specification not available in this project.",
        );
    }
    if (!section) {
      item.issues.push(
        "Member or assembly dimensions need a source-linked review.",
      );
      continue;
    }
    if (section.conflict) {
      item.issues.push(section.conflict);
      continue;
    }
    if (/^L\d+$/.test(code!) && /^05/.test(e.division))
      item.issues.push(
        "Existing takeoff division is Metals; the schedule identifies a wood lintel. Original classification is retained for review.",
      );
    if (section.posts && e.typeName.includes(section.posts))
      item.issues.push(
        "Existing takeoff description names the POSTS column. Geometry uses the schedule SIZE column; original quantity and label are preserved.",
      );
    if (!sheet?.metersPerPoint || !frame || !m?.points.length) {
      item.issues.push("Calibrated floor registration is required.");
      continue;
    }
    if (!/^L\d+$/.test(code!)) {
      item.issues.push("Member endpoints and elevation need review.");
      continue;
    }
    const span = lintelSpan(
      m.points[0],
      lines[sheet.id] ?? [],
      sheet.metersPerPoint,
    );
    if (!span) {
      item.issues.push(
        "No unambiguous supported lintel stroke found at this tag.",
      );
      continue;
    }
    item.span = span;
    const a = worldPoint(span[0], frame),
      b = worldPoint(span[1], frame),
      mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    item.sources.push({
      kind: "sheet",
      id: sheet.id,
      page: sheet.page,
      label: sheet.name,
      box: [
        Math.min(...span.map((p) => p[0])) - 8,
        Math.min(...span.map((p) => p[1])) - 8,
        Math.max(...span.map((p) => p[0])) + 8,
        Math.max(...span.map((p) => p[1])) + 8,
      ],
      quote: `${code}: supported member stroke; calibrated span ${length.toFixed(3)} m`,
    });
    const matches = arch
      .flatMap((s) =>
        (texts[s.id] ?? []).flatMap((t) => {
          const detail = openings[t.str.trim()];
          if (!detail) return [];
          const p = worldPoint([t.cx, t.cy], frames[s.id]),
            dist = Math.hypot(p[0] - mid[0], p[1] - mid[1]);
          if (dist > 1.2 || Math.abs(detail.width - length) > 0.12) return [];
          return [{ detail, dist, s, t }];
        }),
      )
      .sort((a, b) => a.dist - b.dist);
    // Elevation window tags have grid addresses; plan W1/W2 often mean WALL types.
    if (!matches.length)
      for (const base of arch.filter((s) =>
        model.levels.find((l) => l.id === e.level)?.sheets.includes(s.id),
      )) {
        const axes = gridAxes(texts[base.id] ?? [], base.width, base.height),
          bf = frames[base.id];
        for (const elevation of project.sheets.filter(
          (s) => !s.superseded && /BUILDING ELEVATION/i.test(s.title ?? ""),
        )) {
          const ts = texts[elevation.id] ?? [];
          for (const tag of ts) {
            const detail = openings[tag.str.trim()];
            if (
              !detail ||
              Math.abs(
                detail.floor -
                  (model.levels.find((l) => l.id === e.level)?.elevation ??
                    NaN),
              ) > 0.15 ||
              Math.abs(detail.width - length) > 0.12
            )
              continue;
            const labels = ts.filter(
              (t) =>
                axes[t.str.trim()] &&
                t.cy < tag.cy &&
                tag.cy - t.cy < 500 &&
                t.cx < elevation.width * 0.87,
            );
            const rows: (typeof labels)[] = [];
            for (const t of labels) {
              const r = rows.find(
                (r) =>
                  Math.abs(r[0].cy - t.cy) < 4 &&
                  axes[r[0].str.trim()].axis === axes[t.str.trim()].axis,
              );
              if (r) r.push(t);
              else rows.push([t]);
            }
            rows.sort((a, b) => b[0].cy - a[0].cy);
            const groups: (typeof labels)[] = [];
            for (const row of rows) {
              row.sort((a, b) => a.cx - b.cx);
              let group: typeof labels = [];
              for (const t of row) {
                if (
                  group.length &&
                  (t.cx - group.at(-1)!.cx > 300 ||
                    group.some((v) => v.str === t.str))
                ) {
                  groups.push(group);
                  group = [];
                }
                group.push(t);
              }
              if (group.length) groups.push(group);
            }
            for (const row of groups) {
              if (
                row.length < 3 ||
                tag.cx < row[0].cx - 30 ||
                tag.cx > row.at(-1)!.cx + 30 ||
                new Set(row.map((t) => t.str)).size !== row.length
              )
                continue;
              const first = row[0],
                last = row.at(-1)!,
                axis = axes[first.str.trim()].axis;
              const factor =
                (axes[last.str.trim()].at - axes[first.str.trim()].at) /
                (last.cx - first.cx);
              if (
                row.some(
                  (t) =>
                    Math.abs(
                      axes[t.str.trim()].at -
                        (axes[first.str.trim()].at +
                          (t.cx - first.cx) * factor),
                    ) *
                      (base.metersPerPoint ?? 0) >
                    0.08,
                )
              )
                continue;
              const coord =
                axes[first.str.trim()].at + (tag.cx - first.cx) * factor;
              const p = worldPoint(axis === "x" ? [coord, 0] : [0, coord], bf),
                direction = axis === "x" ? [bf.a, bf.b] : [-bf.b, bf.a],
                n = Math.hypot(...direction);
              const dist = Math.abs(
                ((mid[0] - p[0]) * direction[0]) / n +
                  ((mid[1] - p[1]) * direction[1]) / n,
              );
              if (dist < 0.8)
                matches.push({ detail, dist, s: elevation, t: tag });
              break;
            }
          }
        }
      }
    matches.sort((a, b) => a.dist - b.dist);
    if (
      !matches.length ||
      (matches[1] && matches[1].dist - matches[0].dist < 0.25)
    ) {
      item.issues.push(
        "Opening head elevation is unresolved; match the elevation/detail before placing vertically.",
      );
      continue;
    }
    const match = matches[0],
      d = match.detail;
    item.opening = d.code;
    item.head = d.floor + d.sill + d.height;
    item.sources.push(d.source, {
      kind: "sheet",
      id: match.s.id,
      page: match.s.page,
      label: match.s.name,
      box: [match.t.cx - 15, match.t.cy - 15, match.t.cx + 15, match.t.cy + 15],
      quote: `${d.code}: opening matched to lintel by drawing grids, position and span`,
    });
    item.issues.push(
      "Opening head is inferred from the matched window detail; confirm rough-opening allowance and lintel bearing before fabrication.",
    );
    item.shape = {
      type: "run",
      points: [a, b],
      z0: item.head,
      height: section.depth,
      thickness: section.width,
    };
  }
  return out;
}
export function reviewedShape(
  p: StructuralPlacement,
  frame: SheetFrame,
): ElementShape | null {
  if (
    !p ||
    !Array.isArray(p.points) ||
    !p.points.every((pt) => Array.isArray(pt) && pt.length === 2) ||
    !Array.isArray(p.evidence) ||
    typeof p.note !== "string"
  )
    return null;
  if (
    ![p.width, p.depth, p.bottom, ...p.points.flat()].every(Number.isFinite) ||
    p.depth <= 0 ||
    p.width <= 0 ||
    p.depth > 20 ||
    p.width > 20 ||
    Math.abs(p.bottom) > 100 ||
    !p.evidence.length ||
    !p.note.trim()
  )
    return null;
  const points = p.points.map((pt) => worldPoint(pt, frame));
  if (
    p.kind === "run" &&
    points.length >= 2 &&
    Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) > 0.05
  )
    return {
      type: "run",
      points,
      z0: p.bottom,
      height: p.depth,
      thickness: p.width,
    };
  if (p.kind === "point" && points.length === 1)
    return {
      type: "point",
      at: points[0],
      z: p.bottom,
      size: [p.width, p.width, p.depth],
    };
  if (p.kind === "surface" && points.length >= 3 && simpleRing(points))
    return {
      type: "surface",
      ring: points,
      holes: [],
      z: p.bottom,
      thickness: p.depth,
    };
  return null;
}

/** Presentation model only: identity and accepted quantities are never rewritten. */
export function connectStructuralModel(
  project: Project,
  model: BuildModel,
  evidence: Record<string, StructuralEvidence>,
  reviews: Record<string, StructuralPlacement>,
  frames: Record<string, SheetFrame>,
): BuildModel {
  return {
    ...model,
    elements: model.elements.map((e) => {
      const ev = evidence[e.id];
      if (!ev) return e;
      const review = reviews?.[e.id],
        frame = frames[e.sheetId];
      const reviewed =
        review &&
        frame &&
        review.sheetId === e.sheetId &&
        review.fingerprint === structuralFingerprint(e, project)
          ? reviewedShape(review, frame)
          : null;
      const shape = reviewed ?? ev.shape;
      const count =
        project.types.find((t) => t.id === e.typeId)?.kind === "count";
      const sources = reviewed ? review.evidence : ev.sources;
      return {
        ...e,
        shape: shape ?? (count ? null : e.shape),
        placement: shape ? "inferred" : count ? "unknown" : e.placement,
        specs: [
          ...e.specs,
          ...sources
            .filter(
              (s) =>
                s.kind === "spec" &&
                s.section &&
                !e.specs.some((v) => v.key === s.section),
            )
            .map((s) => ({ key: s.section!, basis: "inferred" as const })),
        ],
        sources: [
          ...new Map(
            [...e.sources, ...sources].map((s) => [JSON.stringify(s), s]),
          ).values(),
        ],
        issues: [
          ...ev.issues,
          ...(reviewed ? [`Reviewed geometry: ${review.note}`] : []),
        ],
      };
    }),
  };
}
