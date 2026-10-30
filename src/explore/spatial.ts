import type { Project, Pt, Sheet, Measurement } from "../model";
import type { BuildModel, BuildElement } from "../build/types";
import { simpleRing } from "../build/surface";
import { worldPoint, type SheetFrame } from "../build/sheetCoordinates";
export {
  sheetFrame,
  worldPoint,
  sheetPoint,
  type SheetFrame,
} from "../build/sheetCoordinates";
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export function inside(p: Pt, ring: Pt[]): boolean {
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
export function segmentDistance(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    d = dx * dx + dy * dy,
    t = d
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d))
      : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export interface RoomStop {
  id: string;
  name: string;
  measurement: Measurement;
  element: BuildElement;
  ring: Pt[];
  holes: Pt[][];
  at: Pt;
  floor: number;
  height: number;
  heightBasis: string;
}
export function clearance(p: Pt, ring: Pt[], holes: Pt[][]) {
  if (!inside(p, ring) || holes.some((h) => inside(p, h))) return -1;
  return Math.min(
    ...[ring, ...holes].flatMap((r) =>
      r.map((a, i) => segmentDistance(p, a, r[(i + 1) % r.length])),
    ),
  );
}
export function roomStops(
  project: Project,
  model: BuildModel,
  sheet: Sheet,
  frame: SheetFrame,
): RoomStop[] {
  return project.measurements
    .filter(
      (m) => m.sheetId === sheet.id && (m.source === "rooms" || m.finishes),
    )
    .flatMap((m) => {
      const element = model.elements.find((e) => e.measurementId === m.id);
      if (!element || element.shape?.type !== "surface") return [];
      const ring = m.points.map((p) => worldPoint(p, frame)),
        holes = m.holes.map((h) => h.map((p) => worldPoint(p, frame)));
      if (!simpleRing(ring) || holes.some((h) => !simpleRing(h))) return [];
      const xs = ring.map((p) => p[0]),
        ys = ring.map((p) => p[1]),
        x0 = Math.min(...xs),
        y0 = Math.min(...ys),
        w = Math.max(...xs) - x0,
        h = Math.max(...ys) - y0;
      let best: Pt = [x0, y0],
        space = -1;
      for (let y = 1; y < 32; y++)
        for (let x = 1; x < 32; x++) {
          const p: Pt = [x0 + (w * x) / 32, y0 + (h * y) / 32],
            c = clearance(p, ring, holes);
          const blocked = model.elements.some((e) => {
            const s = e.shape;
            return (
              e.level === element.level &&
              s?.type === "run" &&
              ["partitions", "envelope", "structure"].includes(e.trade) &&
              s.points
                .slice(1)
                .some(
                  (b, j) =>
                    segmentDistance(p, s.points[j], b) < s.thickness / 2 + 0.25,
                )
            );
          });
          if (!blocked && c > space) {
            best = p;
            space = c;
          }
        }
      if (space < 0.35) return [];
      const height = m.ceilingHeight
        ? m.ceilingHeight * (project.units === "imperial" ? 0.3048 : 1)
        : 2.7;
      if (height < 2) return [];
      return [
        {
          id: m.id,
          name: m.label || element.name,
          measurement: m,
          element,
          ring,
          holes,
          at: best,
          floor:
            model.levels.find((l) => l.id === element.level)?.elevation ?? 0,
          height,
          heightBasis: m.ceilingHeight ? "Room takeoff" : "Assumed 2.7 m",
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
/** Sweep every step; no tunnelling through concave corners, cutouts or modelled walls. */
export function moveInside(
  from: Pt,
  to: Pt,
  room: RoomStop,
  walls: BuildElement[],
): Pt {
  const d = Math.hypot(...sub(to, from)),
    steps = Math.ceil(d / 0.05);
  let last = from;
  for (let i = 1; i <= steps; i++) {
    const p: Pt = [
      from[0] + ((to[0] - from[0]) * i) / steps,
      from[1] + ((to[1] - from[1]) * i) / steps,
    ];
    if (clearance(p, room.ring, room.holes) < 0.24) break;
    const blocked = walls.some((e) => {
      const s = e.shape;
      return (
        e.level === room.element.level &&
        s?.type === "run" &&
        s.z0 < room.floor + 1.6 &&
        s.z0 + s.height > room.floor + 0.2 &&
        ["partitions", "envelope", "structure"].includes(e.trade) &&
        s.points
          .slice(1)
          .some(
            (b, j) =>
              segmentDistance(p, s.points[j], b) < s.thickness / 2 + 0.24,
          )
      );
    });
    if (blocked) break;
    last = p;
  }
  return last;
}
