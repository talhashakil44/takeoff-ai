import type { Project, Pt } from '../model';
import type { Segment } from '../fill/vectors';
import type { DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import type { ElementShape, SourceRef } from './types';
import { worldPoint } from './sheetCoordinates';
import type { CanopyRegistration } from './canopyRegistration';

export interface CanopyMember {
  shape: Extract<ElementShape, { type: 'run' }>;
  sources: SourceRef[];
  issues: string[];
}
interface SectionProfile {
  profile: Pt[];
  bottom: number;
  width: number;
  depth: number;
  sources: SourceRef[];
}
const dark = (l: Segment) =>
  !l.filled && !l.curve && /^#(?:000000|191919)$/i.test(l.color ?? '');
const distance = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Recover closed steel outlines as drawn, including the fillet vertices. No
 * lookup of a nominal W designation as if it were an actual section dimension. */
export function drawnIProfiles(
  lines: Segment[],
  scale: number,
): { points: Pt[]; box: [number, number, number, number] }[] {
  const result: { points: Pt[]; box: [number, number, number, number] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i];
    if (!dark(first) || first.width < 0.6) continue;
    const points: Pt[] = [
      [first.x1, first.y1],
      [first.x2, first.y2],
    ];
    for (const next of lines.slice(i + 1, i + 30)) {
      if (
        !dark(next) ||
        Math.abs(next.width - first.width) > 0.01 ||
        distance(points.at(-1)!, [next.x1, next.y1]) > 0.02
      )
        break;
      points.push([next.x2, next.y2]);
      if (distance(points[0], points.at(-1)!) > 0.02) continue;
      points.pop();
      if (points.length < 12 || points.length > 24) break;
      const x0 = Math.min(...points.map((p) => p[0])),
        x1 = Math.max(...points.map((p) => p[0])),
        y0 = Math.min(...points.map((p) => p[1])),
        y1 = Math.max(...points.map((p) => p[1]));
      const width = (x1 - x0) * scale,
        depth = (y1 - y0) * scale;
      const area = Math.abs(
        points.reduce(
          (n, p, j) =>
            n +
            p[0] * points[(j + 1) % points.length][1] -
            points[(j + 1) % points.length][0] * p[1],
          0,
        ) / 2,
      );
      const webs = points.flatMap((p, j) => {
        const q = points[(j + 1) % points.length];
        return Math.abs(p[0] - q[0]) < 0.1 &&
          Math.abs(p[1] - q[1]) > (y1 - y0) * 0.6 &&
          Math.abs(p[0] - (x0 + x1) / 2) < (x1 - x0) * 0.1
          ? [p[0]]
          : [];
      });
      if (
        width > 0.05 &&
        width < 0.5 &&
        depth > 0.1 &&
        depth < 1 &&
        depth / width > 1.1 &&
        depth / width < 4 &&
        area / ((x1 - x0) * (y1 - y0)) < 0.4 &&
        webs.length === 2 &&
        Math.abs(webs[0] - webs[1]) * scale > 0.002
      )
        result.push({ points, box: [x0, y0, x1, y1] });
      break;
    }
  }
  return result;
}
function sectionProfile(
  project: Project,
  texts: DrawingTexts,
  lines: DrawingLines,
  topDatum: number,
): SectionProfile | null {
  const found: SectionProfile[] = [];
  for (const sheet of project.sheets.filter(
    (s) => !s.superseded && /^S/i.test(s.name),
  )) {
    const ts = texts[sheet.id] ?? [],
      ls = lines[sheet.id] ?? [];
    for (const title of ts.filter((t) =>
      /^SECTION\s*[-–]\s*ENTRY ROOF FRAMING$/i.test(t.str.trim()),
    )) {
      const scales = ts.flatMap((t) => {
        const m = /^1\s*:\s*(\d+)$/.exec(t.str.trim());
        return m &&
          t.cy > title.cy &&
          t.cy - title.cy < 30 &&
          Math.abs(t.cx - title.cx) < 180
          ? [(+m[1] * 0.0254) / 72]
          : [];
      });
      if (scales.length !== 1) continue;
      const scale = scales[0];
      // Reissued sheets can widen a detail without changing its scale. Bound
      // the datum search by the neighbouring section caption, not a fixed
      // distance from the centre of this caption's text.
      const nextCaption = ts
        .filter(
          (t) =>
            /^SECTION\s*[-–]/i.test(t.str.trim()) &&
            Math.abs(t.cy - title.cy) < 15 &&
            t.cx > title.cx,
        )
        .sort((a, b) => a.cx - b.cx)[0];
      const right = nextCaption
        ? nextCaption.cx - (nextCaption.w ?? 0) / 2
        : title.cx + 500;
      const labels = ts.filter(
        (t) =>
          /^T\/O ENTRY CANOPY$/i.test(t.str.trim()) &&
          t.cx > title.cx - 300 &&
          t.cx < right &&
          t.cy < title.cy &&
          t.cy > title.cy - 700,
      );
      for (const label of labels) {
        const value = ts.find(
          (t) =>
            /^\d{4,5}$/.test(t.str.trim()) &&
            Math.abs(t.cx - label.cx) < 45 &&
            t.cy > label.cy &&
            t.cy - label.cy < 15,
        );
        if (!value || Math.abs(+value.str / 1000 - topDatum) > 0.01) continue;
        const profiles = drawnIProfiles(ls, scale).filter(
          (p) =>
            p.box[0] > title.cx - 350 &&
            p.box[2] < label.cx &&
            p.box[1] > label.cy - 100 &&
            p.box[3] < label.cy + 100,
        );
        if (profiles.length < 2) continue;
        const first = profiles[0],
          width = (first.box[2] - first.box[0]) * scale,
          depth = (first.box[3] - first.box[1]) * scale;
        if (
          profiles.some(
            (p) =>
              Math.abs((p.box[3] - p.box[1]) * scale - depth) > 0.003 ||
              Math.abs((p.box[2] - p.box[0]) * scale - width) > 0.003 ||
              Math.abs(p.box[1] - first.box[1]) * scale > 0.003,
          )
        )
          continue;
        // The datum is a thin horizontal dashed line, independently located by
        // multiple separated strokes, not the label's typographic centre.
        const rows = new Map<
          number,
          { y: number; length: number; count: number }
        >();
        for (const l of ls.filter(
          (l) =>
            !l.filled &&
            !l.curve &&
            l.width > 0 &&
            l.width <= 0.4 &&
            Math.abs(l.y1 - l.y2) < 0.1 &&
            Math.abs(l.y1 - label.cy) < 8 &&
            Math.min(l.x1, l.x2) > title.cx - 350 &&
            Math.max(l.x1, l.x2) < label.cx + 80,
        )) {
          const key = Math.round(l.y1 * 10),
            row = rows.get(key) ?? { y: l.y1, length: 0, count: 0 };
          row.length += Math.abs(l.x2 - l.x1);
          row.count++;
          rows.set(key, row);
        }
        const row = [...rows.values()]
          .filter((r) => r.count >= 3 && r.length > 150)
          .sort((a, b) => b.length - a.length)[0];
        if (!row) continue;
        const bottom = topDatum + (row.y - first.box[3]) * scale,
          cx = (first.box[0] + first.box[2]) / 2;
        found.push({
          profile: first.points.map(([x, y]) => [
            (x - cx) * scale,
            (first.box[3] - y) * scale,
          ]),
          bottom,
          width,
          depth,
          sources: [
            {
              kind: 'sheet',
              id: sheet.id,
              page: sheet.page,
              label: sheet.name,
              box: [
                first.box[0] - 15,
                first.box[1] - 15,
                profiles.at(-1)!.box[2] + 15,
                first.box[3] + 15,
              ],
              quote: `${title.str}; printed 1:${Math.round((scale * 72) / 0.0254)}; two matching drawn I profiles; ${Math.round(width * 100000) / 100} × ${Math.round(depth * 100000) / 100} mm; datum stroke at drawing y=${row.y.toFixed(2)}, steel bottom ${bottom.toFixed(4)} m. Profile dimensions are inferred from scaled section linework, not fabrication dimensions.`,
            },
          ],
        });
      }
    }
  }
  if (
    !found.length ||
    found.some(
      (f) =>
        Math.abs(f.bottom - found[0].bottom) > 0.01 ||
        Math.abs(f.depth - found[0].depth) > 0.003,
    )
  )
    return null;
  return found[0];
}
/** Use the beam tag's baseline and actual black beam ink. Paired silhouettes
 * become a centreline; never promote an arbitrary measured edge into an axis. */
