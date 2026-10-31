import { drawSegments, floodFill, makeGrid, simplify, toSheet, traceBoundary, type Grid } from '../fill/raster';
import type { Segment } from '../fill/vectors';
import { newId, type AssemblyItem, type Measurement, type Project, type Pt, type Sheet, type TakeoffType } from '../model';
import type { PageText } from '../pageText';
import { tradeOfNumber } from '../sheetKind';
import { readSchedules, type Schedule } from '../smart/schedules';
import { titleBlockBox } from '../titleBlock';
import { replaceRun, type Automation } from './result';
import { perSheet, type SetAccess } from './set';
import { automateWalls } from './walls';

/**
 * Foundations, off the foundation plan and the structural schedules, as an estimator takes them:
 *
 * - pad footings, piers and mass footings counted where the plan tags them (F1, P2, MF1), each
 *   type sized from its schedule (1500 x 1500 x 300) so its concrete is worked out;
 * - foundation walls along their tagged runs (FW-1…), with the strip footing tagged beside each
 *   run (SF-1) taken along the same run, sized from the footing schedule;
 * - the slab on grade inside the foundation walls;
 * - excavation over the footprint plus working room, to an assumed depth the estimator sets.
 *
 * Quantities come from the drawings; what is assumed (the excavation depth and working room, a
 * size the schedule doesn't give) is said in the type and in the checks. Nothing already taken
 * off is changed: a re-run replaces only this tool's own takeoffs.
 */

export type FoundationKind = 'pad' | 'strip' | 'pier' | 'mass' | 'wall';

export interface FoundationMark {
  mark: string;
  kind: FoundationKind;
  /** Plan sizes in metres: width (and length for a pad), as the schedule gives them. */
  width?: number;
  length?: number;
  /** Depth (thickness) in metres. */
  depth?: number;
  /** The schedule's words for it ("1500 x 1500", "200 CONCRETE"). */
  says: string;
  schedule: string;
}

/** A footing mark: F1, SF-2, S/F-5, P3A; or a lettered one the schedule details elsewhere (SF-N, "refer to detail"). */
const MARK = /^(?:[A-Z]{1,3}|[A-Z]{1,2}\/[A-Z]{1,2})-?(?:\d{1,2}[A-Z]?|N)$/;
const norm = (s: string) => s.toUpperCase().replace(/[\s.-]/g, '');

