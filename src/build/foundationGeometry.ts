import type { Project, Sheet } from '../model';
import { foundationMarks, sizesOf } from '../automate/foundations';
import { readSchedules, type Schedule } from '../smart/schedules';
import {
  gridAxes,
  matchGridAxes,
  type DrawingText,
  type DrawingTexts,
} from './building';
import type { DrawingLines } from './roof';
import type { BuildElement, BuildModel, SourceRef } from './types';
import {
  sheetFrame,
  sheetPoint,
  worldPoint,
  type SheetFrame,
} from './sheetCoordinates';
import type { PageText } from '../pageText';
const detailed = (ts: DrawingText[]): PageText[] =>
  ts.map((t) => ({
    ...t,
    w: Number.isFinite((t as PageText).w) ? (t as PageText).w : 0,
    h: Number.isFinite((t as PageText).h) ? (t as PageText).h : 0,
  }));

const normalized = (s: string) => s.toUpperCase().replace(/[\s.-]/g, '');
const reference = (
  s: Sheet,
  quote: string,
  box?: SourceRef['box'],
): SourceRef => ({
  kind: 'sheet',
  id: s.id,
  page: s.page,
  label: s.name,
  quote,
  box,
});

/** An elevation is accepted only with an explicit top-of-footing label, its nearby
 * signed millimetre datum, and a zero ground-floor datum on the same structural sheet.
 * Conflicting footing datums require per-location review, never a global guess. */
export function footingTopDatum(
  project: Project,
  texts: DrawingTexts,
): { z: number; sources: SourceRef[] } | null {
  if (project.units !== 'metric') return null;
  const values: { z: number; source: SourceRef }[] = [];
  const numberBelow = (ts: DrawingText[], t: DrawingText) => {
    const found = ts
      .filter(
        (v) =>
          /^-?\d{1,5}(?:\.\d+)?$/.test(v.str.trim()) &&
          v.cy >= t.cy &&
          v.cy - t.cy < 20 &&
          Math.abs(v.cx - t.cx) < 100,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.cx - t.cx, a.cy - t.cy) -
          Math.hypot(b.cx - t.cx, b.cy - t.cy),
      );
    return found[0];
  };
  for (const sheet of project.sheets.filter(
    (s) => !s.superseded && /^S/i.test(s.name),
  )) {
    const ts = texts[sheet.id] ?? [];
    const zero = ts.some(
      (t) =>
        /^(?:FIN\.?|FINISHED)\s+GROUND\s+FLOOR$/i.test(t.str.trim()) &&
        numberBelow(ts, t)?.str.trim() === '0',
    );
    if (!zero) continue;
    for (const label of ts.filter((t) =>
      /^T\s*[/.]?\s*O\.?\s+FOOTING$/i.test(t.str.trim()),
    )) {
      const n = numberBelow(ts, label);
      if (!n) continue;
      const z = Number(n.str) / 1000;
      if (z > -0.05 || z < -10) continue;
      values.push({
        z,
        source: reference(
          sheet,
          `${label.str} ${n.str} mm; FIN. GROUND FLOOR 0`,
          [
            Math.min(label.cx, n.cx) - 30,
            label.cy - 5,
            Math.max(label.cx, n.cx) + 30,
            n.cy + 5,
          ],
        ),
      });
    }
  }
  if (!values.length || values.some((v) => Math.abs(v.z - values[0].z) > 0.001))
    return null;
  return {
    z: values[0].z,
    sources: [...new Map(values.map((v) => [v.source.id, v.source])).values()],
  };
}

/** Some footing tables have a tall reinforcement-key header. Read their explicit
 * MARK/TYPE/DEPTH/SIZE columns without mistaking the reinforcement legend for rows. */
export function footingTables(ts: PageText[]): Schedule[] {
  const out: Schedule[] = [];
  for (const title of ts.filter((t) =>
    /^(?:CONCRETE\s+)?FOOTING\s+SCHEDULE$/i.test(t.str.trim()),
  )) {
    const heads = ts.filter(
      (t) =>
        t.cy > title.cy &&
        t.cy - title.cy < 60 &&
        Math.abs(t.cx - title.cx) < 450,
    );
    const mark = heads
      .filter((t) => /^MARK$/i.test(t.str.trim()) && t.cx < title.cx)
      .sort((a, b) => a.cx - b.cx)[0];
    const type = heads.find((t) => /^TYPE$/i.test(t.str.trim()));
    const depth = heads.find((t) =>
      /^(?:DEPTH|THICKNESS)$/i.test(t.str.trim()),
    );
    const size = heads.find(
      (t) =>
        /^SIZE$/i.test(t.str.trim()) &&
        !!depth &&
        t.cx > depth.cx &&
        t.cx - depth.cx < 120,
    );
    if (
      !mark ||
      !type ||
      !depth ||
      !size ||
      !(mark.cx < type.cx && type.cx < depth.cx && depth.cx < size.cx)
    )
      continue;
    const end =
      ts
        .filter(
          (t) =>
            t.cy > title.cy + 20 &&
            /SCHEDULE$/i.test(t.str.trim()) &&
            Math.abs(t.cx - title.cx) < 300,
        )
        .sort((a, b) => a.cy - b.cy)[0]?.cy ?? title.cy + 450;
    const rows = ts
      .filter(
        (t) =>
          /^(?:SF-?\d+|F\d+)$/i.test(t.str.trim()) &&
          Math.abs(t.cx - mark.cx) < 25 &&
          t.cy > mark.cy &&
          t.cy < end,
      )
      .flatMap((tag) => {
        const row = ts.filter((t) => Math.abs(t.cy - tag.cy) < 3);
        const nearest = (head: PageText, pattern: RegExp) =>
          row
            .filter(
              (t) =>
                Math.abs(t.cx - head.cx) < 30 && pattern.test(t.str.trim()),
            )
            .sort(
              (a, b) => Math.abs(a.cx - head.cx) - Math.abs(b.cx - head.cx),
            )[0];
        const ty = nearest(type, /^[PS]$/i),
          d = nearest(depth, /^\d+(?:\.\d+)?$/),
          z = nearest(size, /^\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?$/i);
        if (
          !ty ||
          !d ||
          !z ||
          !sizesOf(d.str, true).length ||
          !sizesOf(z.str, true).length
        )
          return [];
        return [
          {
            mark: tag.str.trim(),
            cells: [tag.str.trim(), ty.str, d.str, z.str],
            box: [
              tag.cx - tag.w / 2,
              tag.cy - tag.h / 2,
              z.cx + z.w / 2,
              tag.cy + tag.h / 2,
            ] as SourceRef['box'],
          },
        ];
      });
    if (rows.length)
      out.push({
        title: title.str,
        kind: 'structure',
        columns: [['MARK'], ['TYPE'], ['DEPTH'], ['SIZE']],
        markColumn: 0,
        rows,
        box: [
          mark.cx - 30,
          title.cy - 10,
          size.cx + 60,
          Math.max(...rows.map((r) => r.box![3])),
        ],
      });
  }
  return out;
}

function pierTables(ts: PageText[]): Schedule[] {
  return ts
    .filter((t) => /^(?:CONCRETE )?PIER SCHEDULE$/i.test(t.str.trim()))
    .flatMap((title) => {
      const heads = ts.filter(
        (t) =>
          t.cy > title.cy &&
          t.cy < title.cy + 60 &&
          Math.abs(t.cx - title.cx) < 300,
      );
      const mark = heads.find((t) => t.str.trim() === 'MARK'),
        size = heads.find((t) => t.str.trim() === 'SIZE');
      if (!mark || !size) return [];
      const rows = ts
        .filter(
          (t) =>
            /^P-?\d+$/.test(t.str.trim()) &&
            Math.abs(t.cx - mark.cx) < 25 &&
            t.cy > mark.cy &&
            t.cy < mark.cy + 120,
        )
        .flatMap((tag) => {
          const value = ts.find(
            (t) =>
              Math.abs(t.cy - tag.cy) < 3 &&
              Math.abs(t.cx - size.cx) < 30 &&
              /^\d+\s*[x×]\s*\d+$/.test(t.str.trim()),
          );
          return value
            ? [
                {
                  mark: tag.str,
                  cells: [tag.str, value.str],
                  box: [
                    tag.cx,
                    tag.cy - 3,
                    value.cx,
                    tag.cy + 3,
                  ] as SourceRef['box'],
                },
              ]
            : [];
        });
      return rows.length
        ? [
            {
              title: title.str,
              kind: 'structure' as const,
              columns: [['MARK'], ['SIZE']],
              markColumn: 0,
              rows,
              box: [mark.cx, title.cy, size.cx, mark.cy + 120] as [
                number,
                number,
                number,
                number,
              ],
            },
          ]
        : [];
    });
}