export function centredCanopySpan(
  tag: { cx: number; cy: number; h?: number; angle?: number },
  lines: Segment[],
  scale: number,
): [Pt, Pt] | null {
  if (!tag.h || tag.h < 2) return null;
  const vertical = Math.abs(Math.sin(tag.angle ?? 0)) > 0.7,
    along = (x: number, y: number) => (vertical ? y : x),
    cross = (x: number, y: number) => (vertical ? x : y);
  const normal = vertical
    ? -Math.sin(tag.angle ?? 0)
    : Math.cos(tag.angle ?? 0);
  const at = along(tag.cx, tag.cy),
    base = cross(tag.cx, tag.cy) + (normal * tag.h) / 2;
  const candidates = lines
    .filter(
      (l) =>
        dark(l) &&
        l.width >= 0.6 &&
        Math.abs(cross(l.x1, l.y1) - cross(l.x2, l.y2)) < 0.1,
    )
    .map((l) => ({
      off: cross(l.x1, l.y1),
      lo: Math.min(along(l.x1, l.y1), along(l.x2, l.y2)),
      hi: Math.max(along(l.x1, l.y1), along(l.x2, l.y2)),
    }))
    .filter(
      (l) =>
        l.lo <= at + 3 &&
        l.hi >= at - 3 &&
        (l.hi - l.lo) * scale > 0.5 &&
        Math.abs(l.off - base) * scale < 0.2,
    );
  const unique = candidates.filter(
    (v, i) =>
      !candidates
        .slice(0, i)
        .some(
          (w) =>
            Math.abs(v.off - w.off) < 0.1 &&
            Math.abs(v.lo - w.lo) < 0.1 &&
            Math.abs(v.hi - w.hi) < 0.1,
        ),
  );
  const spans: { off: number; lo: number; hi: number; paired: boolean }[] = [];
  for (let i = 0; i < unique.length; i++)
    for (const b of unique.slice(i + 1)) {
      const a = unique[i],
        width = Math.abs(a.off - b.off) * scale;
      if (
        width < 0.08 ||
        width > 0.2 ||
        Math.abs(a.lo - b.lo) * scale > 0.12 ||
        Math.abs(a.hi - b.hi) * scale > 0.12
      )
        continue;
      spans.push({
        off: (a.off + b.off) / 2,
        lo: Math.max(a.lo, b.lo),
        hi: Math.min(a.hi, b.hi),
        paired: true,
      });
    }
  for (const l of unique) spans.push({ ...l, paired: false });
  const good = spans
    .filter(
      (s) =>
        (s.off - base) * normal * scale >= -0.02 &&
        (s.off - base) * normal * scale < 0.15,
    )
    .sort(
      (a, b) =>
        Number(b.paired) - Number(a.paired) ||
        Math.abs(a.off - base) - Math.abs(b.off - base),
    );
  if (!good.length) return null;
  const best = good[0];
  if (
    good
      .slice(1)
      .some(
        (s) =>
          s.paired === best.paired &&
          (Math.abs(s.off - best.off) * scale > 0.03 ||
            Math.abs(s.lo - best.lo) * scale > 0.12 ||
            Math.abs(s.hi - best.hi) * scale > 0.12),
      )
  )
    return null;
  return vertical
    ? [
        [best.off, best.lo],
        [best.off, best.hi],
      ]
    : [
        [best.lo, best.off],
        [best.hi, best.off],
      ];
}