/** A length in metres from schedule words: millimetres (1500) on a metric set, feet and inches (4'-6") on an imperial one. */
export function lengthOf(word: string, metric: boolean): number | null {
  const w = word.trim();
  const ft = /^(\d+)\s*['′]\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:["″])?$/.exec(w);
  if (ft) return (Number(ft[1]) + Number(ft[2] ?? 0) / 12) * 0.3048;
  const inch = /^(\d+(?:\.\d+)?)\s*["″]$/.exec(w);
  if (inch) return Number(inch[1]) * 0.0254;
  const n = /^(\d+(?:\.\d+)?)\s*(MM|M)?$/i.exec(w);
  if (!n) return null;
  const v = Number(n[1]);
  // 15M, 20M are rebar sizes; metres are written with a decimal (1.5M) or small.
  if (n[2]?.toUpperCase() === 'M') return /\./.test(n[1]) || v < 10 ? v : null;
  return metric || v >= 50 ? v / 1000 : v * 0.0254;
}

/** "1500 x 1500" → [1.5, 1.5]; "600" → [0.6]; "4'-0\" x 4'-0\"" → [1.219, 1.219]. */
export function sizesOf(text: string, metric: boolean): number[] {
  return text
    .split(/\s*[x×X]\s*/)
    .map((p) => p.trim().split(/\s+/)[0] ?? '')
    .map((p) => lengthOf(p, metric))
    .filter((v): v is number => v !== null && v > 0.05 && v < 30);
}

const column = (s: Schedule, re: RegExp) => s.columns.findIndex((c) => re.test(c.join(' ')));

/** The foundation marks the structural schedules list: footings, piers, mass footings, foundation walls. */
export function foundationMarks(schedules: Schedule[], metric: boolean): FoundationMark[] {
  const out: FoundationMark[] = [];
  for (let s of schedules) {
    const t = s.title.toUpperCase();
    const which: FoundationKind | 'footing' | null = /MASS\s+FOOTING/.test(t)
      ? 'mass'
      : /FOOTING|FOOTINGS/.test(t)
        ? 'footing'
        : /\bPIERS?\b|PILASTER/.test(t)
          ? 'pier'
          : /FOUNDATION\s+WALL/.test(t)
            ? 'wall'
            : null;
    if (!which) continue;
    // Headings read as the first row (no heading band above the rows): "PIER TAG | PIER SIZE | ...".
    const head = s.columns.every((c) => !c.length) && s.rows[0]?.cells.length && s.rows[0].cells.every((c) => !/\d/.test(c)) ? s.rows[0] : null;
    if (head) s = { ...s, columns: head.cells.map((c) => [c]), rows: s.rows.slice(1) };
    const size = column(s, /\bSIZE\b|DIMENSION/i);
    const depth = column(s, /DEPTH|THICK/i);
    const type = column(s, /\bTYPE\b/i);
    for (const r of s.rows) {
      // A row whose first column was read as its rebar (15M) has its mark in the cells.
      const mark = MARK.test(r.mark) && !/^\d+M$/.test(r.mark) ? r.mark : r.cells.find((c) => MARK.test(c.trim()))?.trim();
      if (!mark || out.some((o) => norm(o.mark) === norm(mark))) continue;
      const cell = (i: number) => (i >= 0 ? (r.cells[i] ?? '').trim() : '');
      let kind: FoundationKind;
      if (which === 'footing') {
        const ty = cell(type).toUpperCase();
        kind = /^S|STRIP|CONT/.test(ty) ? 'strip' : /^P|PAD|SPREAD|ISOL/.test(ty) ? 'pad' : /^S\/?F/.test(norm(mark)) || /\bCONT/i.test(cell(size)) ? 'strip' : 'pad';
      } else kind = which;
      const sz = sizesOf(cell(size), metric);
      // Depth in its own column, or the last of a footing's sizes ("W x Lg x THK": 1800 x 1800 x 400; a
      // strip's "W x THK x CONTINUOUS": 600 x 300).
      const d = cell(depth)
        ? sizesOf(cell(depth), metric)[0]
        : (kind === 'pad' || kind === 'mass') && sz.length === 3
          ? sz[2]
          : kind === 'strip' && sz.length === 2
            ? sz[1]
            : undefined;
      // A wall's thickness: its type column ("200 CONCRETE", "458 ICF (300 CONCRETE)": the concrete).
      const wallWords = kind === 'wall' ? cell(column(s, /WALL\s*TYPE|THICK/i)) || r.cells[1] || '' : '';
      const wallThick = kind === 'wall' ? (sizesOf(/\((\d+)\s*CONCRETE\)/i.exec(wallWords)?.[1] ?? wallWords, metric)[0] ?? undefined) : undefined;
      out.push({
        mark,
        kind,
        width: kind === 'wall' ? wallThick : sz[0],
        length: kind === 'pad' || kind === 'pier' || kind === 'mass' ? (sz[1] ?? sz[0]) : undefined,
        depth: d,
        says: r.cells.filter(Boolean).slice(1, 4).join(' · '),
        schedule: s.title,
      });
    }
  }
  return out;
}

/** Whether a sheet is a foundation (or footing) plan: by its title, or its own view title. */
export function isFoundationPlan(sheet: Pick<Sheet, 'title'>, texts: PageText[]): boolean {
  if (/FOUNDATION|FOOTING/i.test(sheet.title ?? '') && /PLAN/i.test(sheet.title ?? '')) return true;
  return texts.some((t) => /^(?:\w+\s+)?FOUNDATION\s+PLAN$|^FOOTING\s+PLAN$/i.test(t.str.trim()) && t.h >= 6);
}

/** Text runs of a plan that are tags: not in the title block or a schedule drawn on the sheet. */
export function tagTexts(texts: PageText[], sheet: Sheet, boxes: [number, number, number, number][]): PageText[] {
  const tb = titleBlockBox(texts, sheet.width, sheet.height);
  const inBox = (t: PageText, b: [number, number, number, number]) => t.cx >= b[0] - 2 && t.cx <= b[2] + 2 && t.cy >= b[1] - 2 && t.cy <= b[3] + 2;
  return texts.filter((t) => !(tb && inBox(t, tb)) && !boxes.some((b) => inBox(t, b)));
}

/** Where the plan writes each mark: a tag's own text, or one of the words of a stacked tag ("F1 / P2"). */
export function markPlaces(texts: PageText[], marks: FoundationMark[]): Map<string, Pt[]> {
  const byNorm = new Map(marks.map((m) => [norm(m.mark), m.mark]));
  const out = new Map<string, Pt[]>();
  for (const t of texts) {
    const words = t.str.trim().split(/\s*[/,]\s*|\s+/).filter(Boolean);
    if (words.length > 3) continue; // A note naming a footing, not a tag.
    if (words.some((w) => /^(?:AT|@|SEE|REFER|TO|SIM\.?|SIMILAR)$/i.test(w))) continue; // "TYP. AT MF3": a note pointing at tags.
    for (const w of words) {
      const m = byNorm.get(norm(w));
      if (m) out.set(m, [...(out.get(m) ?? []), [t.cx, t.cy]]);
    }
  }
  return out;
}

const item = (name: string, unit: string, formula: string): AssemblyItem => ({ id: newId(), name, unit, formula });
const fmtM = (v?: number) => (v === undefined ? '?' : `${Math.round(v * 1000)}`);

/** Distance from a point to a polyline. */
function toRun(p: Pt, run: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < run.length; i++) {
    const [a, b] = [run[i - 1], run[i]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy));
  }
  return best;
}