type LocalDetail = { drop: number; source: SourceRef };
/** Scope a drop note to its named detail, never to every foundation on the sheet. */
export function localPadDetails(project: Project, texts: DrawingTexts) {
  const result: { interior?: LocalDetail; exterior?: LocalDetail } = {};
  for (const sheet of project.sheets.filter(
    (s) => !s.superseded && /^S/i.test(s.name),
  )) {
    const ts = texts[sheet.id] ?? [];
    const titles = ts.filter((t) => /^SECTION\s*-/.test(t.str));
    for (const title of titles) {
      const kind = /TYPICAL INTERIOR PAD FOOTING/.test(title.str)
        ? 'interior'
        : /TYPICAL LOW PIER AT EXTERIOR/.test(title.str)
          ? 'exterior'
          : null;
      if (!kind) continue;
      const peers = titles.filter((t) => Math.abs(t.cy - title.cy) < 20);
      const left = Math.max(
        -Infinity,
        ...peers
          .filter((t) => t.cx < title.cx)
          .map((t) => (t.cx + title.cx) / 2),
      );
      const right = Math.min(
        Infinity,
        ...peers
          .filter((t) => t.cx > title.cx)
          .map((t) => (t.cx + title.cx) / 2),
      );
      const local = ts.filter(
        (t) =>
          t.cx > left &&
          t.cx < right &&
          t.cy < title.cy &&
          t.cy > title.cy - 450,
      );
      const drops = local.flatMap((t) => {
        const m = /^DROP T\/O FOOTING (\d+)$/i.exec(t.str.trim());
        return m ? [{ t, drop: Number(m[1]) / 1000 }] : [];
      });
      const ground = local.find((t) =>
        /^(?:FIN\.?|FINISHED)\s+GROUND\s+FLOOR$/i.test(t.str.trim()),
      );
      if (
        drops.length !== 1 ||
        !ground ||
        !local.some(
          (t) =>
            t.str.trim() === '0' &&
            t.cy >= ground.cy &&
            t.cy - ground.cy < 20 &&
            Math.abs(t.cx - ground.cx) < 100,
        )
      )
        continue;
      const { t, drop } = drops[0];
      if (drop <= 0 || drop > 1) continue;
      const detail = {
        drop,
        source: reference(
          sheet,
          `${title.str}; ${t.str} mm; FIN. GROUND FLOOR 0`,
          [
            Math.min(t.cx, title.cx) - 100,
            t.cy - 10,
            Math.max(t.cx, title.cx) + 100,
            title.cy + 10,
          ],
        ),
      };
      if (result[kind] && result[kind]!.drop !== drop) {
        delete result[kind];
        return {};
      }
      result[kind] = detail;
    }
  }
  return result;
}
const atOf = (e: BuildElement) =>
  e.shape?.type === 'locator' || e.shape?.type === 'point' ? e.shape.at : null;
function wallDistance(at: [number, number], e: BuildElement) {
  if (e.shape?.type !== 'run' && e.shape?.type !== 'axis') return Infinity;
  const points = e.shape.points;
  return Math.min(
    ...points.slice(1).map((b, i) => {
      const a = points[i];
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        d = dx * dx + dy * dy;
      const t = d
        ? Math.max(
            0,
            Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / d),
          )
        : 0;
      return Math.hypot(at[0] - a[0] - t * dx, at[1] - a[1] - t * dy);
    }),
  );
}
function inside(p: [number, number], ring: [number, number][]) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}

/** Replace generic foundation extrusions with source-sized footings only.
 * Pads use already registered grid locations; strip runs retain measured paths.
 * Rectangular/mass pads and piers remain unresolved without orientation/top evidence.
 * This changes model geometry, never source measurements, quantities or schedules. */
function recoverBaseFoundationGeometry(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines = {},
): BuildModel {
  const top = footingTopDatum(project, texts);
  if (!top) return model;
  const sections = new Map<
    string,
    {
      kind: string;
      width?: number;
      length?: number;
      depth?: number;
      source: SourceRef;
    }[]
  >();
  for (const sheet of project.sheets.filter(
    (s) => !s.superseded && /^S/i.test(s.name),
  )) {
    for (const schedule of [
      ...((texts[sheet.id] ?? []).every(
        (t) =>
          Number.isFinite((t as PageText).w) &&
          Number.isFinite((t as PageText).h),
      )
        ? readSchedules(detailed(texts[sheet.id] ?? []), lines[sheet.id] ?? [])
        : []),
      ...footingTables(detailed(texts[sheet.id] ?? [])),
      ...pierTables(detailed(texts[sheet.id] ?? [])),
    ]) {
      for (const mark of foundationMarks(
        [schedule],
        project.units === 'metric',
      )) {
        if (
          !['pad', 'strip', 'pier'].includes(mark.kind) ||
          !mark.width ||
          (mark.kind !== 'pier' && !mark.depth)
        )
          continue;
        const row = schedule.rows.find(
          (r) => normalized(r.mark) === normalized(mark.mark),
        );
        const section = {
          ...mark,
          source: reference(
            sheet,
            `${schedule.title}: ${mark.mark}; width ${mark.width} m; length ${mark.length ?? 'continuous'} m; depth ${mark.depth ?? 'from local section'} m`,
            row?.box ?? schedule.box,
          ),
        };
        const key = normalized(mark.mark);
        sections.set(key, [...(sections.get(key) ?? []), section]);
      }
    }
  }
  const details = localPadDetails(project, texts);
  const pierLocation = (v: BuildElement) => {
    const at = atOf(v);
    if (
      v.shape?.type !== 'point' ||
      !at ||
      !v.sources.some((s) => s.quote?.includes('actual closed pier outline'))
    )
      return at;
    const pads = model.elements.filter(
      (p) =>
        p.sheetId === v.sheetId &&
        /^F\d+\b/.test(p.typeName) &&
        atOf(p) &&
        Math.hypot(atOf(p)![0] - at[0], atOf(p)![1] - at[1]) < 0.5,
    );
    return pads.length === 1 ? atOf(pads[0]) : null;
  };
  const corrected: BuildModel = {
    ...model,
    elements: model.elements.map((e) => {
      e = {
        ...e,
        issues: e.issues.filter(
          (i) =>
            !i.startsWith('Footing section taken from') &&
            !i.startsWith('Pad elevation unresolved:'),
        ),
      };
      if (
        e.measurementSource !== 'foundations' ||
        e.status === 'demolished' ||
        !e.shape
      )
        return e;
      const code = /^([A-Z]{1,3}-?\d{1,2}[A-Z]?)\b/i.exec(e.typeName)?.[1];
      const candidates = code ? sections.get(normalized(code)) : undefined;
      if (!candidates?.length) return e;
      const section = candidates[0];
      if (
        !section.width ||
        !section.depth ||
        section.depth <= 0 ||
        candidates.some(
          (c) =>
            c.kind !== section.kind ||
            c.width !== section.width ||
            c.length !== section.length ||
            c.depth !== section.depth,
        )
      )
        return e;
      let shape = e.shape;
      let localTop = top.z;
      let localSource: SourceRef | undefined;
      if (section.kind === 'strip' && shape.type === 'run') {
        shape = {
          type: 'run',
          points: shape.points,
          z0: top.z - section.depth,
          height: section.depth,
          thickness: section.width,
        };
      } else if (
        section.kind === 'pad' &&
        (shape.type === 'locator' || shape.type === 'point') &&
        section.length &&
        Math.abs(section.length - section.width) < 0.001
      ) {
        const at = shape.at;
        const peers = model.elements.filter(
          (v) => v.sheetId === e.sheetId && v.status !== 'demolished',
        );
        const piers = peers.filter(
          (v) =>
            /^P\d+\b/.test(v.typeName) &&
            pierLocation(v) &&
            Math.hypot(
              pierLocation(v)![0] - at[0],
              pierLocation(v)![1] - at[1],
            ) < 0.02,
        );
        const walls = peers.filter(
          (v) => /^FW-?\d+\b/.test(v.typeName) && v.shape?.type === 'run',
        );
        const exterior =
          piers.length === 1 &&
          walls.some(
            (w) => /ICF/i.test(w.typeName) && wallDistance(at, w) < 0.75,
          );
        const interior =
          piers.length === 0 &&
          walls.length > 0 &&
          Math.min(...walls.map((w) => wallDistance(at, w))) > 0.75 &&
          peers.some(
            (v) =>
              /Slab on grade/i.test(v.typeName) &&
              v.shape?.type === 'surface' &&
              inside(at, v.shape.ring) &&
              !v.shape.holes.some((h) => inside(at, h)),
          );
        const detail = exterior
          ? details.exterior
          : interior
            ? details.interior
            : undefined;
        if (!detail)
          return {
            ...e,
            shape: { type: 'locator' as const, at, z: top.z },
            placement: 'inferred' as const,
            issues: [
              ...new Set([
                ...e.issues,
                'Pad elevation unresolved: no unambiguous local interior-pad or exterior-low-pier detail association. Physical solid withheld.',
              ]),
            ],
          };
        localTop = interior ? -detail.drop : top.z;
        localSource = detail.source;
        const sheet = project.sheets.find((s) => s.id === e.sheetId);
        const frame = sheet && sheetFrame(project, model, sheet);
        if (!frame)
          return { ...e, shape: { type: 'locator' as const, at, z: localTop } };
        shape = {
          type: 'point',
          at,
          z: localTop - section.depth,
          size: [section.width, section.length, section.depth],
          rotation: Math.atan2(frame.b, frame.a),
        };
      } else return e;
      const sources = [
        ...new Map(
          [
            ...e.sources,
            section.source,
            ...top.sources,
            ...(localSource ? [localSource] : []),
          ].map((s) => [JSON.stringify(s), s]),
        ).values(),
      ];
      return {
        ...e,
        shape,
        placement: 'inferred' as const,
        sources,
        issues: [
          ...new Set([
            ...e.issues,
            `Footing section taken from ${section.source.label}; top ${localTop.toFixed(3)} m from explicit structural datum, bottom ${(localTop - section.depth).toFixed(3)} m. Plan placement remains inferred from the measured run or registered grid; check local steps and eccentricity.`,
          ]),
        ],
      };
    }),
  };
  return recoverInteriorSlabs(
    project,
    recoverPiers(project, corrected, lines, sections, details.exterior, top.z),
    texts,
    top.sources,
  );
}

