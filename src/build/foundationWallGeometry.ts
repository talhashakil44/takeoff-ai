import type { Project } from '../model';
import { gridAxes, type DrawingText, type DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import { sheetPoint, worldPoint, type SheetFrame } from './sheetCoordinates';
import type { BuildElement, BuildModel, SourceRef } from './types';

interface Plan {
  docId: string;
  page: number;
  sheetId: string;
  frame: SheetFrame;
  texts: DrawingText[];
  lines: DrawingLines[string];
}
interface Leader {
  tip: [number, number];
  top: number;
  bottom: number;
  source: SourceRef;
}
const codeOf = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const black = (l: DrawingLines[string][number]) =>
  !l.filled && !l.curve && (!l.color || l.color === '#000000');
const ref = (
  plan: Plan,
  page: number,
  label: string,
  quote: string,
  box: number[],
): SourceRef => ({
  kind: 'spec',
  id: plan.docId,
  page,
  label,
  quote,
  box: box as [number, number, number, number],
});

/** Deliberately narrow: a closed hatched ICF panel crossed by an explicit
 * numbered exterior-slab section with a wall-drop and both vertical datums. */
export function recoverFoundationWalls(
  project: Project,
  model: BuildModel,
  plan: Plan,
  texts: DrawingTexts,
  pages: { docId: string; page: number }[],
  leaders: Leader[],
  crosses: (
    axis: number,
    a: number,
    b: number,
    lo: number,
    hi: number,
  ) => boolean,
  stripWidths: number[],
  acceptedFrame: SheetFrame | null,
): BuildModel {
  const scale = Math.hypot(plan.frame.a, plan.frame.b);
  const axes = gridAxes(
    plan.texts,
    Math.max(...plan.texts.map((t) => t.cx)) + 50,
    Math.max(...plan.texts.map((t) => t.cy)) + 50,
  );
  const rows = pages
    .filter((p) => p.docId === plan.docId)
    .flatMap((p) => {
      const ts = texts[`spec:${p.docId}:${p.page}`] ?? [];
      if (!ts.some((t) => /^FOUNDATION WALL SCHEDULE$/i.test(t.str.trim())))
        return [];
      return ts
        .filter((t) => /^FW-?\d+$/.test(t.str.trim()))
        .flatMap((tag) => {
          const row = ts.filter(
            (t) =>
              Math.abs(t.cy - tag.cy) < 3 &&
              t.cx > tag.cx &&
              t.cx < tag.cx + 180,
          );
          const assembly = row.filter((t) => /^\d+$/.test(t.str.trim()));
          const core = row.flatMap((t) => {
            const m = /^ICF\s*\((\d+)\s+CONCRETE\)$/i.exec(t.str.trim());
            return m ? [Number(m[1]) / 1000] : [];
          });
          if (
            assembly.length !== 1 ||
            core.length !== 1 ||
            core[0] >= Number(assembly[0].str) / 1000
          )
            return [];
          return [
            {
              code: codeOf(tag.str),
              assembly: Number(assembly[0].str) / 1000,
              core: core[0],
              source: ref(
                plan,
                p.page,
                'Revised ICF foundation wall schedule',
                `${tag.str}: ${assembly[0].str} mm ICF assembly; ${core[0] * 1000} mm concrete core.`,
                [tag.cx - 10, tag.cy - 5, tag.cx + 180, tag.cy + 5],
              ),
            },
          ];
        });
    });
  const sections = pages
    .filter((p) => p.docId === plan.docId)
    .flatMap((p) => {
      const ts = texts[`spec:${p.docId}:${p.page}`] ?? [];
      const markers = ts
        .filter((t) => /^\d+$/.test(t.str.trim()))
        .flatMap((n) => {
          const sheets = ts.filter(
            (t) =>
              /^S\d+\.\d+$/i.test(t.str.trim()) &&
              Math.abs(t.cx - n.cx) < 5 &&
              t.cy > n.cy &&
              t.cy - n.cy < 25,
          );
          return sheets.length === 1 ? [{ n, sheet: sheets[0] }] : [];
        });
      return ts
        .filter((t) =>
          /^SECTION\s*-\s*(?:TYPICAL\s+)?EXTERIOR SLAB ON GRADE AT FOUNDATION WALL$/i.test(
            t.str.trim(),
          ),
        )
        .flatMap((title) => {
          const marker = markers
            .filter(
              (m) =>
                Math.abs(m.n.cy - title.cy) < 5 &&
                m.n.cx < title.cx &&
                title.cx - m.n.cx < 500,
            )
            .sort((a, b) => b.n.cx - a.n.cx)[0];
          if (!marker) return [];
          const right = Math.min(
            ...markers
              .filter(
                (m) =>
                  Math.abs(m.n.cy - marker.n.cy) < 20 && m.n.cx > marker.n.cx,
              )
              .map((m) => m.n.cx - 20),
            marker.n.cx + 850,
          );
          const bounds = [marker.n.cx - 20, title.cy - 450, right, title.cy];
          const local = ts.filter(
            (t) =>
              t.cx > bounds[0] &&
              t.cx < bounds[2] &&
              t.cy > bounds[1] &&
              t.cy < bounds[3],
          );
          const drops = local.flatMap((t) => {
            const m = /^DROP FOUNDATION WALL (\d+)$/i.exec(t.str.trim());
            return m ? [{ t, value: Number(m[1]) / 1000 }] : [];
          });
          const floor = local.filter((t) =>
            /^FIN\.? GROUND FLOOR$/i.test(t.str.trim()),
          );
          const footing = local.filter((t) =>
            /^T\/O FOOTING$/i.test(t.str.trim()),
          );
          const value = (t: DrawingText) =>
            local.filter(
              (v) =>
                /^-?\d+$/.test(v.str.trim()) &&
                Math.abs(v.cx - t.cx) < 50 &&
                v.cy > t.cy &&
                v.cy - t.cy < 15,
            );
          if (
            drops.length !== 1 ||
            floor.length !== 1 ||
            footing.length !== 1 ||
            !local.some((t) => /^ICF FOUNDATION WALL,?$/i.test(t.str.trim())) ||
            !local.some((t) => /^AND POUR SLAB OVER$/i.test(t.str.trim()))
          )
            return [];
          const floors = value(floor[0]),
            bases = value(footing[0]);
          if (floors.length !== 1 || bases.length !== 1) return [];
          const top = Number(floors[0].str) / 1000 - drops[0].value,
            bottom = Number(bases[0].str) / 1000;
          if (top <= bottom) return [];
          return [
            {
              number: marker.n.str,
              sheet: marker.sheet.str,
              top,
              bottom,
              local,
              source: ref(
                plan,
                p.page,
                'Revised explicitly cut ICF wall section',
                `${marker.n.str}/${marker.sheet.str}: ${drops[0].t.str}; ground floor ${floors[0].str} mm; footing top ${bases[0].str} mm.`,
                bounds,
              ),
            },
          ];
        });
    });
  const candidates: BuildElement[] = [];
  const mismatch = new Set<string>();
  for (const row of rows)
    for (const axis of [0, 1]) {
      if (
        rows.some(
          (other) =>
            other.code === row.code &&
            (other.core !== row.core || other.assembly !== row.assembly),
        )
      )
        continue;
      const cross = 1 - axis;
      const edges = plan.lines.filter(
        (l) =>
          black(l) &&
          l.width >= 0.5 &&
          Math.abs(cross === 0 ? l.x1 - l.x2 : l.y1 - l.y2) < 0.05 &&
          Math.abs(axis === 0 ? l.x1 - l.x2 : l.y1 - l.y2) * scale >
            row.assembly * 2,
      );
      const unique = [
        ...new Map(
          edges.map((l) => {
            const at = cross === 0 ? l.x1 : l.y1,
              lo = Math.min(axis === 0 ? l.x1 : l.y1, axis === 0 ? l.x2 : l.y2),
              hi = Math.max(axis === 0 ? l.x1 : l.y1, axis === 0 ? l.x2 : l.y2);
            return [
              `${at.toFixed(2)}:${lo.toFixed(2)}:${hi.toFixed(2)}`,
              { at, lo, hi },
            ];
          }),
        ).values(),
      ];
      for (const left of unique)
        for (const right of unique) {
          if (
            right.at <= left.at ||
            Math.abs((right.at - left.at) * scale - row.assembly) > 0.015 ||
            Math.abs(left.lo - right.lo) > 0.15 ||
            Math.abs(left.hi - right.hi) > 0.15 ||
            (left.hi - left.lo) * scale < row.assembly * 2
          )
            continue;
          const { lo, hi } = left,
            centre = (left.at + right.at) / 2;
          const caps = [lo, hi].every((at) =>
            plan.lines.some(
              (l) =>
                black(l) &&
                l.width >= 0.5 &&
                Math.abs((axis === 0 ? l.x1 : l.y1) - at) < 0.15 &&
                Math.abs((axis === 0 ? l.x2 : l.y2) - at) < 0.15 &&
                Math.abs(
                  Math.min(
                    cross === 0 ? l.x1 : l.y1,
                    cross === 0 ? l.x2 : l.y2,
                  ) - left.at,
                ) < 0.15 &&
                Math.abs(
                  Math.max(
                    cross === 0 ? l.x1 : l.y1,
                    cross === 0 ? l.x2 : l.y2,
                  ) - right.at,
                ) < 0.15,
            ),
          );
          if (!caps) continue;
          const hatch = plan.lines.filter(
            (l) =>
              black(l) &&
              l.width <= 0.3 &&
              Math.abs(cross === 0 ? l.x1 - l.x2 : l.y1 - l.y2) < 0.05 &&
              (cross === 0 ? l.x1 : l.y1) > left.at &&
              (cross === 0 ? l.x1 : l.y1) < right.at &&
              Math.abs(
                Math.min(axis === 0 ? l.x1 : l.y1, axis === 0 ? l.x2 : l.y2) -
                  lo,
              ) < 0.15 &&
              Math.abs(
                Math.max(axis === 0 ? l.x1 : l.y1, axis === 0 ? l.x2 : l.y2) -
                  hi,
              ) < 0.15,
          );
          if (hatch.length < 3) continue;
          const tags = plan.texts.filter(
            (t) =>
              codeOf(t.str) === row.code &&
              plan.lines.some((l) => {
                if (!black(l) || l.width < 0.5) return false;
                const a = [l.x1, l.y1],
                  b = [l.x2, l.y2];
                return [
                  [a, b],
                  [b, a],
                ].some(
                  ([p, q]) =>
                    Math.abs(p[cross] - centre) < 0.15 &&
                    p[axis] > lo &&
                    p[axis] < hi &&
                    Math.abs(p[axis] - q[axis]) < 0.05 &&
                    Math.hypot(q[0] - t.cx, q[1] - t.cy) < 35,
                );
              }),
          );
          if (tags.length !== 1) continue;
          const grid = Object.entries(axes).filter(
            ([, g]) =>
              g.axis === (cross === 0 ? 'x' : 'y') &&
              Math.abs(g.at - centre) * scale < row.assembly,
          );
          if (grid.length !== 1) continue;
          const proofs = sections.flatMap((section) => {
            if (
              !section.local.some(
                (t) =>
                  t.str.trim() === grid[0][0] &&
                  t.cy < section.source.box![3] - 200,
              )
            )
              return [];
            return plan.texts
              .filter((t) => t.str.trim() === section.sheet)
              .flatMap((sheet) => {
                const ns = plan.texts.filter(
                  (t) =>
                    t.str.trim() === section.number &&
                    Math.abs(t.cx - sheet.cx) < 3 &&
                    sheet.cy - t.cy > 0 &&
                    sheet.cy - t.cy < 22,
                );
                if (ns.length !== 1) return [];
                const at = (ns[0].cy + sheet.cy) / 2;
                const cuts = plan.lines.filter(
                  (l) =>
                    black(l) &&
                    l.width >= 0.5 &&
                    Math.abs(
                      (axis === 0 ? l.x1 : l.y1) - (axis === 0 ? sheet.cx : at),
                    ) < 1 &&
                    Math.abs(axis === 0 ? l.x1 - l.x2 : l.y1 - l.y2) < 0.1 &&
                    Math.min(
                      cross === 0 ? l.x1 : l.y1,
                      cross === 0 ? l.x2 : l.y2,
                    ) < left.at &&
                    Math.max(
                      cross === 0 ? l.x1 : l.y1,
                      cross === 0 ? l.x2 : l.y2,
                    ) > right.at &&
                    Math.min(
                      Math.hypot(l.x1 - sheet.cx, l.y1 - at),
                      Math.hypot(l.x2 - sheet.cx, l.y2 - at),
                    ) < 35,
                );
                return cuts.length === 1 &&
                  (axis === 0 ? sheet.cx : at) > lo &&
                  (axis === 0 ? sheet.cx : at) < hi
                  ? [{ section, cut: cuts[0] }]
                  : [];
              });
          });
          if (proofs.length !== 1) continue;
          const { section, cut } = proofs[0];
          const box =
            axis === 0
              ? [lo, left.at, hi, right.at]
              : [left.at, lo, right.at, hi];
          if (
            plan.texts.some(
              (t) =>
                /\bSTEP(?:PED)?\b|^S\.?F\.?$/i.test(t.str.trim()) &&
                (axis === 0 ? t.cx : t.cy) >= lo &&
                (axis === 0 ? t.cx : t.cy) <= hi &&
                (cross === 0 ? t.cx : t.cy) >= left.at - 0.5 / scale &&
                (cross === 0 ? t.cx : t.cy) <= right.at + 0.5 / scale,
            )
          )
            continue;
          if (
            leaders.some(
              (l) =>
                l.tip[axis] > lo &&
                l.tip[axis] < hi &&
                Math.abs(l.tip[cross] - centre) * scale < 0.5 &&
                Math.abs(l.top - section.bottom) > 0.002,
            )
          )
            continue;
          // Check any locally drawn footing-width crossbar through this panel.
          if (
            crosses(axis, left.at, right.at, lo, hi) ||
            stripWidths.some((width) =>
              crosses(
                axis,
                centre - width / scale / 2,
                centre + width / scale / 2,
                lo,
                hi,
              ),
            )
          )
            continue;
          const related = model.elements.filter(
            (e) =>
              e.sheetId === plan.sheetId &&
              codeOf(/^FW-?\d+/.exec(e.typeName)?.[0] ?? '') === row.code,
          );
          if (related.length && !acceptedFrame) continue;
          let accepted = false;
          const localMismatch = new Set<string>();
          for (const e of related) {
            const measurement = project.measurements.find(
              (m) => m.id === e.measurementId,
            );
            const points = acceptedFrame
              ? measurement?.points.map((p) =>
                  sheetPoint(worldPoint(p, acceptedFrame), plan.frame),
                )
              : undefined;
            if (!points || points.length < 2) continue;
            const along = points.map((p) => p[axis]),
              across = points.map((p) => p[cross]);
            if (
              across.every((v) => Math.abs(v - centre) * scale < 0.03) &&
              Math.abs(Math.min(...along) - lo) * scale < 0.03 &&
              Math.abs(Math.max(...along) - hi) * scale < 0.03
            )
              accepted = true;
            else if (
              points.some(
                (p) =>
                  p[axis] > lo &&
                  p[axis] < hi &&
                  Math.abs(p[cross] - centre) * scale < 0.1,
              )
            ) {
              mismatch.add(e.id);
              localMismatch.add(e.id);
            }
          }
          if (accepted) continue;
          const id = `drawing:foundation:${plan.docId}:${plan.page}:wall:${row.code}:${box.map((v) => v.toFixed(2)).join(':')}`;
          const points = (
            axis === 0
              ? [
                  [lo, centre],
                  [hi, centre],
                ]
              : [
                  [centre, lo],
                  [centre, hi],
                ]
          ).map((p) => worldPoint(p as [number, number], plan.frame));
          candidates.push({
            id,
            measurementId: id,
            typeId: '',
            typeName: `${row.code} – ICF concrete core`,
            name: `${row.code} – Drawing-derived wall core`,
            trade: 'structure',
            division: '03',
            level: related[0]?.level ?? null,
            sheetId: plan.sheetId,
            measurementSource: 'foundations',
            origin: 'drawing',
            status: 'new',
            quantity: 0,
            unit: '',
            planningExcluded:
              'Drawing-derived geometry; no accepted takeoff quantity',
            placement: 'inferred',
            shape: {
              type: 'run',
              points,
              z0: section.bottom,
              height: section.top - section.bottom,
              thickness: row.core,
            },
            specs: [],
            sources: [
              row.source,
              section.source,
              ref(
                plan,
                plan.page,
                'Revised closed ICF panel and section cut',
                `${row.code} closed hatched panel crossed by ${section.number}/${section.sheet} adjacent to grid ${grid[0][0]}. ${row.assembly} m assembly footprint; centred ${row.core} m concrete core placement inferred. Full-panel datum applicability inferred.`,
                box,
              ),
              ref(
                plan,
                plan.page,
                'Revised ICF wall tag and cut evidence',
                `Actual wall-tag leader and section-cut stroke; accepted annotation-leader measurements are not wall axes.`,
                [
                  Math.min(cut.x1, cut.x2, tags[0].cx),
                  Math.min(cut.y1, cut.y2, tags[0].cy),
                  Math.max(cut.x1, cut.x2, tags[0].cx),
                  Math.max(cut.y1, cut.y2, tags[0].cy),
                ],
              ),
            ],
            issues: [
              'Drawing-derived geometry: no accepted takeoff quantity.',
              `Foundation revision applied: explicit local section gives top ${section.top} m and base ${section.bottom} m; applying these to the closed panel is inferred. Concrete core ${row.core} m; assembly ${row.assembly} m is not concrete thickness.`,
              ...(localMismatch.size
                ? [
                    'Foundation revision discrepancy: nearby accepted wall record follows annotation/cut line rather than this panel axis. Its quantity remains unchanged; this source-only wall has no accepted quantity.',
                  ]
                : []),
            ],
          });
        }
    }
  const unique = [...new Map(candidates.map((e) => [e.id, e])).values()];
  const prefix = 'Foundation revision discrepancy: accepted wall axis follows';
  return {
    ...model,
    elements: model.elements.map((e) => ({
      ...e,
      issues: [
        ...e.issues.filter((i) => !i.startsWith(prefix)),
        ...(mismatch.has(e.id)
          ? [
              `${prefix} an annotation/cut line rather than the closed ICF panel. Accepted measurement and quantity unchanged; review extraction before pricing.`,
            ]
          : []),
      ],
    })),
    drawingGeometry: [
      ...(model.drawingGeometry ?? []).filter((e) => !e.id.includes(':wall:')),
      ...unique,
    ],
  };
}
