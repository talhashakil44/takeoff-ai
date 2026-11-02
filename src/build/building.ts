import { traceGridStroke } from './gridStroke';
import type { Segment } from '../fill/vectors';
import { wallFootprint } from './footprint';
import type { DoorHostHint } from './doorSwings';
import type { Project, Pt } from '../model';
import type { BuildElement, BuildModel } from './types';

export interface DrawingText {
  str: string;
  cx: number;
  cy: number;
  /** Width along the baseline and capital height, in sheet points, when the PDF gave them. */
  w?: number;
  h?: number;
  /** The baseline's direction in radians (0 reads left to right), when the PDF gave it. */
  angle?: number;
}
export type DrawingTexts = Record<string, DrawingText[]>;
export interface Registration {
  x: number;
  y: number;
  grids: string[];
  rotation?: number;
}

const strokeAxesCache = new WeakMap<Segment[], WeakMap<DrawingText[], {width:number; height:number; axes:Record<string,{axis:'x'|'y';at:number}>}>>();
/** Repeated grid labels at opposite ends of an axis. Single room/tag labels are rejected. */
export function gridAxes(texts: DrawingText[], width: number, height: number, focus?: [number, number], lines: Segment[] = []) {
  // Label centres can shift with glyph alignment. Use the smaller capital height
  // so enlarging a sheet does not split one bubble family into separate columns.
  const alignmentTolerance = (a: DrawingText, b: DrawingText) =>
    a.h && b.h && a.h > 0 && b.h > 0 ? Math.min(a.h, b.h) / 2 : 3;
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
    const rows: { axis: 'x' | 'y'; items: DrawingText[]; members: DrawingText[]; score: number }[] = [];
    for (const t of ts)
      for (const axis of ['x', 'y'] as const) {
        const family = ts.filter((v) => Math.abs(axis === 'x' ? v.cy - t.cy : v.cx - t.cx) < alignmentTolerance(t, v));
        const unique = [...new Map(family.map((v) => [v.str.trim(), v])).values()];
        const at = (v: DrawingText) => (axis === 'x' ? v.cx : v.cy);
        const span = Math.max(...unique.map(at)) - Math.min(...unique.map(at));
        if (unique.length >= 3 && span > (axis === 'x' ? width : height) * 0.2) rows.push({ axis, items: unique, members: family, score: unique.length });
      }
    rows.sort((a, b) => b.score - a.score);
    const best = rows[0];
    if (best)
      for (const t of best.items) {
        const key = t.str.trim(), existing = axes[key];
        // Opposite section markers can repeat the same label. A repeated pair
        // must also belong to a multi-label family before it outranks that family.
        // Check all members (not the deduplicated row) to preserve multiple views.
        const corroborated = existing && rows.some(row => row.axis === existing.axis &&
          row.members.some(member => member.str.trim() === key &&
            Math.abs(existing.at - (row.axis === 'x' ? member.cx : member.cy)) < alignmentTolerance(t, member)));
        if (!corroborated) axes[key] = { axis: best.axis, at: best.axis === 'x' ? t.cx : t.cy };
      }
  }
  // Only rescue an incomplete text frame. Keep established frames unchanged.
  // A two-label family is admissible only with actual grid-stroke witnesses;
  // unrelated keynotes must not supply coordinates merely by forming a row.
  const complete = (a: typeof axes) => ['x','y'].every(axis => Object.values(a).filter(v => v.axis === axis).length >= 2);
  if (!complete(axes) && lines.length) {
    const cached=strokeAxesCache.get(lines)?.get(texts);
    if(cached && cached.width===width && cached.height===height){
      if(complete(cached.axes))return structuredClone(cached.axes);
    } else {
    const witnessed: Record<string, {axis:'x'|'y';at:number}[]> = {};
    const labels=texts.filter(t => /^(?:[A-HJ-NP-Z]|[1-9]|1[0-9])$/.test(t.str.trim()) && t.cx < width*.87);
    const ink=lines.filter(l=>!l.filled&&!l.curve&&l.width>0&&l.width<=.6);
    for (const t of labels) {
      for (const axis of ['x','y'] as const) {
        const family=labels.some(v=>v.str.trim()!==t.str.trim() && /^[A-Z]$/.test(v.str.trim())===/^[A-Z]$/.test(t.str.trim()) &&
          Math.abs(axis==='x'?v.cy-t.cy:v.cx-t.cx)<alignmentTolerance(t,v) &&
          Math.abs(axis==='x'?v.cx-t.cx:v.cy-t.cy)>(axis==='x'?width:height)*.2);
        if(!family)continue;
        for (const direction of [-1,1] as const) {
        const at = traceGridStroke(t,ink,axis,direction);
        if (at !== null) (witnessed[t.str.trim()] ??= []).push({axis,at});
        }
      }
    }
    const traced: typeof axes = {};
    for (const [key, values] of Object.entries(witnessed)) {
      const first=values[0];
      if (values.every(v=>v.axis===first.axis && Math.abs(v.at-first.at)<.5))
        traced[key]={axis:first.axis,at:values.reduce((n,v)=>n+v.at,0)/values.length};
    }
    if(!Object.keys(traced).some(k=>/^[A-Z]$/.test(k)))for(const k of Object.keys(traced))delete traced[k];
    const byText=strokeAxesCache.get(lines)??new WeakMap();
    byText.set(texts,{width,height,axes:traced});strokeAxesCache.set(lines,byText);
    if (complete(traced)) return structuredClone(traced);
    }
  }
  // Repeated numbered keynotes are not a grid: require lettered axes too.
  if (!Object.keys(axes).some((k) => /^[A-Z]$/.test(k))) return {};
  return axes;
}
/** Fit two labelled grid families to the same metre coordinate system. */
export function matchGridAxes(axes: ReturnType<typeof gridAxes>, scale: number, reference: ReturnType<typeof gridAxes>, referenceScale: number): Registration | null {
  const candidates: { rotation: number; x: number; y: number; grids: string[]; score: number }[] = [];
  for (const quarter of [0, 1, 2, 3]) {
    const rotation = (quarter * Math.PI) / 2,
      c = Math.round(Math.cos(rotation)),
      sn = Math.round(Math.sin(rotation));
    const offsets: { axis: 'x' | 'y'; value: number; key: string }[] = [];
    for (const [key, axis] of Object.entries(axes)) {
      const target = reference[key];
      if (!target) continue;
      const mapped = quarter % 2 ? (axis.axis === 'x' ? 'y' : 'x') : axis.axis;
      if (mapped !== target.axis) continue;
      const sign = axis.axis === 'x' ? (mapped === 'x' ? c : sn) : mapped === 'x' ? -sn : c;
      offsets.push({ axis: mapped, value: sign * axis.at * scale - target.at * referenceScale, key });
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
  return best ? { x: best.x, y: best.y, grids: best.grids, ...(best.rotation ? { rotation: best.rotation } : {}) } : null;
}
export function registerSheets(project: Project, texts: DrawingTexts, lines: Record<string, Segment[]> = {}): Record<string, Registration> {
  const found = project.sheets
    .filter((s) => s.metersPerPoint && !s.superseded && /PLAN/i.test(s.title ?? '') && !/DETAIL|ENLARG|SITE/i.test(s.title ?? ''))
    .map((s) => {
      const points = project.measurements.filter((m) => m.sheetId === s.id).flatMap((m) => m.points);
      const median = (axis: number) => points.map((p) => p[axis]).sort((a, b) => a - b)[Math.floor(points.length / 2)];
      const focus: [number, number] | undefined = points.length ? [median(0), median(1)] : undefined;
      return { s, axes: gridAxes(texts[s.id] ?? [], s.width, s.height, focus, lines[s.id]) };
    });
  found.sort((a, b) => Object.keys(b.axes).length - Object.keys(a.axes).length);
  // A long numbered legend can outscore a plan but has no crossing axes.
  // Such a sheet cannot define the shared coordinate frame.
  const ref = found.find(({s, axes}) => matchGridAxes(axes, s.metersPerPoint!, axes, s.metersPerPoint!));
  if (!ref) return {};
  const out: Record<string, Registration> = {};
  for (const { s, axes } of found) {
    const matched = matchGridAxes(axes, s.metersPerPoint!, ref.axes, ref.s.metersPerPoint!);
    if (matched) out[s.id] = matched;
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
function insideRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function ringDistance(p: Pt, ring: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return d;
}
/** Recover a closed exterior chain where possible; otherwise explicitly flag a hull allowance. */
function outline(els: BuildElement[]): { ring: Pt[]; exact: boolean; reconstructed?: boolean; unnamed?: boolean; sources: BuildElement['sources'] } | null {
  const walls = els.filter((e) => e.shape?.type === 'run' && ['partitions', 'structure', 'envelope'].includes(e.trade));
  const named = walls.filter((e) => /\b(?:EXTERIOR|EXTERNAL|OUTSIDE|PERIMETER|FA[CÇ]ADE)\b|\b(?:EW|WX|FWX)\d/i.test(`${e.typeName} ${e.name}`));
  // A closed outer wall chain is usable even when the project calls its walls W-A or Type 1.
  // Unlabelled open wall fragments do not justify a convex gross-area allowance.
  const runs = named.length ? named : walls;
  if (!runs.length) return null;
  const sources = [...new Map(runs.flatMap((e) => e.sources).map((s) => [`${s.id}:${s.page}:${s.label}`, s])).values()];
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
  const traced = named.length ? wallFootprint(runs) : null;
  if (traced && (!closed || polygonArea(traced) > polygonArea(closed) * 1.05)) return {ring:traced,exact:true,reconstructed:true,sources};
  if (closed) {
    // A small closed room inside a larger wall network is not a building outline.
    if (!named.length && polygonArea(closed) < polygonArea(hull(walls.flatMap((e) => e.shape?.type === 'run' ? e.shape.points : []))) * 0.85) return null;
    return {ring:closed,exact:true,sources,...(!named.length ? {unnamed:true} : {})};
  }
  if (!named.length) return null;
  const ring = hull(runs.flatMap((e) => (e.shape!.type === 'run' ? e.shape!.points : [])));
  return polygonArea(ring) > 30 ? { ring, exact: false, sources } : null;
}
export function addBuilding(model: BuildModel, project: Project, ftf: number) {
  model.projectType = /renovat|renewal|removals/i.test(
    project.docs.map((d) => d.name).join(' ') + ' ' + project.sheets.map((s) => s.title).join(' '),
  )
    ? 'renovation'
    : 'new';
  model.floorAreas = {};
  const floors = model.levels.filter((l) => !['roof', 'fdn'].includes(l.id));
  const rings: Record<string, Pt[]> = {};
  const built: { level: BuildModel['levels'][number]; ring: Pt[]; area: number; height: number; sources: BuildElement['sources']; glazing: boolean }[] = [];
  for (const [i, l] of floors.entries()) {
    const els = model.elements.filter((e) => e.level === l.id);
    // The walls drawn on the floor plan close the building where the measured walls leave gaps.
    const drawnWalls = (model.drawingGeometry ?? []).filter((e) => e.level === l.id && e.id.startsWith('drawing:wall:'));
    const planWalls = (model.planWalls ?? []).filter((e) => e.level === l.id);
    // Measured exterior walls that close give the floor; where they don't (a convex allowance, or
    // none), the walls drawn on the floor plan close it instead.
    const measured = outline(els);
    const drawnRing = (!measured || !measured.exact) && planWalls.length >= 4 ? wallFootprint([...planWalls, ...els.filter((e) => e.shape?.type === 'run' && ['partitions', 'structure', 'envelope'].includes(e.trade))]) : null;
    const boundary = drawnRing
      ? { ring: drawnRing, exact: true, reconstructed: true, sources: [...new Map(planWalls.flatMap((e) => e.sources).map((s) => [`${s.id}:${s.page}`, { ...s, box: undefined }])).values()] }
      : measured;
    const below = i > 0 ? rings[floors[i - 1].id] : undefined;
    if (boundary?.exact)
      for (const w of [...drawnWalls, ...planWalls]) {
        if (w.shape?.type !== 'run') continue;
        const [a, b] = w.shape.points;
        const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const off = ringDistance(mid, boundary.ring);
        // A drawn wall off this floor but over the floor below stands on a lower wing's roof: a
        // parapet or low wall, a metre high, not a storey. (Off both, the outline is what's short.)
        if (below && !insideRing(mid, boundary.ring) && off > 0.5 && (insideRing(mid, below) || ringDistance(mid, below) < 0.5)) {
          w.shape.height = Math.min(w.shape.height, 1.1);
          w.name = 'Parapet or low wall (from the floor plan, off this floor)';
        } else if (off <= Math.max(0.6, w.shape.thickness)) {
          // On the floor's outline: the building's outside wall, or (drawn thin, a storefront or
          // curtain wall's two lines) its glazing.
          w.trade = 'envelope';
          w.name = w.shape.thickness <= 0.13 ? 'Glazing (curtain wall or storefront, from the floor plan)' : 'Exterior wall (from the floor plan)';
        }
      }
    if (!boundary) {
      model.issues.push({
        id: `outline:${l.id}`,
        severity: 'warning',
        text: `${l.name}: no closed exterior evidence. Building shell and gross area remain unknown; complete-scope scheduling needs an exterior outline.`,
      });
      continue;
    }
    const { ring, exact, reconstructed, unnamed, sources: source } = boundary,
      area = polygonArea(ring);
    rings[l.id] = ring;
    model.floorAreas[l.id] = area;
    if (unnamed)
      model.issues.push({ id: `outline-unnamed:${l.id}`, severity: 'warning', text: `${l.name}: closed wall chain used as a likely exterior boundary without an exterior label. Confirm against the drawing before relying on its gross area.`, sources: source });
    const height =
      (floors[i + 1]?.elevation ?? model.levels.find((level) => level.id === 'roof')?.elevation ?? l.elevation + ftf) - l.elevation;
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
    built.push({ level: l, ring, area, height, sources: source, glazing: planWalls.length > 0 });
    if (!exact)
      model.issues.push({
        id: `outline:${l.id}`,
        severity: 'warning',
        text: `${l.name}: ${Math.round(area)} m² gross area from exterior-wall convex hull. Shell is a planning allowance, not a verified architectural model. Check recesses, slab openings and roof profile.`,
      });
  }

  const context = (id: string, name: string, l: BuildModel['levels'][number], shape: BuildElement['shape'], quantity: number, unit: string, sources: BuildElement['sources'], issue: string): BuildElement => ({
    id, name, trade: 'envelope', level: l.id, shape, quantity, unit, typeId: `building:${id.split(':').at(-1)}`, typeName: name, division: '', measurementId: '',
    sheetId: sources[0]?.id ?? '', specs: [], sources, placement: 'assumed', issues: [issue], origin: 'building', status: model.projectType === 'renovation' ? 'existing' : 'new',
  });
  for (const [k, f] of built.entries()) {
    // A floor bigger than the one above has a roof of its own over the rest (a lower wing).
    const next = built[k + 1];
    if (next && next.area < f.area * 0.85)
      model.elements.push(context(`building:${f.level.id}:lowroof`, 'Lower roof (flat outline allowance)', f.level, { type: 'surface', ring: f.ring, holes: [], z: f.level.elevation + f.height + 0.03, thickness: 0.25 }, f.area - next.area, 'm²', f.sources,
        'Flat roof over the part of this floor the floor above does not cover; slopes and overhangs need review.'));
    // Where the outside wall drawn on the plan stops along the floor's outline (a storefront, a
    // curtain wall, an entrance), the gap is glazed: the building view's façade, not a takeoff.
    if (!f.glazing) continue;
    const walls = (model.planWalls ?? []).filter((w) => w.level === f.level.id && w.shape?.type === 'run' && !/parapet/i.test(w.name));
    const perimeter = f.ring.reduce((n, p, j) => n + Math.hypot(f.ring[(j + 1) % f.ring.length][0] - p[0], f.ring[(j + 1) % f.ring.length][1] - p[1]), 0);
    const gaps: [Pt, Pt][] = [];
    let covered = 0;
    for (const [j, a] of f.ring.entries()) {
      const b = f.ring[(j + 1) % f.ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1) continue;
      const [ux, uy] = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const spans: [number, number][] = [];
      for (const w of walls) {
        if (w.shape?.type !== 'run') continue;
        const [p, q] = w.shape.points;
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (l < 0.05 || Math.abs(((q[0] - p[0]) / l) * -uy + ((q[1] - p[1]) / l) * ux) > 0.1) continue;
        const off = (pt: Pt) => Math.abs((pt[0] - a[0]) * -uy + (pt[1] - a[1]) * ux);
        if (Math.max(off(p), off(q)) > 0.8) continue;
        const t0 = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy,
          t1 = (q[0] - a[0]) * ux + (q[1] - a[1]) * uy;
        spans.push([Math.max(0, Math.min(t0, t1) - 0.1), Math.min(L, Math.max(t0, t1) + 0.1)]);
      }
      spans.sort((x, y) => x[0] - y[0]);
      let at = 0;
      for (const [s0, s1] of [...spans, [L, L] as [number, number]]) {
        if (s0 - at >= 0.9) gaps.push([[a[0] + ux * at, a[1] + uy * at], [a[0] + ux * s0, a[1] + uy * s0]]);
        if (s1 > at) {
          covered += Math.max(0, s1 - Math.max(at, s0));
          at = s1;
        }
      }
    }
    // Only where the drawn walls are most of the outline: otherwise the outline is what's off.
    if (covered < perimeter * 0.5) continue;
    for (const [g, [p, q]] of gaps.entries())
      (model.planWalls ??= []).push({
        ...context(`shell:glazing:${f.level.id}:${g}`, 'Glazing (opening in the outside wall)', f.level, { type: 'run', points: [p, q], z0: f.level.elevation + 0.05, height: Math.max(2.1, f.height - 0.45), thickness: 0.06 }, 0, 'm', f.sources,
          'Gap in the outside wall drawn on the floor plan, shown glazed in the building view; not a takeoff.'),
        origin: 'drawing',
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
export function cutOpenings(model: BuildModel, doorHints = new Map<string, DoorHostHint[]>(), lineworkSheets = new Set<string>()) {
  const inferredHosts: BuildElement[] = [];
  const noSwing: BuildElement[] = [];
  const usedSwings = new Set<string>();
  for (const e of model.elements.filter((e) => e.trade === 'doors' && e.shape?.type === 'point')) {
    const sh = e.shape;
    if (sh?.type !== 'point') continue;
    type Host = { wall: BuildElement; segment: number; offset: number; distance: number };
    const nearestHost = (at: [number, number], limit: number, sameSheet = false): Host | undefined => {
      let nearest: Host | undefined;
      for (const wall of model.elements) {
        const run = wall.shape;
        if (wall.level !== e.level || (sameSheet && wall.sheetId !== e.sheetId) || run?.type !== 'run' || !['partitions', 'structure', 'envelope'].includes(wall.trade)) continue;
        for (let i = 1; i < run.points.length; i++) {
          const a = run.points[i - 1], b = run.points[i], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
          if (len < 0.01) continue;
          const offset = ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / len;
          if (offset < 0 || offset > len) continue;
          const distance = Math.hypot(at[0] - a[0] - (offset * dx) / len, at[1] - a[1] - (offset * dy) / len);
          if (distance < limit && (!nearest || distance < nearest.distance)) nearest = { wall, segment: i - 1, offset, distance };
        }
      }
      return nearest;
    };
    let best = nearestHost(sh.at, 0.6);
    let chosen: { host: Host; hint: DoorHostHint; at: [number, number]; score: number; key: string } | undefined;
    if (/\bdoors?\b/i.test(e.typeName))
      for (const hint of doorHints.get(e.id) ?? []) {
        const key = `${e.sheetId}:${hint.box.map((v) => Math.round(v * 10)).join(':')}`;
        if (usedSwings.has(key)) continue;
        const at: [number, number] = [sh.at[0] + hint.delta[0], sh.at[1] + hint.delta[1]];
        const host = nearestHost(at, 0.4, true);
        if (!host) continue;
        const score = hint.tagDistanceM + host.distance * 2;
        if (!chosen || score < chosen.score) chosen = { host, hint, at, score, key };
      }
    if (chosen) {
      best = chosen.host;
      usedSwings.add(chosen.key);
      sh.at = chosen.at;
      e.sources.push({ kind: 'sheet', id: e.sheetId, page: e.sources[0].page, label: e.sources[0].label, box: chosen.hint.box });
      e.issues.push(`Door swing located within ${chosen.hint.tagDistanceM.toFixed(2)} m of the saved tag; opening midpoint hosted to a wall. The tag point remains in its first source box.`);
    } else if (/\bdoors?\b/i.test(e.typeName) && lineworkSheets.has(e.sheetId)) {
      noSwing.push(e);
      e.issues.push('No door swing could be matched to a wall within 2 m of the saved tag; any proximity host remains provisional.');
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
    if (!e.opening) inferredHosts.push(e);
  }
  if (inferredHosts.length)
    model.issues.push({
      id: 'opening-host-assumptions',
      severity: 'warning',
      text: `${inferredHosts.length} openings were hosted to nearby walls by proximity. Their default width, sill and head need door/window schedule verification.`,
      refs: inferredHosts.map((e) => e.id),
      sources: inferredHosts.slice(0, 3).flatMap((e) => e.sources),
    });
  if (noSwing.length)
    model.issues.push({
      id: 'door-opening-evidence-missing', severity: 'warning',
      text: `${noSwing.length} measured door tags on sheets with linework have no door swing matched to a wall within 2 m. Review their opening and host before relying on their 3D position.`,
      refs: noSwing.map((e) => e.id), sources: noSwing.slice(0, 3).flatMap((e) => e.sources.slice(0, 1)),
    });
}

/** Fill documented square turns where two separate measured wall runs actually meet. */
export function sealWallCorners(model: BuildModel) {
  type Run = Extract<NonNullable<BuildElement['shape']>, { type: 'run' }>;
  type End = {
    element: BuildElement;
    run: Run;
    at: Pt;
    incoming: Pt;
    outgoing: Pt;
    segment: number;
    offset: number;
    length: number;
  };
  const ends: End[] = [];
  for (const element of model.elements) {
    const run = element.shape;
    if (element.origin === 'building' || run?.type !== 'run' || !['partitions', 'structure', 'envelope'].includes(element.trade)) continue;
    if (run.points.length < 2 || run.thickness <= 0) continue;
    const first = run.points[0], second = run.points[1];
    const last = run.points.at(-1)!, previous = run.points.at(-2)!;
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.001) continue;
    const startLength = Math.hypot(second[0] - first[0], second[1] - first[1]);
    const endLength = Math.hypot(last[0] - previous[0], last[1] - previous[1]);
    if (startLength < 0.02 || endLength < 0.02) continue;
    const startOutgoing: Pt = [(second[0] - first[0]) / startLength, (second[1] - first[1]) / startLength];
    const endIncoming: Pt = [(last[0] - previous[0]) / endLength, (last[1] - previous[1]) / endLength];
    ends.push({ element, run, at: first, incoming: [-startOutgoing[0], -startOutgoing[1]], outgoing: startOutgoing, segment: 0, offset: 0, length: startLength });
    ends.push({ element, run, at: last, incoming: endIncoming, outgoing: [-endIncoming[0], -endIncoming[1]], segment: run.points.length - 2, offset: endLength, length: endLength });
  }
  const head = (end: End) => end.run.topPlane
    ? end.run.topPlane[0] * end.at[0] + end.run.topPlane[1] * end.at[1] + end.run.topPlane[2]
    : end.run.z0 + end.run.height;
  const close = (a: End, b: End) => a.element !== b.element && a.element.level === b.element.level &&
    a.element.status === b.element.status &&
    Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) < 0.015 &&
    Math.abs(a.run.z0 - b.run.z0) < 0.05 && Math.abs(head(a) - head(b)) < 0.05 &&
    Math.abs(a.run.thickness - b.run.thickness) < 0.025;
  for (let i = 0; i < ends.length; i++) {
    const a = ends[i];
    const matches = ends.map((end, index) => ({ end, index })).filter(({ end, index }) => index !== i && close(a, end));
    // Do not guess a join at a T intersection or stacked/duplicate walls.
    if (matches.length !== 1 || matches[0].index < i) continue;
    const b = matches[0].end;
    if (ends.filter((end, index) => index !== matches[0].index && close(b, end)).length !== 1) continue;
    const dot = a.incoming[0] * b.outgoing[0] + a.incoming[1] * b.outgoing[1];
    if (Math.abs(dot) > 0.1) continue;
    const size = Math.min(a.run.thickness, b.run.thickness);
    const blocked = (end: End) => (end.run.openings ?? []).some((opening) => opening.segment === end.segment &&
      Math.abs(opening.offset - end.offset) < opening.width / 2 + size / 2);
    if (blocked(a) || blocked(b)) continue;
    const turn = a.incoming[0] * b.outgoing[1] - a.incoming[1] * b.outgoing[0];
    a.run.cornerFills = [...(a.run.cornerFills ?? []), { at: a.at, incoming: a.incoming, turn, size }];
  }
}