/** A pier's plan centre can be eccentric to its grid. Require a closed source
 * rectangle with matching schedule dimensions and visible outline strokes. */
function recoverPiers(
  project: Project,
  model: BuildModel,
  lines: DrawingLines,
  sections: Map<
    string,
    {
      kind: string;
      width?: number;
      length?: number;
      depth?: number;
      source: SourceRef;
    }[]
  >,
  detail: LocalDetail | undefined,
  footingTop: number,
): BuildModel {
  if (!detail) return model;
  return {
    ...model,
    elements: model.elements.map((e) => {
      if (
        e.measurementSource !== 'foundations' ||
        e.status === 'demolished' ||
        !/^P-?\d+\b/.test(e.typeName)
      )
        return e;
      const at = atOf(e);
      if (!at) return e;
      const code = /^([A-Z]+-?\d+)\b/.exec(e.typeName)?.[1];
      const candidates = code ? sections.get(normalized(code)) : undefined;
      const section = candidates?.[0];
      if (
        !section?.width ||
        !section.length ||
        section.kind !== 'pier' ||
        candidates!.some(
          (c) => c.width !== section.width || c.length !== section.length,
        )
      )
        return e;
      const peers = model.elements.filter(
        (v) => v.sheetId === e.sheetId && v.status !== 'demolished',
      );
      const pad = peers.find(
        (v) =>
          /^F\d+\b/.test(v.typeName) &&
          v.shape?.type === 'point' &&
          Math.hypot(v.shape.at[0] - at[0], v.shape.at[1] - at[1]) < 0.02 &&
          Math.abs(v.shape.z + v.shape.size[2] - footingTop) < 0.001,
      );
      if (
        !pad ||
        !peers.some(
          (v) =>
            /^FW-?\d+\b/.test(v.typeName) &&
            /ICF/i.test(v.typeName) &&
            wallDistance(at, v) < 0.75,
        )
      )
        return e;
      const sheet = project.sheets.find((s) => s.id === e.sheetId),
        frame = sheet && sheetFrame(project, model, sheet);
      if (!sheet || !frame) return e;
      const p = sheetPoint(at, frame),
        scale = Math.hypot(frame.a, frame.b);
      const nearby = (lines[sheet.id] ?? []).filter(
        (l) =>
          Math.hypot((l.x1 + l.x2) / 2 - p[0], (l.y1 + l.y2) / 2 - p[1]) *
            scale <
          1.2,
      );
      const groups = new Map<number, typeof nearby>();
      for (const line of nearby.filter((l) => l.filled && l.sub !== undefined))
        groups.set(line.sub!, [...(groups.get(line.sub!) ?? []), line]);
      const rectangles = [...groups.values()].flatMap((ls) => {
        if (
          ls.length !== 4 ||
          ls.some(
            (l) =>
              Math.min(Math.abs(l.x2 - l.x1), Math.abs(l.y2 - l.y1)) > 0.05,
          )
        )
          return [];
        const x0 = Math.min(...ls.flatMap((l) => [l.x1, l.x2])),
          x1 = Math.max(...ls.flatMap((l) => [l.x1, l.x2]));
        const y0 = Math.min(...ls.flatMap((l) => [l.y1, l.y2])),
          y1 = Math.max(...ls.flatMap((l) => [l.y1, l.y2]));
        const w = (x1 - x0) * scale,
          h = (y1 - y0) * scale;
        const match =
          (Math.abs(w - section.width!) < 0.015 &&
            Math.abs(h - section.length!) < 0.015) ||
          (Math.abs(h - section.width!) < 0.015 &&
            Math.abs(w - section.length!) < 0.015);
        if (
          !match ||
          p[0] < x0 - 1 ||
          p[0] > x1 + 1 ||
          p[1] < y0 - 1 ||
          p[1] > y1 + 1
        )
          return [];
        const perimeter = ls.every((l) =>
          ls.some((o) => o !== l && Math.hypot(o.x1 - l.x2, o.y1 - l.y2) < 0.1),
        );
        const strokes = nearby.filter(
          (l) =>
            !l.filled &&
            l.width > 0 &&
            ((Math.abs(l.x1 - l.x2) < 0.05 &&
              (Math.abs(l.x1 - x0) < 0.1 || Math.abs(l.x1 - x1) < 0.1) &&
              Math.min(l.y1, l.y2) >= y0 - 0.1 &&
              Math.max(l.y1, l.y2) <= y1 + 0.1) ||
              (Math.abs(l.y1 - l.y2) < 0.05 &&
                (Math.abs(l.y1 - y0) < 0.1 || Math.abs(l.y1 - y1) < 0.1) &&
                Math.min(l.x1, l.x2) >= x0 - 0.1 &&
                Math.max(l.x1, l.x2) <= x1 + 0.1)),
        );
        if (!perimeter || strokes.length < 2) return [];
        return [{ x0, x1, y0, y1, w, h }];
      });
      if (rectangles.length !== 1) return e;
      const r = rectangles[0],
        width =
          Math.abs(r.w - section.width) < 0.015
            ? section.width
            : section.length;
      const length = width === section.width ? section.length : section.width;
      const height = -detail.drop - footingTop;
      if (height <= 0) return e;
      const source = reference(
        sheet,
        `${code} actual closed pier outline; scheduled ${section.width} x ${section.length} m; centre follows drawn outline, not grid intersection`,
        [r.x0, r.y0, r.x1, r.y1],
      );
      return {
        ...e,
        shape: {
          type: 'point' as const,
          at: worldPoint([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2], frame),
          z: footingTop,
          size: [width, length, height] as [number, number, number],
          rotation: Math.atan2(frame.b, frame.a),
        },
        sources: [
          ...new Map(
            [...e.sources, section.source, detail.source, source].map((s) => [
              JSON.stringify(s),
              s,
            ]),
          ).values(),
        ],
        placement: 'inferred' as const,
        issues: [
          ...new Set([
            ...e.issues,
            `Pier section and eccentric centre recovered from source outline; exterior low-pier detail gives top ${-detail.drop} m and bottom ${footingTop} m. Local detail association remains inferred.`,
          ]),
        ],
      };
    }),
  };
}

/** Slab depth is a material note, not the foundation level's generic extrusion. */
function recoverInteriorSlabs(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  groundSources: SourceRef[],
): BuildModel {
  return {
    ...model,
    elements: model.elements.map((e) => {
      if (
        e.measurementSource !== 'foundations' ||
        e.status === 'demolished' ||
        !/^Slab on grade$/i.test(e.typeName) ||
        e.shape?.type !== 'surface'
      )
        return e;
      const sheet = project.sheets.find(
        (s) => s.id === e.sheetId && !s.superseded,
      );
      if (!sheet) return e;
      const ts = texts[sheet.id] ?? [];
      const titles = ts.filter((t) =>
        /^TYPICAL INTERIOR SLAB CONSTRUCTION:?$/i.test(t.str.trim()),
      );
      const found = titles
        .flatMap((title) =>
          ts.flatMap((t) => {
            const match = /^(\d+)[,\s].*(?:CONCRETE|CONRETE)/i.exec(
              t.str.trim(),
            );
            const distance = Math.hypot(t.cx - title.cx, t.cy - title.cy);
            return match && distance < 150
              ? [{ title, t, thickness: Number(match[1]) / 1000, distance }]
              : [];
          }),
        )
        .sort((a, b) => a.distance - b.distance);
      const note = found[0];
      if (
        !note ||
        note.thickness < 0.05 ||
        note.thickness > 0.5 ||
        found.some((v) => v.thickness !== note.thickness)
      )
        return e;
      const source = reference(
        sheet,
        `${note.title.str}; ${note.t.str}; concrete thickness ${note.thickness} m`,
        [
          Math.min(note.t.cx, note.title.cx) - 20,
          Math.min(note.t.cy, note.title.cy) - 10,
          Math.max(note.t.cx, note.title.cx) + 20,
          Math.max(note.t.cy, note.title.cy) + 10,
        ],
      );
      return {
        ...e,
        shape: { ...e.shape, z: -note.thickness, thickness: note.thickness },
        placement: 'inferred' as const,
        sources: [
          ...new Map(
            [...e.sources, source, ...groundSources].map((s) => [
              JSON.stringify(s),
              s,
            ]),
          ).values(),
        ],
        issues: [
          ...new Set([
            ...e.issues.filter(
              (i) => !i.startsWith('Interior slab concrete depth'),
            ),
            `Interior slab concrete depth ${note.thickness} m from source construction note; top at FIN. GROUND FLOOR 0, bottom ${-note.thickness} m. Measured plan outline remains inferred; source quantities are unchanged.`,
          ]),
        ],
      };
    }),
  };
}