/**
 * The outline the foundation walls enclose, in sheet points: the walls drawn on a grid of about
 * 100 mm, door-width gaps closed, flooded from outside; the largest enclosed region, traced.
 * Grown by `grow` metres first for the excavation (the footprint plus working room).
 */
export function enclosedOutline(runs: Pt[][], metersPerPoint: number, grow = 0): Pt[] | null {
  const pts = runs.flat();
  if (pts.length < 4) return null;
  const pad = (2 + grow) / metersPerPoint;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const res = metersPerPoint / 0.1; // pixels per point: 0.1 m a pixel
  const g: Grid = makeGrid(x0, y0, Math.max(...xs) + pad - x0, Math.max(...ys) + pad - y0, res);
  if (g.w * g.h > 4e6) return null;
  const segs: Segment[] = runs.flatMap((r) => r.slice(1).map((b, i) => ({ x1: r[i][0], y1: r[i][1], x2: b[0], y2: b[1], width: 0, filled: false })));
  drawSegments(g, segs);
  // Close gaps up to about 1.2 m (openings, a missed tag), then take back what closing added.
  const close = 6;
  const grow_ = (d: Uint8Array, r: number) => box(d, g.w, g.h, r, false);
  const shrink = (d: Uint8Array, r: number) => box(d, g.w, g.h, r, true);
  g.data = grow_(g.data, close);
  const outside = floodFill(g, 0, 0).region;
  let inside: Uint8Array = new Uint8Array(outside.length);
  for (let i = 0; i < inside.length; i++) inside[i] = outside[i] ? 0 : 1;
  inside = shrink(inside, close);
  inside = largest(inside, g.w, g.h);
  let count = 0;
  for (const v of inside) count += v;
  if (count * (0.1 * 0.1) < 20) return null; // under 20 m²: no building enclosed
  if (grow > 0) inside = grow_(inside, Math.round(grow / 0.1));
  const ring = toSheet(g, simplify(traceBoundary(inside, g.w, g.h), 1.5));
  return ring.length >= 3 ? ring : null;
}

