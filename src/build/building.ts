import { wallFootprint } from './footprint';
import type { Project, Pt } from '../model';
import type { BuildElement, BuildModel } from './types';

export interface DrawingText {
  str: string;
  cx: number;
  cy: number;
}
export type DrawingTexts = Record<string, DrawingText[]>;
export interface Registration {
  x: number;
  y: number;
  grids: string[];
  rotation?: number;
}

/** Repeated grid labels at opposite ends of an axis. Single room/tag labels are rejected. */
export function gridAxes(texts: DrawingText[], width: number, height: number, focus?: [number, number]) {
  const labels = new Map<string, DrawingText[]>();
  for (const t of texts) {
    const k = t.str.trim();
    if (!/^(?:[A-HJ-NP-Z]|[1-9]|1[0-9])$/.test(k) || t.cx > width * 0.87) continue;
    labels.set(k, [...(labels.get(k) ?? []), t]);
  }
  const axes: Record<string, { axis: 'x' | 'y'; at: number }> = {};
  for (const [label, ts] of labels) {
    const candidates: { axis: 'x' | 'y'; at: number; span: number }[] = [];
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++) {
        const a = ts[i],
          b = ts[j],
          dx = Math.abs(a.cx - b.cx),
          dy = Math.abs(a.cy - b.cy);
        if (dx < 3 && dy > height * 0.25) candidates.push({ axis: 'x', at: (a.cx + b.cx) / 2, span: dy });
        if (dy < 3 && dx > width * 0.25) candidates.push({ axis: 'y', at: (a.cy + b.cy) / 2, span: dx });
      }
    candidates.sort((a, b) => {
      if (Math.abs(a.span - b.span) > 3) return b.span - a.span;
      if (focus && a.axis === b.axis)
        return Math.abs(a.at - focus[a.axis === 'x' ? 0 : 1]) - Math.abs(b.at - focus[b.axis === 'x' ? 0 : 1]);
      return a.at - b.at;
    });
    if (candidates[0]) axes[label] = candidates[0];
  }
  // Structural plans often put grid bubbles at only one end. Recover a collinear
  // family, then let cross-sheet spacing verification reject room numbers/keynotes.
  for (const letters of [true, false]) {
    const ts = texts.filter((t) => (letters ? /^[A-HJ-NP-Z]$/ : /^(?:[1-9]|1[0-9])$/).test(t.str.trim()) && t.cx < width * 0.87);
    const rows: { axis: 'x' | 'y'; items: DrawingText[]; score: number }[] = [];
    for (const t of ts)
      for (const axis of ['x', 'y'] as const) {
        const family = ts.filter((v) => Math.abs(axis === 'x' ? v.cy - t.cy : v.cx - t.cx) < 3);
        const unique = [...new Map(family.map((v) => [v.str.trim(), v])).values()];
        const at = (v: DrawingText) => (axis === 'x' ? v.cx : v.cy);
        const span = Math.max(...unique.map(at)) - Math.min(...unique.map(at));
        if (unique.length >= 3 && span > (axis === 'x' ? width : height) * 0.2) rows.push({ axis, items: unique, score: unique.length });
      }
    rows.sort((a, b) => b.score - a.score);
    const best = rows[0];
    if (best)
      for (const t of best.items) if (!axes[t.str.trim()]) axes[t.str.trim()] = { axis: best.axis, at: best.axis === 'x' ? t.cx : t.cy };
  }
  // Repeated numbered keynotes are not a grid: require lettered axes too.
  if (!Object.keys(axes).some((k) => /^[A-Z]$/.test(k))) return {};
  return axes;
}
export function registerSheets(project: Project, texts: DrawingTexts): Record<string, Registration> {
  const found = project.sheets
    .filter((s) => s.metersPerPoint && !s.superseded && /PLAN/i.test(s.title ?? '') && !/DETAIL|ENLARG|SITE/i.test(s.title ?? ''))
    .map((s) => {
      const points = project.measurements.filter((m) => m.sheetId === s.id).flatMap((m) => m.points);
      const median = (axis: number) => points.map((p) => p[axis]).sort((a, b) => a - b)[Math.floor(points.length / 2)];
      const focus: [number, number] | undefined = points.length ? [median(0), median(1)] : undefined;
      return { s, axes: gridAxes(texts[s.id] ?? [], s.width, s.height, focus) };
    });
  found.sort((a, b) => Object.keys(b.axes).length - Object.keys(a.axes).length);
  const ref = found[0];
  if (!ref) return {};
  const out: Record<string, Registration> = {};
  for (const { s, axes } of found) {
    const candidates: { rotation: number; x: number; y: number; grids: string[]; score: number }[] = [];
    for (const quarter of [0, 1, 2, 3]) {
      const rotation = (quarter * Math.PI) / 2,
        c = Math.round(Math.cos(rotation)),
        sn = Math.round(Math.sin(rotation));
      const offsets: { axis: 'x' | 'y'; value: number; key: string }[] = [];
      for (const [key, axis] of Object.entries(axes)) {
        const target = ref.axes[key];
        if (!target) continue;
        const mapped = quarter % 2 ? (axis.axis === 'x' ? 'y' : 'x') : axis.axis;
        if (mapped !== target.axis) continue;
        const sign = axis.axis === 'x' ? (mapped === 'x' ? c : sn) : mapped === 'x' ? -sn : c;
        offsets.push({ axis: mapped, value: sign * axis.at * s.metersPerPoint! - target.at * ref.s.metersPerPoint!, key });
      }
      const inliers = (axis: 'x' | 'y') => {
        const vs = offsets.filter((v) => v.axis === axis).sort((a, b) => a.value - b.value);
        if (!vs.length) return [];
        const median = vs[Math.floor(vs.length / 2)].value;
        return vs.filter((v) => Math.abs(v.value - median) < 0.15);
      };
      const xx = inliers('x'),
        yy = inliers('y');
      if (xx.length >= 2 && yy.length >= 2 && xx.length + yy.length >= offsets.length * 0.6) {
        const mean = (v: typeof xx) => v.reduce((n, p) => n + p.value, 0) / v.length;
        candidates.push({ rotation, x: mean(xx), y: mean(yy), grids: [...xx, ...yy].map((v) => v.key), score: xx.length + yy.length });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best) out[s.id] = { x: best.x, y: best.y, grids: best.grids, ...(best.rotation ? { rotation: best.rotation } : {}) };
  }
  return out;
}
export function polygonArea(ring: Pt[]): number {
  return (
    Math.abs(
      ring.reduce((a, p, i) => {
        const q = ring[(i + 1) % ring.length];
        return a + p[0] * q[1] - q[0] * p[1];
      }, 0),
    ) / 2
  );
}
function hull(points: Pt[]): Pt[] {
  const ps = [...new Map(points.map((p) => [p.join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (ps.length < 3) return [];
  const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (pts: Pt[]) => {
    const h: Pt[] = [];
    for (const p of pts) {
      while (h.length > 1 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return [...half(ps), ...half([...ps].reverse())];
}
/** Recover a closed exterior chain where possible; otherwise explicitly flag a hull allowance. */
function outline(els: BuildElement[]): { ring: Pt[]; exact: boolean; reconstructed?: boolean } | null {
  const runs = els.filter(
    (e) => e.shape?.type === 'run' && /\bEW\d|\bWX\d|\bFWX\d|EXTERIOR WALL|EXTERNAL WALL/i.test(`${e.typeName} ${e.name}`),
  );
  if (!runs.length) return null;
  const chains = runs.map((e) => (e.shape!.type === 'run' ? [...e.shape!.points] : []));
  const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.35;
  let closed: Pt[] | null = null;
  while (chains.length) {
    const ring = chains.shift()!;
    let changed = true;
    while (changed && !near(ring[0], ring.at(-1)!)) {
      changed = false;
      for (let j = 0; j < chains.length; j++) {
        const c = chains[j];
        if (near(ring.at(-1)!, c[0])) {
          ring.push(...c.slice(1));
          chains.splice(j, 1);
          changed = true;
          break;
        }
        if (near(ring.at(-1)!, c.at(-1)!)) {
          ring.push(...[...c].reverse().slice(1));
          chains.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
    if (ring.length > 3 && near(ring[0], ring.at(-1)!) && polygonArea(ring) > Math.max(30, closed ? polygonArea(closed) : 0)) closed = ring.slice(0, -1);
  }
  const traced = wallFootprint(runs);
  if (traced && (!closed || polygonArea(traced) > polygonArea(closed) * 1.05)) return {ring:traced,exact:true,reconstructed:true};
  if (closed) return {ring:closed,exact:true};
  const ring = hull(runs.flatMap((e) => (e.shape!.type === 'run' ? e.shape!.points : [])));
  return polygonArea(ring) > 30 ? { ring, exact: false } : null;
}
export function addBuilding(model: BuildModel, project: Project, ftf: number) {
  model.projectType = /renovat|renewal|removals/i.test(
    project.docs.map((d) => d.name).join(' ') + ' ' + project.sheets.map((s) => s.title).join(' '),
  )
    ? 'renovation'
    : 'new';
  model.floorAreas = {};
  const floors = model.levels.filter((l) => !['roof', 'fdn'].includes(l.id));
  for (const [i, l] of floors.entries()) {
    const els = model.elements.filter((e) => e.level === l.id);
    const boundary = outline(els);
    if (!boundary) {
      model.issues.push({
        id: `outline:${l.id}`,
        severity: 'warning',
        text: `${l.name}: no closed exterior evidence. Building shell and gross area remain unknown; complete-scope scheduling needs an exterior outline.`,
      });
      continue;
    }
    const { ring, exact, reconstructed } = boundary,
      area = polygonArea(ring);
    model.floorAreas[l.id] = area;
    const height =
      (floors[i + 1]?.elevation ?? model.levels.find((level) => level.id === 'roof')?.elevation ?? l.elevation + ftf) - l.elevation;
    const source = els.filter((e) => e.shape?.type === 'run' && /EW\d|WX\d|EXTERIOR/i.test(e.name)).flatMap((e) => e.sources);
    const create = (
      suffix: string,
      name: string,
      trade: string,
      shape: BuildElement['shape'],
      quantity: number,
      unit: string,
    ): BuildElement => ({
      id: `building:${l.id}:${suffix}`,
      name,
      trade,
      level: l.id,
      shape,
      quantity,
      unit,
      typeId: `building:${suffix}`,
      typeName: name,
      division: '',
      measurementId: '',
      sheetId: source[0]?.id ?? '',
      specs: [],
      sources: source,
      placement: exact ? 'inferred' : 'assumed',
      issues: [
        exact
          ? reconstructed
            ? 'Wall-following boundary reconstructed across gaps up to 3 m at 100 mm resolution; confirm roof areas, courtyards and slab offsets.'
            : 'Derived from exterior wall chain; confirm openings and slab offsets.'
          : 'Convex exterior allowance: recesses, courtyards and roof slopes require review.',
      ],
      origin: 'building',
      status: model.projectType === 'renovation' ? 'existing' : 'new',
    });
    model.elements.push(
      create(
        'slab',
        'Floor slab (building context)',
        'structure',
        {
          type: 'surface',
          ring,
          holes: [],
          z: l.elevation - 0.2,
          thickness: 0.2,
        },
        area,
        'm²',
      ),
    );
    // The measured exterior walls remain visible. Only fill the shell if the exterior chain
    // is incomplete; these inferred walls are never counted as takeoff.
    if (!exact)
      model.elements.push(
        create(
          'envelope',
          'Exterior wall envelope (allowance)',
          'envelope',
          {
            type: 'run',
            points: [...ring, ring[0]],
            z0: l.elevation,
            height,
            thickness: 0.25,
          },
          ring.reduce((n, p, j) => n + Math.hypot(p[0] - ring[(j + 1) % ring.length][0], p[1] - ring[(j + 1) % ring.length][1]), 0),
          'm',
        ),
      );
    if (i === floors.length - 1)
      model.elements.push(
        create(
          'roof',
          'Roof (flat outline allowance)',
          'envelope',
          {
            type: 'surface',
            ring,
            holes: [],
            z: l.elevation + height,
            thickness: 0.25,
          },
          area,
          'm²',
        ),
      );
    if (!exact)
      model.issues.push({
        id: `outline:${l.id}`,
        severity: 'warning',
        text: `${l.name}: ${Math.round(area)} m² gross area from exterior-wall convex hull. Shell is a planning allowance, not a verified architectural model. Check recesses, slab openings and roof profile.`,
      });
  }
}

/** Datum labels paired with adjacent numeric elevations on sections/elevations only. */
export function levelDatums(project: Project, texts: DrawingTexts): Record<string, number> {
  const values: Record<string, number[]> = {};
  for (const sheet of project.sheets.filter(
    (s) => /SECTION|ELEVATION/i.test(s.title ?? '') && !/INTERIOR|DETAIL|WALL SECTION/i.test(s.title ?? ''),
  )) {
    const ts = texts[sheet.id] ?? [];
    for (const t of ts) {
      const name = t.str.toUpperCase();
      if (!/FIN[.]? |FLOOR|T\/O SLAB/.test(name) || /PLAN|DETAIL/.test(name)) continue;
      const level = /GROUND|MAIN|FIRST/.test(name)
        ? 'L1'
        : /SECOND/.test(name)
          ? 'L2'
          : /THIRD/.test(name)
            ? 'L3'
            : /BASEMENT/.test(name)
              ? 'L0'
              : undefined;
      if (!level) continue;
      const candidates = ts
        .filter((v) => /^-?\d{1,6}(?:\.\d+)?$/.test(v.str) && Math.abs(v.cy - t.cy) < 4 && v.cx < t.cx && t.cx - v.cx < 130)
        .sort((a, b) => b.cx - a.cx);
      const v = candidates[0];
      if (!v) continue;
      const n = Number(v.str) / 1000;
      if (Math.abs(n) < 100) values[level] = [...(values[level] ?? []), n];
    }
  }
  const out: Record<string, number> = {};
  for (const [level, vs] of Object.entries(values)) if (vs.every((v) => Math.abs(v - vs[0]) < 0.05)) out[level] = vs[0];
  return out;
}

/** Associate measured door/window tags with the nearest wall, without changing their takeoff. */
export function cutOpenings(model: BuildModel) {
  for (const e of model.elements.filter((e) => e.trade === 'doors' && e.shape?.type === 'point')) {
    const sh = e.shape;
    if (sh?.type !== 'point') continue;
    let best:
      | {
          wall: BuildElement;
          segment: number;
          offset: number;
          distance: number;
        }
      | undefined;
    for (const wall of model.elements) {
      const run = wall.shape;
      if (wall.level !== e.level || run?.type !== 'run' || !['partitions', 'structure', 'envelope'].includes(wall.trade)) continue;
      for (let i = 1; i < run.points.length; i++) {
        const a = run.points[i - 1],
          b = run.points[i],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        const offset = ((sh.at[0] - a[0]) * dx + (sh.at[1] - a[1]) * dy) / len;
        if (offset < 0 || offset > len) continue;
        const distance = Math.hypot(sh.at[0] - a[0] - (offset * dx) / len, sh.at[1] - a[1] - (offset * dy) / len);
        if (distance < 0.6 && (!best || distance < best.distance)) best = { wall, segment: i - 1, offset, distance };
      }
    }
    if (!best) {
      e.issues.push('No wall within 600 mm of opening tag; host unknown.');
      continue;
    }
    const run = best.wall.shape;
    if (run?.type !== 'run') continue;
    const window = /window|glaz|curtain/i.test(e.name),
      sill = e.opening?.sill ?? (window ? 0.9 : 0),
      height = e.opening?.height ?? (window ? 1.5 : 2.1);
    run.openings = [
      ...(run.openings ?? []),
      {
        elementId: e.id,
        segment: best.segment,
        offset: best.offset,
        width: sh.size[0],
        sill,
        height,
      },
    ];
    for (const other of model.elements) {
      const shape=other.shape;
      if(other===best.wall||other.level!==e.level||other.origin!=='building'||shape?.type!=='run')continue;
      const hostA=run.points[best.segment],hostB=run.points[best.segment+1];
      const hostAngle=Math.atan2(hostB[1]-hostA[1],hostB[0]-hostA[0]);
      for(let segment=0;segment<shape.points.length-1;segment++){
        const a=shape.points[segment],b=shape.points[segment+1],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
        if(!len||Math.abs(Math.sin(Math.atan2(b[1]-a[1],b[0]-a[0])-hostAngle))>.03)continue;
        const offset=((sh.at[0]-a[0])*(b[0]-a[0])+(sh.at[1]-a[1])*(b[1]-a[1]))/len;
        const distance=Math.abs((sh.at[0]-a[0])*(b[1]-a[1])-(sh.at[1]-a[1])*(b[0]-a[0]))/len;
        if(offset<0||offset>len||distance>.35)continue;
        shape.openings=[...(shape.openings??[]),{elementId:e.id,segment,offset,width:sh.size[0],sill:run.z0+sill-shape.z0,height}];
      }
    }
    const a = run.points[best.segment],
      b = run.points[best.segment + 1];
    sh.rotation = Math.atan2(b[1] - a[1], b[0] - a[0]);
    sh.at = [a[0] + Math.cos(sh.rotation) * best.offset, a[1] + Math.sin(sh.rotation) * best.offset];
    sh.size[1] = run.thickness;
    sh.z = run.z0 + sill;
    sh.size[2] = height;
    e.issues.push(e.opening ? 'Opening hosted to wall; dimensions linked to source detail.' : 'Opening host inferred from proximity; width, sill and head require door/window schedule verification.');
  }
}