/** Replacement foundation sheets embedded in an addendum must be loaded as drawing
 * sources. A coordinate-free change index can flag a revision, never place geometry. */
export function foundationRevisionPages(
  project: Project,
): { docId: string; page: number }[] {
  const books = (project.specs ?? []).filter(
    (s) =>
      s.book?.addendum &&
      s.book?.changes?.some((c) => /T\/O\s+FTG:\s*-?\d+/i.test(c.text)),
  );
  if (!books.length) return [];
  const newest = Math.max(...books.map((s) => s.book?.addendum!));
  return books
    .filter((s) => s.book?.addendum === newest)
    .flatMap((s) =>
      [
        ...new Set(
          (s.book?.changes ?? [])
            .filter((c) => /FOUNDATION|FOOTING|PIER|T\/O\s+FTG/i.test(c.text))
            .map((c) => c.page),
        ),
      ]
        .sort((a, b) => a - b)
        .map((page) => ({ docId: s.id, page })),
    );
}
export const foundationRevisionKey = (docId: string, page: number) =>
  `spec:${docId}:${page}`;

export function recoverFoundationGeometry(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines = {},
): BuildModel {
  const revision = foundationRevisionPages(project);
  if (!revision.length)
    return recoverBaseFoundationGeometry(project, model, texts, lines);
  const references: SourceRef[] = revision.map((r) => ({
    kind: 'spec',
    id: r.docId,
    page: r.page,
    label:
      project.specs?.find((s) => s.id === r.docId)?.name ??
      'Foundation revision',
    quote:
      'Newer foundation drawing contains explicit local footing elevations; supersedes generic original-sheet datum.',
  }));
  // Keep source quantities and symbolic locations available while matching the
  // replacement sheet. A successful old-sheet recovery is not revision evidence.
  const held: BuildModel = {
    ...model,
    elements: model.elements.map((e) => {
      if (e.measurementSource !== 'foundations' || e.status === 'demolished')
        return e;
      const s = e.shape;
      const shape: BuildElement['shape'] =
        s?.type === 'point'
          ? { type: 'locator', at: s.at, z: s.z }
          : s?.type === 'run'
            ? { type: 'axis', points: s.points, z: s.z0 }
            : s?.type === 'surface'
              ? null
              : s;
      return {
        ...e,
        shape,
        placement: 'inferred' as const,
        sources: [
          ...new Map(
            [...e.sources, ...references].map((s) => [JSON.stringify(s), s]),
          ).values(),
        ],
        issues: [
          ...new Set([
            ...e.issues.filter(
              (i) =>
                !i.startsWith('Footing section taken from') &&
                !i.startsWith('Interior slab concrete depth') &&
                !i.startsWith('Pier section and eccentric centre recovered') &&
                !i.startsWith('Foundation revision applied:'),
            ),
            'Foundation revision unresolved: newer addendum supplies local elevations and changed details. Old-sheet physical geometry withheld pending registered revised footprint and local datum association.',
          ]),
        ],
      };
    }),
  };
  return recoverRevisedContinuousStrips(
    project,
    model,
    recoverRevisedMassFootings(
      project,
      model,
      recoverRevisedPiers(
        project,
        model,
        recoverRevisedPads(project, model, held, texts, lines, revision),
        texts,
        lines,
        revision,
      ),
      texts,
      lines,
      revision,
    ),
    texts,
    lines,
    revision,
  );
}