/** Box filter: grow (any pixel on within r) or shrink (every pixel within r on; past the edge counts as on). */
function box(d: Uint8Array, w: number, h: number, r: number, shrink: boolean): Uint8Array {
  const sum = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += d[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Uint8Array(d.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [ax, bx, ay, by] = [Math.max(0, x - r), Math.min(w, x + r + 1), Math.max(0, y - r), Math.min(h, y + r + 1)];
      const n = sum[by * (w + 1) + bx] - sum[ay * (w + 1) + bx] - sum[by * (w + 1) + ax] + sum[ay * (w + 1) + ax];
      out[y * w + x] = shrink ? (n === (bx - ax) * (by - ay) ? 1 : 0) : n > 0 ? 1 : 0;
    }
  return out;
}

/** The largest 4-connected region of a mask. */
function largest(d: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(d.length);
  const queue = new Int32Array(d.length);
  let best: [number, number] = [0, 0];
  const regions: [number, number][] = [];
  for (let i = 0; i < d.length; i++) {
    if (!d[i] || seen[i]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    seen[i] = 1;
    while (head < tail) {
      const j = queue[head++];
      const x = j % w;
      for (const n of [x > 0 ? j - 1 : -1, x + 1 < w ? j + 1 : -1, j - w, j + w]) {
        if (n < 0 || n >= d.length || !d[n] || seen[n]) continue;
        seen[n] = 1;
        queue[tail++] = n;
      }
    }
    regions.push([i, tail]);
    if (tail > best[1]) best = [i, tail];
  }
  const out = new Uint8Array(d.length);
  if (!best[1]) return out;
  // Flood again from the largest region's seed.
  const q = new Int32Array(d.length);
  let head = 0;
  let tail = 0;
  q[tail++] = best[0];
  out[best[0]] = 1;
  while (head < tail) {
    const j = q[head++];
    const x = j % w;
    for (const n of [x > 0 ? j - 1 : -1, x + 1 < w ? j + 1 : -1, j - w, j + w]) {
      if (n < 0 || n >= d.length || !d[n] || out[n]) continue;
      out[n] = 1;
      q[tail++] = n;
    }
  }
  void h;
  return out;
}

const area = (ring: Pt[]) => Math.abs(ring.reduce((n, p, i) => n + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0)) / 2;

export interface FoundationsResult extends Automation {
  checks: string[];
}

/** Excavation depth taken when the documents don't give one: frost cover plus footing, in metres. */
export const EXCAVATION_DEPTH = 1.5;
/** Working room around the foundation for forming and waterproofing, in metres. */
export const WORKING_ROOM = 1.0;

/**
 * Foundations off the set's foundation plans (structural ones over architectural ones when
 * both are there) and the structural schedules.
 */
export async function automateFoundations(p: Project, access: SetAccess, maxOpening: number): Promise<FoundationsResult> {
  const metric = p.units === 'metric';
  const toProject = (m: number) => (metric ? m : m / 0.3048);
  const live = p.sheets.filter((s) => !s.superseded);
  const checks: string[] = [];

  // The schedules: structural sheets first (a footing schedule is drawn on an S sheet), then the rest.
  const schedules: Schedule[] = [];
  const scheduleBoxes = new Map<string, [number, number, number, number][]>();
  const textsOf = new Map<string, PageText[]>();
  const candidates = live.filter((s) => tradeOfNumber(s.name ?? '') === 'S' || /SCHEDULE|FOUNDATION|FOOTING/i.test(s.title ?? ''));
  for (const s of candidates) {
    await perSheet(access, s, async () => {
      const texts = await access.texts(s);
      textsOf.set(s.id, texts);
      if (!texts.some((t) => /FOOTING|PIER|FOUNDATION\s+WALL/i.test(t.str) && /SCHEDULE/i.test(t.str))) return;
      const read = readSchedules(texts, (await access.segments(s)) ?? []);
      schedules.push(...read);
      scheduleBoxes.set(s.id, read.map((x) => x.box));
    });
  }
  const marks = foundationMarks(schedules, metric);

  // The foundation plans: the structural ones when there are any.
  const plans: Sheet[] = [];
  for (const s of live) {
    if (!s.metersPerPoint) continue;
    const texts = textsOf.get(s.id) ?? (await access.texts(s).catch(() => [] as PageText[]));
    textsOf.set(s.id, texts);
    if (isFoundationPlan(s, texts) && !/DETAIL|SECTION|ENLARG/i.test(s.title ?? '')) plans.push(s);
  }
  const structural = plans.filter((s) => tradeOfNumber(s.name ?? '') === 'S');
  const use = structural.length ? structural : plans;
  if (!use.length) return { message: 'No foundation plan found.', checks };

  const types: TakeoffType[] = [];
  const added: Measurement[] = [];
  const typeFor = new Map<string, TakeoffType>();
  const color = (k: FoundationKind | 'slab' | 'excavation') =>
    ({ pad: '#8d6e63', strip: '#6d4c41', pier: '#a1887f', mass: '#5d4037', wall: '#795548', slab: '#bcaaa4', excavation: '#a0855b' })[k];
  const vol = metric ? 'm³' : 'CY';
  const cy = metric ? '' : ' / 27';
  const make = (key: string, t: Omit<TakeoffType, 'id' | 'items'> & { items: AssemblyItem[] }) => {
    let x = typeFor.get(key);
    if (!x) {
      x = { id: newId(), ...t };
      typeFor.set(key, x);
      types.push(x);
    }
    return x;
  };
  const counted: string[] = [];
  let stripLen = 0;
  let slabArea = 0;
  let excavationArea = 0;

  for (const plan of use) {
    await perSheet(access, plan, async () => {
      const k = plan.metersPerPoint!;
      const texts = tagTexts(textsOf.get(plan.id) ?? [], plan, scheduleBoxes.get(plan.id) ?? []);

      // Pads, piers and mass footings: one each where the plan tags them.
      const placed = markPlaces(
        texts,
        marks.filter((m) => m.kind === 'pad' || m.kind === 'pier' || m.kind === 'mass'),
      );
      for (const [mark, at] of placed) {
        const m = marks.find((x) => x.mark === mark)!;
        const name =
          m.kind === 'pier'
            ? `${m.mark} – Concrete pier ${fmtM(m.width)} x ${fmtM(m.length)}`
            : `${m.mark} – ${m.kind === 'mass' ? 'Mass footing' : 'Pad footing'} ${fmtM(m.width)} x ${fmtM(m.length)} x ${fmtM(m.depth)}`;
        const W = m.width ?? 0;
        const L = m.length ?? W;
        const D = m.depth ?? (m.kind === 'pier' ? 0 : 0);
        const t = make(`count:${mark}`, {
          name,
          color: color(m.kind),
          kind: 'count',
          height: m.kind === 'pier' ? toProject(1.2) : 0,
          width: toProject(W),
          depth: toProject(L),
          thickness: toProject(D),
          division: '03 Concrete',
          package: 'Concrete sub',
          description: `${m.schedule}: ${m.says}${m.kind === 'pier' ? '. Pier height (H) assumed 1.2 m: set it from the sections.' : ''}`,
          items:
            m.kind === 'pier'
              ? [item('Piers', 'ea', 'N'), item('Concrete + 5%', vol, `N * W * D * H${cy} * 1.05`), item('Formwork', metric ? 'm²' : 'SF', 'N * 2 * (W + D) * H')]
              : [item(m.kind === 'mass' ? 'Mass footings' : 'Pad footings', 'ea', 'N'), item('Concrete + 5%', vol, `N * W * D * T${cy} * 1.05`), item('Formwork (edges)', metric ? 'm²' : 'SF', 'N * 2 * (W + D) * T')],
        });
        if (!m.width || (m.kind !== 'pier' && !m.depth) || /PROJECTION|REFER|SEE\b|VARIES/i.test(m.says)) checks.push(`${m.mark}: the ${m.schedule.toLowerCase()} doesn't give its full size (${m.says}). Set W, D and T on the type for its concrete.`);
        for (const pt of at) added.push({ id: newId(), sheetId: plan.id, typeId: t.id, points: [pt], holes: [], source: 'foundations', label: m.mark });
        counted.push(`${at.length} ${m.mark}`);
      }

      // Foundation walls along their tagged runs, and the strip footing tagged beside each run.
      const page = await access.page(plan);
      if (!page) return;
      // Fresh wall types: an architectural FW1 assembly is not the structural FW-1 concrete wall.
      const walls = await automateWalls({ ...p, types: [] }, page, undefined, plan, maxOpening);
      if (!walls.apply) return;
      const after = walls.apply({ ...p, types: [], measurements: [] });
      const runs = after.measurements.filter((m) => m.sheetId === plan.id);
      const wallMarks = new Map(marks.filter((m) => m.kind === 'wall').map((m) => [norm(m.mark), m]));
      const strips = marks.filter((m) => m.kind === 'strip');
      const stripTags = markPlaces(texts, strips);
      const runsByCode = new Map<string, Measurement[]>();
      for (const r of runs) {
        const code = after.types.find((t) => t.id === r.typeId)?.name.split(/\s+[–-]\s+/)[0].trim() ?? '';
        if (!/^FW/i.test(norm(code)) && !wallMarks.has(norm(code))) continue; // only foundation walls
        runsByCode.set(code, [...(runsByCode.get(code) ?? []), r]);
      }
      if (!runsByCode.size) return;
      // Each strip footing tag sits beside the foundation wall tag it goes with (FW-1 | SF-1): paired by nearness.
      const fwTags = texts.filter((t) => /^FW/i.test(norm(t.str)));
      const tagW = Math.max(12, ...fwTags.map((t) => t.w));
      const pairs: { code: string; at: Pt; strip: FoundationMark }[] = [];
      for (const f of fwTags) {
        let best: { strip: FoundationMark; d: number } | null = null;
        for (const s of strips)
          for (const at of stripTags.get(s.mark) ?? []) {
            const d = Math.hypot(at[0] - f.cx, at[1] - f.cy);
            if (d < tagW * 2.5 && (!best || d < best.d)) best = { strip: s, d };
          }
        if (best) pairs.push({ code: norm(f.str), at: [f.cx, f.cy], strip: best.strip });
      }
      const reach = 4 / k; // a tag sits within about 4 m of its wall
      for (const [code, rs] of runsByCode) {
        const sched = wallMarks.get(norm(code));
        const wt = make(`wall:${norm(code)}`, {
          name: `${sched?.mark ?? code} – Foundation wall${sched?.says ? `, ${sched.says.split(' · ')[0]}` : ''}`,
          color: color('wall'),
          kind: 'linear',
          height: toProject(1.2),
          thickness: sched?.width ? toProject(sched.width) : toProject(0.2),
          division: '03 Concrete',
          package: 'Concrete sub',
          description: `${sched ? `${sched.schedule}: ${sched.says}. ` : ''}Wall height (H) assumed 1.2 m: set it from the sections.`,
          items: [item('Wall length', metric ? 'm' : 'ft', 'L'), item('Wall area', metric ? 'm²' : 'SF', 'L * H'), item('Concrete + 5%', vol, `L * H * T${cy} * 1.05`), item('Formwork (both faces)', metric ? 'm²' : 'SF', '2 * L * H')],
        });
        for (const r of rs) {
          added.push({ ...r, id: newId(), typeId: wt.id, source: 'foundations', label: code });
          // The strip footing paired with this wall's own tag nearest the run.
          let best: { mark: FoundationMark; d: number } | null = null;
          for (const pr of pairs) {
            if (pr.code !== norm(code)) continue;
            const d = toRun(pr.at, r.points);
            if (d < reach && (!best || d < best.d)) best = { mark: pr.strip, d };
          }
          const sf = best?.mark ?? null;
          if (!sf) continue;
          const st = make(`strip:${norm(sf.mark)}`, {
            name: `${sf.mark} – Strip footing ${fmtM(sf.width)} x ${fmtM(sf.depth)}`,
            color: color('strip'),
            kind: 'linear',
            height: 0,
            width: toProject(sf.width ?? 0.6),
            depth: toProject(sf.depth ?? 0.3),
            division: '03 Concrete',
            package: 'Concrete sub',
            description: `${sf.schedule}: ${sf.says}. Taken along the foundation wall runs it is tagged beside.`,
            items: [
              item('Footing length', metric ? 'm' : 'ft', 'L'),
              item('Concrete + 5%', vol, `L * W * D${cy} * 1.05`),
              item('Formwork (both sides)', metric ? 'm²' : 'SF', '2 * L * D'),
            ],
          });
          added.push({ ...r, id: newId(), typeId: st.id, source: 'foundations', label: sf.mark });
          let L = 0;
          for (let i = 1; i < r.points.length; i++) L += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]);
          stripLen += L * k;
        }
      }

      // The slab inside the foundation walls, and the excavation around it.
      const outer = [...runsByCode.values()].flat().map((r) => r.points);
      const slab = enclosedOutline(outer, k);
      if (slab) {
        const thick = slabThickness(textsOf.get(plan.id) ?? [], metric);
        const st = make('slab', {
          name: `Slab on grade${thick ? ` ${Math.round(thick * 1000)} thick` : ''}`,
          color: color('slab'),
          kind: 'area',
          height: 0,
          thickness: toProject(thick ?? 0.1),
          division: '03 Concrete',
          package: 'Concrete sub',
          description: `Inside the foundation walls on ${plan.name}.${thick ? '' : ' Thickness (T) assumed 100: set it from the slab note or sections.'}`,
          items: [
            item('Slab area', metric ? 'm²' : 'SF', 'A'),
            item('Concrete + 5%', vol, `A * T${cy} * 1.05`),
            item('Vapour barrier + 15% laps', metric ? 'm²' : 'SF', 'A * 1.15'),
            item('Granular base (200 assumed)', vol, metric ? 'A * 0.2' : 'A * 0.667 / 27'),
          ],
        });
        added.push({ id: newId(), sheetId: plan.id, typeId: st.id, points: slab, holes: [], source: 'foundations', label: 'Slab on grade' });
        slabArea += area(slab) * k * k;
        const dig = enclosedOutline(outer, k, WORKING_ROOM);
        if (dig) {
          const et = make('excavation', {
            name: 'Excavation and backfill (depth assumed)',
            color: color('excavation'),
            kind: 'area',
            height: 0,
            depth: toProject(EXCAVATION_DEPTH),
            division: '31 Earthwork',
            package: 'Excavation sub',
            description: `The foundation footprint on ${plan.name} plus ${WORKING_ROOM} m working room. Depth (D) assumed ${EXCAVATION_DEPTH} m: set it from the geotechnical report and the footing elevations.`,
            items: [item('Excavation area', metric ? 'm²' : 'SF', 'A'), item('Excavation (bank)', vol, `A * D${cy}`), item('Excavation + 25% swell', vol, `A * D${cy} * 1.25`)],
          });
          added.push({ id: newId(), sheetId: plan.id, typeId: et.id, points: dig, holes: [], source: 'foundations', label: 'Excavation' });
          excavationArea += area(dig) * k * k;
        }
      } else checks.push(`${plan.name}: the foundation walls don't enclose an area, so the slab on grade and excavation were not taken off. Fill the slab by hand.`);
    });
  }

  if (!added.length) return { message: `Foundation plans ${use.map((s) => s.name).join(', ')}: no foundation tags found.`, checks };
  checks.push(`Foundations: excavation depth ${EXCAVATION_DEPTH} m and ${WORKING_ROOM} m working room, and wall and pier heights of 1.2 m, are assumed. Set them on the types from the sections and the geotechnical report.`);
  if (structural.length && plans.length > structural.length)
    checks.push(`Foundations are taken off the structural plan (${structural.map((s) => s.name).join(', ')}). ${plans.filter((s) => !structural.includes(s)).map((s) => s.name).join(', ')} also shows them: its wall types price the finishes (insulation, damp-proofing), not the concrete again.`);
  const parts = [
    counted.length ? counted.join(', ') : '',
    stripLen ? `${Math.round(metric ? stripLen : stripLen / 0.3048)} ${metric ? 'm' : 'ft'} of strip footing` : '',
    slabArea ? `${Math.round(metric ? slabArea : slabArea / 0.0929)} ${metric ? 'm²' : 'SF'} slab on grade` : '',
    excavationArea ? `${Math.round(metric ? excavationArea : excavationArea / 0.0929)} ${metric ? 'm²' : 'SF'} excavation` : '',
  ].filter(Boolean);
  return {
    message: `${use.map((s) => s.name).join(', ')}: ${parts.join(' · ')}`,
    checks,
    apply: (q) => replaceRun(q, 'foundations', types, added),
  };
}

/** A slab thickness from the sheet's notes ("100 THICK SLAB ON GRADE", "SLAB ON GRADE … 125 THICK"). */
export function slabThickness(texts: PageText[], metric: boolean): number | null {
  for (const t of texts) {
    const s = t.str.toUpperCase();
    if (!/SLAB/.test(s)) continue;
    const m = /(\d{2,3})\s*(?:MM\s*)?THI?CK/.exec(s) ?? /(\d)["″]\s*(?:THICK|CONC|SLAB)/.exec(s);
    if (!m) continue;
    const v = Number(m[1]);
    return m[0].includes('"') || m[0].includes('″') || (!metric && v < 20) ? v * 0.0254 : v / 1000;
  }
  return null;
}