export function canopyMemberGeometry(
  project: Project,
  texts: DrawingTexts,
  lines: DrawingLines,
  registrations: Record<string, CanopyRegistration>,
): Record<string, CanopyMember> {
  const output: Record<string, CanopyMember> = {};
  const first = Object.values(registrations)[0];
  if (!first) return output;
  // An unlabelled section cannot disambiguate multiple different W sections in
  // this canopy. Require one scheduled designation before sharing its profile.
  const designations = new Set(
    project.measurements
      .filter((m) => registrations[m.id])
      .flatMap((m) => {
        const name = project.types.find((t) => t.id === m.typeId)?.name ?? '',
          match = /\bW\s*(\d+)\s*[x×]\s*(\d+)/i.exec(name);
        return match ? [`${match[1]}x${match[2]}`] : [];
      }),
  );
  if (designations.size !== 1) return output;
  const profile = sectionProfile(project, texts, lines, first.topDatum);
  if (!profile) return output;
  for (const m of project.measurements) {
    const reg = registrations[m.id],
      type = project.types.find((t) => t.id === m.typeId),
      sheet = project.sheets.find((s) => s.id === m.sheetId);
    if (
      !reg ||
      !sheet ||
      type?.kind !== 'linear' ||
      m.points.length !== 2 ||
      distance(m.points[0], m.points[1]) * reg.metersPerPoint < 0.2
    )
      continue;
    const code = /^(B\d+)\b/.exec(type.name)?.[1],
      designation = /\bW\s*(\d+)\s*[x×]\s*(\d+)/i.exec(type.name);
    if (
      !code ||
      !designation ||
      Math.abs(profile.depth / (+designation[1] / 1000) - 1) > 0.1
    )
      continue;
    const schedules: SourceRef[] = [];
    for (const s of project.sheets.filter(
      (s) => !s.superseded && /^S/.test(s.name),
    ))
      for (const mark of (texts[s.id] ?? []).filter(
        (t) => t.str.trim() === code,
      )) {
        const size = (texts[s.id] ?? []).find(
          (t) =>
            Math.abs(t.cy - mark.cy) < 2 &&
            t.cx > mark.cx &&
            t.cx - mark.cx < 160 &&
            new RegExp(
              `^W\\s*${designation[1]}\\s*[x×]\\s*${designation[2]}$`,
              'i',
            ).test(t.str.trim()),
        );
        if (size)
          schedules.push({
            kind: 'sheet',
            id: s.id,
            page: s.page,
            label: s.name,
            box: [mark.cx - 12, mark.cy - 8, size.cx + 70, size.cy + 8],
            quote: `${code}: ${size.str}; drawn section used for profile, not nominal designation dimensions.`,
          });
      }
    if (!schedules.length) continue;
    const vertical =
      Math.abs(m.points[1][1] - m.points[0][1]) >
      Math.abs(m.points[1][0] - m.points[0][0]);
    const tags = (texts[sheet.id] ?? [])
      .filter((t) => t.str.trim() === code)
      .map((t) => t as typeof t & { angle?: number; h?: number })
      .filter((t) => Math.abs(Math.sin(t.angle ?? 0)) > 0.7 === vertical)
      .filter((t) => {
        const along = vertical ? t.cy : t.cx,
          lo = Math.min(...m.points.map((p) => p[vertical ? 1 : 0])),
          hi = Math.max(...m.points.map((p) => p[vertical ? 1 : 0]));
        return (
          along >= lo - 5 &&
          along <= hi + 5 &&
          Math.abs((vertical ? t.cx : t.cy) - m.points[0][vertical ? 0 : 1]) *
            reg.metersPerPoint <
            0.4
        );
      });
    if (tags.length !== 1) continue;
    const span = centredCanopySpan(
      tags[0],
      lines[sheet.id] ?? [],
      reg.metersPerPoint,
    );
    if (!span) continue;
    output[m.id] = {
      shape: {
        type: 'run',
        points: span.map((p) => worldPoint(p, reg.frame)),
        z0: profile.bottom,
        height: profile.depth,
        thickness: profile.width,
        profile: profile.profile,
      },
      sources: [
        ...reg.sources,
        ...schedules,
        ...profile.sources,
        {
          kind: 'sheet',
          id: sheet.id,
          page: sheet.page,
          label: sheet.name,
          box: [
            Math.min(span[0][0], span[1][0]) - 10,
            Math.min(span[0][1], span[1][1]) - 10,
            Math.max(span[0][0], span[1][0]) + 10,
            Math.max(span[0][1], span[1][1]) + 10,
          ],
          quote: `${code}: centreline recovered from black beam ink at tag; original takeoff measurement and quantity preserved.`,
        },
      ],
      issues: [
        'Steel profile and datum offset inferred from calibrated section linework; confirm against steel shop drawings before fabrication.',
        'Displayed span follows the tagged black beam ink and may differ from the saved edge trace. Original takeoff quantity is unchanged; connection/bearing lengths require review.',
      ],
    };
  }
  return output;
}