interface RevisedPlan {
  docId: string;
  page: number;
  key: string;
  frame: SheetFrame;
  sheetId: string;
  texts: DrawingText[];
  lines: DrawingLines[string];
}
export function revisedPlan(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
  pages: { docId: string; page: number }[],
): RevisedPlan | null {
  const candidates: RevisedPlan[] = [];
  for (const r of pages) {
    const key = foundationRevisionKey(r.docId, r.page),
      ts = texts[key] ?? [];
    const title = ts.find((t) => /^FOUNDATION PLAN$/i.test(t.str.trim()));
    if (!title || !ts.some((t) => /^T\/O FTG:\s*-?\d+/i.test(t.str.trim())))
      continue;
    const scales = ts.flatMap((t) => {
      const m = /^(?:SCALE:\s*)?1\s*:\s*(\d+)$/i.exec(t.str.trim());
      return m && Math.hypot(t.cx - title.cx, t.cy - title.cy) < 100
        ? [(Number(m[1]) * 0.0254) / 72]
        : [];
    });
    if (scales.length !== 1) continue;
    const scale = scales[0];
    const axes = gridAxes(
      ts,
      Math.max(...ts.map((t) => t.cx)) + 50,
      Math.max(...ts.map((t) => t.cy)) + 50,
    );
    for (const sheet of project.sheets.filter(
      (s) =>
        !s.superseded &&
        model.elements.some(
          (e) => e.sheetId === s.id && e.measurementSource === 'foundations',
        ),
    )) {
      const f = sheetFrame(
        project,
        {
          ...model,
          elements: model.elements.filter(
            (e) =>
              !(
                e.shape?.type === 'run' &&
                e.issues.some((i) =>
                  i.startsWith('Foundation revision applied:'),
                )
              ),
          ),
        },
        sheet,
      );
      if (!f || !sheet.metersPerPoint) continue;
      const old = gridAxes(texts[sheet.id] ?? [], sheet.width, sheet.height);
      const match = matchGridAxes(axes, scale, old, sheet.metersPerPoint);
      if (!match || match.grids.length < 6) continue;
      const c = Math.cos(match.rotation ?? 0),
        sn = Math.sin(match.rotation ?? 0),
        k = scale / sheet.metersPerPoint;
      const frame = {
        a: k * (f.a * c - f.b * sn),
        b: k * (f.b * c + f.a * sn),
        tx: f.tx - (f.a * match.x - f.b * match.y) / sheet.metersPerPoint,
        ty: f.ty - (f.b * match.x + f.a * match.y) / sheet.metersPerPoint,
        residual: f.residual,
      };
      candidates.push({
        ...r,
        key,
        frame,
        sheetId: sheet.id,
        texts: ts,
        lines: lines[key] ?? [],
      });
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}
function recoverRevisedPads(
  project: Project,
  original: BuildModel,
  held: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
  pages: { docId: string; page: number }[],
): BuildModel {
  const plan = revisedPlan(project, original, texts, lines, pages);
  if (!plan) return held;
  const sections = new Map<
    string,
    { width: number; length: number; depth: number; source: SourceRef }[]
  >();
  for (const r of pages) {
    for (const table of footingTables(
      detailed(texts[foundationRevisionKey(r.docId, r.page)] ?? []),
    )) {
      for (const mark of foundationMarks([table], true)) {
        if (mark.kind !== 'pad' || !mark.width || !mark.length || !mark.depth)
          continue;
        const key = normalized(mark.mark),
          row = table.rows.find((r) => normalized(r.mark) === key);
        const source: SourceRef = {
          kind: 'spec',
          id: r.docId,
          page: r.page,
          label: `Revised ${table.title}`,
          quote: `${mark.mark}: ${mark.width} x ${mark.length} x ${mark.depth} m`,
          box: row?.box ?? table.box,
        };
        sections.set(key, [
          ...(sections.get(key) ?? []),
          { width: mark.width, length: mark.length, depth: mark.depth, source },
        ]);
      }
    }
  }
  const datums = plan.texts.flatMap((t) => {
    const m = /^T\/O FTG:\s*(-?\d+)$/i.exec(t.str.trim());
    if (!m) return [];
    const under = plan.texts.filter(
      (v) =>
        /^U\/S FTG:\s*-?\d+$/i.test(v.str.trim()) &&
        Math.abs(v.cx - t.cx) < 40 &&
        v.cy > t.cy &&
        v.cy - t.cy < 20,
    );
    if (under.length !== 1) return [];
    const z = Number(m[1]) / 1000,
      bottom = Number(under[0].str.match(/-?\d+$/)![0]) / 1000;
    if (z >= 0 || bottom >= z) return [];
    return [{ t, under: under[0], z, bottom }];
  });
  const filledGroups = new Map<number, DrawingLines[string]>();
  for (const l of plan.lines)
    if (l.filled && l.sub !== undefined)
      filledGroups.set(l.sub, [...(filledGroups.get(l.sub) ?? []), l]);
  const arrowTips = [...filledGroups.values()].flatMap((ls) => {
    if (ls.length !== 3) return [];
    const vertices = [
      ...new Map(
        ls
          .flatMap((l) => [
            [l.x1, l.y1],
            [l.x2, l.y2],
          ])
          .map((p) => [p.join(','), p]),
      ).values(),
    ];
    if (vertices.length !== 3) return [];
    const lengths = vertices
      .map((p, i) =>
        Math.hypot(
          p[0] - vertices[(i + 1) % 3][0],
          p[1] - vertices[(i + 1) % 3][1],
        ),
      )
      .sort((a, b) => a - b);
    if (lengths[0] < 1 || lengths[2] > 15 || lengths[2] / lengths[0] < 2)
      return [];
    const cx = vertices.reduce((n, p) => n + p[0], 0) / 3,
      cy = vertices.reduce((n, p) => n + p[1], 0) / 3;
    const tip = vertices.sort(
      (a, b) =>
        Math.hypot(b[0] - cx, b[1] - cy) - Math.hypot(a[0] - cx, a[1] - cy),
    )[0];
    return [tip];
  });
  const scale = Math.hypot(plan.frame.a, plan.frame.b);
  return {
    ...held,
    elements: held.elements.map((e) => {
      if (
        e.sheetId !== plan.sheetId ||
        e.measurementSource !== 'foundations' ||
        !/^F-?\d+\b/.test(e.typeName)
      )
        return e;
      const old = original.elements.find((v) => v.id === e.id),
        at = old && atOf(old);
      if (!at) return e;
      const code = normalized(/^([A-Z]+-?\d+)/.exec(e.typeName)![1]),
        ss = sections.get(code),
        section = ss?.[0];
      if (
        !section ||
        ss!.some(
          (v) =>
            v.width !== section.width ||
            v.length !== section.length ||
            v.depth !== section.depth,
        ) ||
        Math.abs(section.width - section.length) > 0.001
      )
        return e;
      const p = sheetPoint(at, plan.frame),
        half = section.width / scale / 2;
      let box: [number, number, number, number] = [
        p[0] - half,
        p[1] - half,
        p[0] + half,
        p[1] + half,
      ];
      const sideCoverage = (
        axis: 'x' | 'y',
        edge: number,
        start: number,
        end: number,
      ) => {
        const intervals = plan.lines
          .filter(
            (l) =>
              !l.filled &&
              Math.abs((axis === 'x' ? l.x1 : l.y1) - edge) < 1 &&
              Math.abs((axis === 'x' ? l.x2 : l.y2) - edge) < 1,
          )
          .map((l) => [
            Math.max(
              start,
              Math.min(axis === 'x' ? l.y1 : l.x1, axis === 'x' ? l.y2 : l.x2),
            ),
            Math.min(
              end,
              Math.max(axis === 'x' ? l.y1 : l.x1, axis === 'x' ? l.y2 : l.x2),
            ),
          ])
          .filter((v) => v[1] > v[0])
          .sort((a, b) => a[0] - b[0]);
        let total = 0,
          endAt = -Infinity;
        for (const [a, b] of intervals) {
          total += Math.max(0, b - Math.max(a, endAt));
          endAt = Math.max(endAt, b);
        }
        return total / (end - start);
      };
      const near = plan.lines.filter(
        (l) =>
          !l.filled &&
          l.width >= 0.5 &&
          Math.hypot((l.x1 + l.x2) / 2 - p[0], (l.y1 + l.y2) / 2 - p[1]) <
            half * 2 + 20,
      );
      const xs = [
        ...new Set(
          near
            .filter((l) => Math.abs(l.x1 - l.x2) < 0.05)
            .map((l) => Math.round(l.x1 * 100) / 100),
        ),
      ];
      const ys = [
        ...new Set(
          near
            .filter((l) => Math.abs(l.y1 - l.y2) < 0.05)
            .map((l) => Math.round(l.y1 * 100) / 100),
        ),
      ];
      const xPairs = xs.flatMap((a) =>
        xs
          .filter(
            (b) =>
              b > a &&
              Math.abs((b - a) * scale - section.width) < 0.015 &&
              Math.abs((a + b) / 2 - p[0]) * scale < 0.5,
          )
          .map((b) => [a, b]),
      );
      const yPairs = ys.flatMap((a) =>
        ys
          .filter(
            (b) =>
              b > a &&
              Math.abs((b - a) * scale - section.length) < 0.015 &&
              Math.abs((a + b) / 2 - p[1]) * scale < 0.5,
          )
          .map((b) => [a, b]),
      );
      const boxes = xPairs
        .flatMap((xx) =>
          yPairs.flatMap((yy) => {
            const coverage = [
              sideCoverage('x', xx[0], yy[0], yy[1]),
              sideCoverage('x', xx[1], yy[0], yy[1]),
              sideCoverage('y', yy[0], xx[0], xx[1]),
              sideCoverage('y', yy[1], xx[0], xx[1]),
            ];
            return coverage.every((v) => v > 0.35) &&
              coverage.filter((v) => v > 0.6).length >= 2
              ? [
                  {
                    box: [xx[0], yy[0], xx[1], yy[1]] as [
                      number,
                      number,
                      number,
                      number,
                    ],
                    score: coverage.reduce((a, b) => a + b, 0),
                  },
                ]
              : [];
          }),
        )
        .sort((a, b) => b.score - a.score);
      if (
        !boxes.length ||
        (boxes[1] &&
          boxes[0].score - boxes[1].score < 0.05 &&
          Math.hypot(
            boxes[0].box[0] - boxes[1].box[0],
            boxes[0].box[1] - boxes[1].box[1],
          ) > 1)
      )
        return e;
      box = boxes[0].box;
      const onPad = (x: number, y: number) =>
        x >= box[0] - 4 &&
        x <= box[2] + 4 &&
        y >= box[1] - 4 &&
        y <= box[3] + 4 &&
        Math.min(
          Math.abs(x - box[0]),
          Math.abs(x - box[2]),
          Math.abs(y - box[1]),
          Math.abs(y - box[3]),
        ) < 5;
      const connected = (x: number, y: number) =>
        arrowTips.some(
          (tip) =>
            onPad(tip[0], tip[1]) &&
            plan.lines.some(
              (l) =>
                !l.filled &&
                Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 10 &&
                ((Math.hypot(l.x1 - tip[0], l.y1 - tip[1]) < 0.3 &&
                  Math.hypot(l.x2 - x, l.y2 - y) < 70) ||
                  (Math.hypot(l.x2 - tip[0], l.y2 - tip[1]) < 0.3 &&
                    Math.hypot(l.x1 - x, l.y1 - y) < 70)),
            ),
        );
      const leaders = datums.filter((d) =>
        connected(d.t.cx, (d.t.cy + d.under.cy) / 2),
      );
      const sump = plan.texts.filter((t) =>
        /^DROP T\/O FOOTING TO SUIT$/i.test(t.str.trim()),
      );
      if (sump.some((t) => connected(t.cx, t.cy + 10)))
        return {
          ...e,
          issues: [
            ...e.issues,
            'Revised footing has a sump-pit coordination/drop leader. Fixed elevation withheld until architectural and mechanical sump requirements are resolved.',
          ],
        };
      if (
        leaders.length !== 1 ||
        Math.abs(leaders[0].z - leaders[0].bottom - section.depth) > 0.002
      )
        return e;
      const d = leaders[0];
      const source: SourceRef = {
        kind: 'spec',
        id: plan.docId,
        page: plan.page,
        label: 'Revised foundation plan',
        quote: `${d.t.str}; ${d.under.str}; direct leader associated with drawn ${code} footing perimeter`,
        box: [
          Math.min(box[0], d.t.cx - 40),
          Math.min(box[1], d.t.cy - 10),
          Math.max(box[2], d.t.cx + 40),
          Math.max(box[3], d.under.cy + 10),
        ],
      };
      return {
        ...e,
        shape: {
          type: 'point' as const,
          at: worldPoint(
            [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2],
            plan.frame,
          ),
          z: d.bottom,
          size: [section.width, section.length, section.depth] as [
            number,
            number,
            number,
          ],
          rotation: Math.atan2(plan.frame.b, plan.frame.a),
        },
        sources: [
          ...new Map(
            [...e.sources, section.source, source].map((s) => [
              JSON.stringify(s),
              s,
            ]),
          ).values(),
        ],
        issues: [
          ...e.issues.filter(
            (i) => !i.startsWith('Foundation revision unresolved:'),
          ),
          `Foundation revision applied: revised grid registration, drawn footing perimeter and local elevation leader agree. Top ${d.z} m; bottom ${d.bottom} m. Source takeoff quantity unchanged.`,
        ],
      };
    }),
  };
}

function recoverRevisedPiers(
  project: Project,
  original: BuildModel,
  current: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
  pages: { docId: string; page: number }[],
): BuildModel {
  const plan = revisedPlan(project, original, texts, lines, pages);
  if (!plan) return current;
  const virtualSheets = pages.map((r) => ({
    ...project.sheets[0],
    id: foundationRevisionKey(r.docId, r.page),
    docId: r.docId,
    page: r.page,
    name: 'S foundation revision',
    superseded: false,
  }));
  const virtual = { ...project, sheets: virtualSheets };
  const detail = localPadDetails(virtual, texts).exterior,
    datum = footingTopDatum(virtual, texts);
  if (!detail || !datum) return current;
  const toSpec = (s: SourceRef): SourceRef => {
    const r = pages.find(
      (r) => foundationRevisionKey(r.docId, r.page) === s.id,
    );
    return r
      ? {
          ...s,
          kind: 'spec',
          id: r.docId,
          label: `Revised foundation detail (${project.specs?.find((s) => s.id === r.docId)?.name ?? 'addendum'})`,
        }
      : s;
  };
  const sections = new Map<
    string,
    { width: number; length: number; source: SourceRef }[]
  >();
  for (const r of pages)
    for (const table of pierTables(
      detailed(texts[foundationRevisionKey(r.docId, r.page)] ?? []),
    ))
      for (const mark of foundationMarks([table], true)) {
        if (mark.kind !== 'pier' || !mark.width || !mark.length) continue;
        const key = normalized(mark.mark),
          row = table.rows.find((v) => normalized(v.mark) === key);
        const source: SourceRef = {
          kind: 'spec',
          id: r.docId,
          page: r.page,
          label: 'Revised pier schedule',
          quote: `${mark.mark}: ${mark.width} x ${mark.length} m`,
          box: row?.box ?? table.box,
        };
        sections.set(key, [
          ...(sections.get(key) ?? []),
          { width: mark.width, length: mark.length, source },
        ]);
      }
  const scale = Math.hypot(plan.frame.a, plan.frame.b);
  return {
    ...current,
    elements: current.elements.map((e) => {
      if (
        e.sheetId !== plan.sheetId ||
        e.measurementSource !== 'foundations' ||
        !/^P-?\d+\b/.test(e.typeName)
      )
        return e;
      const old = original.elements.find((v) => v.id === e.id),
        at = old && atOf(old);
      if (!at) return e;
      const peers = original.elements.filter(
        (v) => v.sheetId === e.sheetId && v.status !== 'demolished',
      );
      const associatedPads = peers.filter(
        (v) =>
          /^F-?\d+\b/.test(v.typeName) &&
          atOf(v) &&
          Math.hypot(atOf(v)![0] - at[0], atOf(v)![1] - at[1]) < 0.5,
      );
      if (associatedPads.length !== 1) return e; // Mass/buttress footings have different local datums.
      const revisedPad = current.elements.find(
        (v) => v.id === associatedPads[0].id,
      );
      if (
        revisedPad?.shape?.type === 'point' &&
        Math.abs(revisedPad.shape.z + revisedPad.shape.size[2] - datum.z) >
          0.002
      )
        return e;
      // Interior P1s are not covered by a detail expressly titled EXTERIOR.
      if (
        !peers.some(
          (v) =>
            /^FW-?\d+\b/.test(v.typeName) &&
            /ICF/i.test(v.typeName) &&
            wallDistance(at, v) < 0.75,
        )
      )
        return e;
      const key = normalized(/^([A-Z]+-?\d+)/.exec(e.typeName)![1]),
        ss = sections.get(key),
        section = ss?.[0];
      if (
        !section ||
        ss!.some(
          (v) => v.width !== section.width || v.length !== section.length,
        )
      )
        return e;
      const p = sheetPoint(at, plan.frame),
        nearby = plan.lines.filter(
          (l) =>
            Math.hypot((l.x1 + l.x2) / 2 - p[0], (l.y1 + l.y2) / 2 - p[1]) *
              scale <
            1.2,
        );
      const groups = new Map<number, typeof nearby>();
      for (const l of nearby)
        if (l.filled && l.sub !== undefined)
          groups.set(l.sub, [...(groups.get(l.sub) ?? []), l]);
      const rectangles = [...groups.values()].flatMap((ls) => {
        if (
          ls.length !== 4 ||
          ls.some(
            (l) =>
              Math.min(Math.abs(l.x2 - l.x1), Math.abs(l.y2 - l.y1)) > 0.05,
          )
        )
          return [];
        const x0 = Math.min(...ls.flatMap((l) => [l.x1, l.x2])),
          x1 = Math.max(...ls.flatMap((l) => [l.x1, l.x2])),
          y0 = Math.min(...ls.flatMap((l) => [l.y1, l.y2])),
          y1 = Math.max(...ls.flatMap((l) => [l.y1, l.y2]));
        const w = (x1 - x0) * scale,
          h = (y1 - y0) * scale;
        if (
          !(
            (Math.abs(w - section.width) < 0.015 &&
              Math.abs(h - section.length) < 0.015) ||
            (Math.abs(h - section.width) < 0.015 &&
              Math.abs(w - section.length) < 0.015)
          ) ||
          p[0] < x0 - 1 ||
          p[0] > x1 + 1 ||
          p[1] < y0 - 1 ||
          p[1] > y1 + 1
        )
          return [];
        if (
          !ls.every((l) =>
            ls.some(
              (o) => o !== l && Math.hypot(o.x1 - l.x2, o.y1 - l.y2) < 0.1,
            ),
          )
        )
          return [];
        const strokes = nearby.filter(
          (l) =>
            !l.filled &&
            l.width > 0.5 &&
            ((Math.abs(l.x1 - l.x2) < 0.05 &&
              (Math.abs(l.x1 - x0) < 0.1 || Math.abs(l.x1 - x1) < 0.1) &&
              Math.min(l.y1, l.y2) >= y0 - 0.1 &&
              Math.max(l.y1, l.y2) <= y1 + 0.1) ||
              (Math.abs(l.y1 - l.y2) < 0.05 &&
                (Math.abs(l.y1 - y0) < 0.1 || Math.abs(l.y1 - y1) < 0.1) &&
                Math.min(l.x1, l.x2) >= x0 - 0.1 &&
                Math.max(l.x1, l.x2) <= x1 + 0.1)),
        );
        return strokes.length >= 2 ? [{ x0, x1, y0, y1, w, h }] : [];
      });
      if (rectangles.length !== 1) return e;
      const r = rectangles[0],
        width =
          Math.abs(r.w - section.width) < 0.015
            ? section.width
            : section.length,
        length = width === section.width ? section.length : section.width,
        height = -detail.drop - datum.z;
      if (height <= 0) return e;
      const source: SourceRef = {
        kind: 'spec',
        id: plan.docId,
        page: plan.page,
        label: 'Revised foundation plan',
        quote: `${key} actual closed pier outline; scheduled ${section.width} x ${section.length} m; exterior low-pier detail associated by ICF perimeter location (inferred).`,
        box: [r.x0, r.y0, r.x1, r.y1],
      };
      return {
        ...e,
        shape: {
          type: 'point' as const,
          at: worldPoint([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2], plan.frame),
          z: datum.z,
          size: [width, length, height] as [number, number, number],
          rotation: Math.atan2(plan.frame.b, plan.frame.a),
        },
        sources: [
          ...new Map(
            [
              ...e.sources,
              section.source,
              toSpec(detail.source),
              ...datum.sources.map(toSpec),
              source,
            ].map((s) => [JSON.stringify(s), s]),
          ).values(),
        ],
        issues: [
          ...e.issues.filter(
            (i) => !i.startsWith('Foundation revision unresolved:'),
          ),
          `Foundation revision applied: revised pier outline and schedule agree; named exterior low-pier detail gives top ${-detail.drop} m, bottom ${datum.z} m. ICF perimeter detail applicability remains inferred; source quantity unchanged.`,
        ],
      };
    }),
  };
}

function recoverRevisedMassFootings(
  project: Project,
  original: BuildModel,
  current: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
  pages: { docId: string; page: number }[],
): BuildModel {
  const plan = revisedPlan(project, original, texts, lines, pages);
  if (!plan) return current;
  const originalSheet = project.sheets.find((s) => s.id === plan.sheetId),
    oldFrame =
      originalSheet &&
      sheetFrame(
        project,
        {
          ...original,
          elements: original.elements.filter(
            (e) =>
              !(
                e.shape?.type === 'run' &&
                e.issues.some((i) =>
                  i.startsWith('Foundation revision applied:'),
                )
              ),
          ),
        },
        originalSheet,
      );
  if (!oldFrame) return current;
  const sections = new Map<
    string,
    { width: number; length: number; depth: number; source: SourceRef }[]
  >();
  for (const r of pages) {
    const ts = texts[foundationRevisionKey(r.docId, r.page)] ?? [];
    for (const title of ts.filter((t) =>
      /^MASS FOOTING SCHEDULE$/i.test(t.str.trim()),
    )) {
      const hs = ts.filter(
        (t) =>
          t.cy > title.cy &&
          t.cy < title.cy + 50 &&
          Math.abs(t.cx - title.cx) < 400,
      );
      const mark = hs
        .filter((t) => /^MARK$/i.test(t.str.trim()) && t.cx < title.cx)
        .sort((a, b) => a.cx - b.cx)[0];
      const size = hs.find(
        (t) =>
          /^SIZE$/i.test(t.str.trim()) &&
          mark &&
          t.cx > mark.cx &&
          t.cx - mark.cx < 150,
      );
      const depth = hs.find((t) => /^THICKNESS$/i.test(t.str.trim()));
      if (!mark || !size || !depth) continue;
      for (const tag of ts.filter(
        (t) =>
          /^MF-?\d+$/i.test(t.str.trim()) &&
          Math.abs(t.cx - mark.cx) < 25 &&
          t.cy > mark.cy &&
          t.cy < mark.cy + 250,
      )) {
        const sz = ts.find(
          (t) =>
            Math.abs(t.cy - tag.cy) < 3 &&
            Math.abs(t.cx - size.cx) < 35 &&
            /^\d+\s*[x×]\s*\d+$/.test(t.str.trim()),
        );
        const dp = ts.find(
          (t) =>
            Math.abs(t.cy - tag.cy) < 3 &&
            Math.abs(t.cx - depth.cx) < 25 &&
            /^\d+$/.test(t.str.trim()),
        );
        if (!sz || !dp) continue;
        const dims = sz.str.match(/\d+/g)!.map((n) => Number(n) / 1000),
          d = Number(dp.str) / 1000;
        if (dims.some((v) => v <= 0) || d <= 0) continue;
        const key = normalized(tag.str),
          source: SourceRef = {
            kind: 'spec',
            id: r.docId,
            page: r.page,
            label: 'Revised mass footing schedule',
            quote: `${tag.str}: ${sz.str}; thickness ${dp.str} mm`,
            box: [tag.cx - 10, tag.cy - 5, depth.cx + 25, tag.cy + 5],
          };
        sections.set(key, [
          ...(sections.get(key) ?? []),
          { width: dims[0], length: dims[1], depth: d, source },
        ]);
      }
    }
  }
  const groups = new Map<number, DrawingLines[string]>();
  for (const l of plan.lines)
    if (l.filled && l.sub !== undefined)
      groups.set(l.sub, [...(groups.get(l.sub) ?? []), l]);
  const triangles = [...groups.values()]
    .filter((ls) => ls.length === 3)
    .flatMap((ls) => {
      const vs = [
        ...new Map(
          ls
            .flatMap((l) => [
              [l.x1, l.y1],
              [l.x2, l.y2],
            ])
            .map((p) => [p.join(','), p]),
        ).values(),
      ];
      if (vs.length !== 3) return [];
      const ds = vs
        .map((p, i) =>
          Math.hypot(p[0] - vs[(i + 1) % 3][0], p[1] - vs[(i + 1) % 3][1]),
        )
        .sort((a, b) => a - b);
      if (ds[0] < 1 || ds[2] > 15 || ds[2] / ds[0] < 2) return [];
      const cx = vs.reduce((n, p) => n + p[0], 0) / 3,
        cy = vs.reduce((n, p) => n + p[1], 0) / 3;
      return [
        vs.sort(
          (a, b) =>
            Math.hypot(b[0] - cx, b[1] - cy) - Math.hypot(a[0] - cx, a[1] - cy),
        )[0],
      ];
    });
  const datums = plan.texts.flatMap((t) => {
    const m = /^T\/O FTG:\s*(-?\d+)$/i.exec(t.str.trim());
    if (!m) return [];
    const us = plan.texts.filter(
      (v) =>
        /^U\/S FTG:\s*-?\d+$/i.test(v.str.trim()) &&
        Math.abs(v.cx - t.cx) < 40 &&
        v.cy > t.cy &&
        v.cy - t.cy < 20,
    );
    if (us.length !== 1) return [];
    const top = Number(m[1]) / 1000,
      bottom = Number(us[0].str.match(/-?\d+$/)![0]) / 1000;
    return top < 0 && bottom < top ? [{ t, us: us[0], top, bottom }] : [];
  });
  const scale = Math.hypot(plan.frame.a, plan.frame.b);
  return {
    ...current,
    elements: current.elements.map((e) => {
      if (
        e.measurementSource !== 'foundations' ||
        e.sheetId !== plan.sheetId ||
        !/^MF-?\d+\b/.test(e.typeName)
      )
        return e;
      const code = normalized(/^([A-Z]+-?\d+)/.exec(e.typeName)![1]),
        ss = sections.get(code),
        section = ss?.[0];
      if (
        !section ||
        ss!.some(
          (s) =>
            s.width !== section.width ||
            s.length !== section.length ||
            s.depth !== section.depth,
        )
      )
        return e;
      const measurement = project.measurements.find(
        (m) => m.id === e.measurementId,
      );
      if (measurement?.points.length !== 1) return e;
      const hint = sheetPoint(
        worldPoint(measurement.points[0], oldFrame),
        plan.frame,
      );
      const tags = plan.texts.filter(
        (t) =>
          normalized(t.str) === code &&
          Math.hypot(t.cx - hint[0], t.cy - hint[1]) < 3,
      );
      if (tags.length !== 1) return e;
      const tag = tags[0];
      const rectangles = [...groups.values()].flatMap((ls) => {
        if (
          ls.length !== 4 ||
          ls.some(
            (l) =>
              Math.min(Math.abs(l.x2 - l.x1), Math.abs(l.y2 - l.y1)) > 0.05,
          ) ||
          !ls.every((l) =>
            ls.some(
              (o) => o !== l && Math.hypot(o.x1 - l.x2, o.y1 - l.y2) < 0.1,
            ),
          )
        )
          return [];
        const x0 = Math.min(...ls.flatMap((l) => [l.x1, l.x2])),
          x1 = Math.max(...ls.flatMap((l) => [l.x1, l.x2])),
          y0 = Math.min(...ls.flatMap((l) => [l.y1, l.y2])),
          y1 = Math.max(...ls.flatMap((l) => [l.y1, l.y2])),
          w = (x1 - x0) * scale,
          h = (y1 - y0) * scale;
        if (
          !(
            (Math.abs(w - section.width) < 0.015 &&
              Math.abs(h - section.length) < 0.015) ||
            (Math.abs(h - section.width) < 0.015 &&
              Math.abs(w - section.length) < 0.015)
          ) ||
          tag.cx < x0 - 30 ||
          tag.cx > x1 + 30 ||
          tag.cy < y0 - 30 ||
          tag.cy > y1 + 30
        )
          return [];
        return [{ x0, x1, y0, y1, w, h }];
      });
      if (rectangles.length !== 1) return e;
      const r = rectangles[0],
        onBoundary = (p: number[]) =>
          p[0] >= r.x0 - 4 &&
          p[0] <= r.x1 + 4 &&
          p[1] >= r.y0 - 4 &&
          p[1] <= r.y1 + 4 &&
          Math.min(
            Math.abs(p[0] - r.x0),
            Math.abs(p[0] - r.x1),
            Math.abs(p[1] - r.y0),
            Math.abs(p[1] - r.y1),
          ) < 5;
      const local = datums.filter(
        (d) =>
          Math.abs(d.top - d.bottom - section.depth) < 0.002 &&
          triangles.some(
            (tip) =>
              onBoundary(tip) &&
              plan.lines.some(
                (l) =>
                  !l.filled &&
                  Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 10 &&
                  ((Math.hypot(l.x1 - tip[0], l.y1 - tip[1]) < 0.3 &&
                    Math.hypot(l.x2 - d.t.cx, l.y2 - (d.t.cy + d.us.cy) / 2) <
                      70) ||
                    (Math.hypot(l.x2 - tip[0], l.y2 - tip[1]) < 0.3 &&
                      Math.hypot(l.x1 - d.t.cx, l.y1 - (d.t.cy + d.us.cy) / 2) <
                        70)),
              ),
          ),
      );
      if (local.length !== 1) return e;
      const d = local[0],
        width =
          Math.abs(r.w - section.width) < 0.015
            ? section.width
            : section.length,
        length = width === section.width ? section.length : section.width;
      const source: SourceRef = {
        kind: 'spec',
        id: plan.docId,
        page: plan.page,
        label: 'Revised foundation plan',
        quote: `${code} tag, closed mass-footing footprint and direct elevation leader: ${d.t.str}; ${d.us.str}.`,
        box: [
          Math.min(r.x0, d.t.cx - 40),
          Math.min(r.y0, d.t.cy - 10),
          Math.max(r.x1, d.t.cx + 40),
          Math.max(r.y1, d.us.cy + 10),
        ],
      };
      return {
        ...e,
        shape: {
          type: 'point' as const,
          at: worldPoint([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2], plan.frame),
          z: d.bottom,
          size: [width, length, section.depth] as [number, number, number],
          rotation: Math.atan2(plan.frame.b, plan.frame.a),
        },
        sources: [
          ...new Map(
            [...e.sources, section.source, source].map((s) => [
              JSON.stringify(s),
              s,
            ]),
          ).values(),
        ],
        issues: [
          ...e.issues.filter(
            (i) => !i.startsWith('Foundation revision unresolved:'),
          ),
          `Foundation revision applied: mass-footing tag and drawn footprint match the revised schedule and direct local top/underside leader. Top ${d.top} m; bottom ${d.bottom} m. Source quantity unchanged.`,
        ],
      };
    }),
  };
}

/** Propagate a datum only through a drawn constant-width band connected to a
 * locally dimensioned pad. A step marker or conflicting connection blocks it. */
function recoverRevisedContinuousStrips(
  project: Project,
  original: BuildModel,
  current: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
  pages: { docId: string; page: number }[],
): BuildModel {
  const plan = revisedPlan(project, original, texts, lines, pages);
  if (!plan) return current;
  const scale = Math.hypot(plan.frame.a, plan.frame.b);
  const sections = new Map<
    string,
    { width: number; depth: number; source: SourceRef }[]
  >();
  for (const r of pages)
    for (const table of footingTables(
      detailed(texts[foundationRevisionKey(r.docId, r.page)] ?? []),
    ))
      for (const mark of foundationMarks([table], true)) {
        if (mark.kind !== 'strip' || !mark.width || !mark.depth) continue;
        const key = normalized(mark.mark),
          row = table.rows.find((v) => normalized(v.mark) === key);
        const source: SourceRef = {
          kind: 'spec',
          id: r.docId,
          page: r.page,
          label: 'Revised strip footing schedule',
          quote: `${mark.mark}: width ${mark.width} m; depth ${mark.depth} m`,
          box: row?.box ?? table.box,
        };
        sections.set(key, [
          ...(sections.get(key) ?? []),
          { width: mark.width, depth: mark.depth, source },
        ]);
      }
  const pads = current.elements.filter(
    (e) =>
      e.sheetId === plan.sheetId &&
      /^F-?\d+\b/.test(e.typeName) &&
      e.shape?.type === 'point' &&
      e.issues.some((i) => i.startsWith('Foundation revision applied:')),
  );
  return {
    ...current,
    elements: current.elements.map((e) => {
      if (
        e.sheetId !== plan.sheetId ||
        e.measurementSource !== 'foundations' ||
        !/^SF-?\d+\b/.test(e.typeName)
      )
        return e;
      const old = original.elements.find((v) => v.id === e.id),
        shape = old?.shape;
      if (
        (shape?.type !== 'run' && shape?.type !== 'axis') ||
        shape.points.length !== 2
      )
        return e;
      const code = normalized(/^([A-Z]+-?\d+)/.exec(e.typeName)![1]),
        ss = sections.get(code),
        section = ss?.[0];
      if (
        !section ||
        ss!.some((v) => v.width !== section.width || v.depth !== section.depth)
      )
        return e;
      const ps = shape.points.map((p) => sheetPoint(p, plan.frame));
      const horizontal = Math.abs(ps[0][1] - ps[1][1]) < 0.1,
        vertical = Math.abs(ps[0][0] - ps[1][0]) < 0.1;
      if (!horizontal && !vertical) return e;
      const axis = horizontal ? 0 : 1,
        cross = 1 - axis,
        start = Math.min(ps[0][axis], ps[1][axis]),
        end = Math.max(ps[0][axis], ps[1][axis]),
        hint = (ps[0][cross] + ps[1][cross]) / 2;
      const useful = plan.lines.filter(
        (l) =>
          !l.filled &&
          l.width >= 0.5 &&
          Math.abs(horizontal ? l.y2 - l.y1 : l.x2 - l.x1) < 0.05 &&
          Math.abs((horizontal ? l.y1 : l.x1) - hint) * scale <
            section.width + 0.3 &&
          Math.max(horizontal ? l.x1 : l.y1, horizontal ? l.x2 : l.y2) >
            start &&
          Math.min(horizontal ? l.x1 : l.y1, horizontal ? l.x2 : l.y2) < end,
      );
      const coords = [
        ...new Set(
          useful.map((l) => Math.round((horizontal ? l.y1 : l.x1) * 100) / 100),
        ),
      ];
      const intervals = (at: number) =>
        useful
          .filter((l) => Math.abs((horizontal ? l.y1 : l.x1) - at) < 0.1)
          .map((l) => [
            Math.max(
              start,
              Math.min(horizontal ? l.x1 : l.y1, horizontal ? l.x2 : l.y2),
            ),
            Math.min(
              end,
              Math.max(horizontal ? l.x1 : l.y1, horizontal ? l.x2 : l.y2),
            ),
          ])
          .filter((v) => v[1] > v[0])
          .sort((a, b) => a[0] - b[0]);
      const coverage = (is: number[][], lo: number, hi: number) => {
        let n = 0,
          last = lo,
          gap = 0;
        for (const [a, b] of is) {
          if (a >= hi) break;
          if (a > last) gap = Math.max(gap, a - last);
          n += Math.max(0, Math.min(hi, b) - Math.max(a, last, lo));
          last = Math.max(last, b);
        }
        gap = Math.max(gap, hi - last);
        return { ratio: n / (hi - lo), gap };
      };
      const bands = coords
        .flatMap((a) =>
          coords
            .filter(
              (b) => b > a && Math.abs((b - a) * scale - section.width) < 0.015,
            )
            .flatMap((b) => {
              const aa = intervals(a),
                bb = intervals(b);
              if (!aa.length || !bb.length) return [];
              const lo = Math.max(aa[0][0], bb[0][0]);
              let hi = Math.min(aa.at(-1)![1], bb.at(-1)![1]);
              // Stop at an unexplained opening in either boundary rather than bridging a
              // changed footing profile or continuing around an unmeasured wall return.
              for (const is of [aa, bb]) {
                let last = lo;
                for (const [a, b] of is) {
                  if ((a - last) * scale > 1.8) {
                    hi = Math.min(hi, last);
                    break;
                  }
                  last = Math.max(last, b);
                }
              }
              if ((hi - lo) * scale < 1) return [];
              const ca = coverage(aa, lo, hi),
                cb = coverage(bb, lo, hi);
              if (
                Math.min(ca.ratio, cb.ratio) < 0.4 ||
                Math.max(ca.gap, cb.gap) * scale > 1.8
              )
                return [];
              if (
                plan.texts.some(
                  (t) =>
                    /^S\.?F\.?$/.test(t.str.trim()) &&
                    (horizontal ? t.cx : t.cy) > lo - 10 &&
                    (horizontal ? t.cx : t.cy) < hi + 10 &&
                    (horizontal ? t.cy : t.cx) > a - 20 &&
                    (horizontal ? t.cy : t.cx) < b + 20,
                )
              )
                return [];
              const connections = pads.flatMap((pad) => {
                const sh = pad.shape;
                if (sh?.type !== 'point') return [];
                const q = sheetPoint(sh.at, plan.frame),
                  halfAlong = sh.size[axis] / scale / 2,
                  halfAcross = sh.size[cross] / scale / 2;
                const touched =
                  (Math.abs(lo - (q[axis] + halfAlong)) * scale < 0.03 ||
                    Math.abs(hi - (q[axis] - halfAlong)) * scale < 0.03) &&
                  a >= q[cross] - halfAcross - 1 &&
                  b <= q[cross] + halfAcross + 1;
                return touched ? [{ pad, top: sh.z + sh.size[2] }] : [];
              });
              if (
                !connections.length ||
                connections.some(
                  (c) => Math.abs(c.top - connections[0].top) > 0.002,
                )
              )
                return [];
              return [
                { a, b, lo, hi, connections, score: ca.ratio + cb.ratio },
              ];
            }),
        )
        .sort((a, b) => b.score - a.score);
      if (bands.length !== 1) return e;
      const band = bands[0],
        centre = (band.a + band.b) / 2,
        top = band.connections[0].top;
      const points: [number, number][] = horizontal
        ? [
            [band.lo, centre],
            [band.hi, centre],
          ]
        : [
            [centre, band.lo],
            [centre, band.hi],
          ];
      const source: SourceRef = {
        kind: 'spec',
        id: plan.docId,
        page: plan.page,
        label: 'Revised continuous strip footing',
        quote: `${code}: drawn parallel boundaries ${band.a}/${band.b} PDF pt; no S.F. marker in connected band. Datum propagated from directly leader-dimensioned adjoining pad (inferred).`,
        box: horizontal
          ? [band.lo, band.a, band.hi, band.b]
          : [band.a, band.lo, band.b, band.hi],
      };
      return {
        ...e,
        shape: {
          type: 'run' as const,
          points: points.map((p) => worldPoint(p, plan.frame)),
          z0: top - section.depth,
          height: section.depth,
          thickness: section.width,
        },
        sources: [
          ...new Map(
            [
              ...e.sources,
              section.source,
              source,
              ...band.connections.flatMap((c) =>
                c.pad.sources.filter((s) => s.kind === 'spec'),
              ),
            ].map((s) => [JSON.stringify(s), s]),
          ).values(),
        ],
        issues: [
          ...e.issues.filter(
            (i) => !i.startsWith('Foundation revision unresolved:'),
          ),
          `Foundation revision applied: strip centre follows actual revised parallel boundaries; top ${top} m propagated from connected explicitly dimensioned pad. Datum continuity is inferred; no S.F. marker crosses this band. Only source-bounded span represented; original takeoff quantity unchanged.`,
        ],
      };
    }),
  };
}
