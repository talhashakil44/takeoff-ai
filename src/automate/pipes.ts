import { inkRuns, type InkRun } from '../fill/inkRuns';
import { joinRuns } from '../fill/runs';
import type { Segment } from '../fill/vectors';
import { newId, type Measurement, type Project, type Pt, type Sheet, type TakeoffType } from '../model';
import type { PageText } from '../pageText';
import { tradeOfNumber } from '../sheetKind';
import { titleBlockBox } from '../titleBlock';
import { replaceRun, type Automation } from './result';
import { tradeGroups } from './runs';
import { pause, perSheet, type SetAccess } from './set';

/**
 * Piping on plumbing and mechanical plans drawn without CAD layers, by the engineer's pipe labels.
 *
 * Pipes are drawn in heavy line, so the sheet is drawn and its heavy straight runs read off it
 * (fill/inkRuns: this also finds pipes on sets that paste the trade drawing in as a picture).
 * Each pipe label ("75Ø DCW", "2\"ø HWS") is followed along its leader to the pipe its arrow
 * touches, and the label's size and service carry along the connected piping to the nearest
 * other label. Heavy linework no label reaches (borders, boxes, a pipe nobody labelled) is not
 * taken off; nor is anything drawn on every trade plan of the drawing (the sheet frame, the
 * architect's walls under the trades). Risers, drops and diagonal runs are not measured.
 */

/** Piping services by the abbreviations engineers label them with. */
export const SERVICES: Record<string, { name: string; division: string }> = {
  DCW: { name: 'domestic cold water', division: '22 Plumbing' },
  CW: { name: 'domestic cold water', division: '22 Plumbing' },
  DHW: { name: 'domestic hot water', division: '22 Plumbing' },
  HW: { name: 'domestic hot water', division: '22 Plumbing' },
  DHWR: { name: 'domestic hot water recirculation', division: '22 Plumbing' },
  DHWC: { name: 'domestic hot water recirculation', division: '22 Plumbing' },
  HWC: { name: 'domestic hot water recirculation', division: '22 Plumbing' },
  'H&C': { name: 'hot and cold water', division: '22 Plumbing' },
  NPW: { name: 'non-potable water', division: '22 Plumbing' },
  SAN: { name: 'sanitary', division: '22 Plumbing' },
  SS: { name: 'sanitary', division: '22 Plumbing' },
  V: { name: 'vent', division: '22 Plumbing' },
  VENT: { name: 'vent', division: '22 Plumbing' },
  VTR: { name: 'vent', division: '22 Plumbing' },
  STM: { name: 'storm', division: '22 Plumbing' },
  ST: { name: 'storm', division: '22 Plumbing' },
  RWL: { name: 'rainwater leader', division: '22 Plumbing' },
  SD: { name: 'storm drain', division: '22 Plumbing' },
  FM: { name: 'forcemain', division: '22 Plumbing' },
  CD: { name: 'condensate drain', division: '22 Plumbing' },
  COND: { name: 'condensate drain', division: '22 Plumbing' },
  G: { name: 'gas', division: '22 Plumbing' },
  GAS: { name: 'gas', division: '22 Plumbing' },
  NG: { name: 'natural gas', division: '22 Plumbing' },
  P: { name: 'propane', division: '22 Plumbing' },
  LPG: { name: 'propane', division: '22 Plumbing' },
  HGS: { name: 'heating glycol supply', division: '23 HVAC' },
  HGR: { name: 'heating glycol return', division: '23 HVAC' },
  HWS: { name: 'heating water supply', division: '23 HVAC' },
  HWR: { name: 'heating water return', division: '23 HVAC' },
  HS: { name: 'heating supply', division: '23 HVAC' },
  HR: { name: 'heating return', division: '23 HVAC' },
  CHS: { name: 'chilled water supply', division: '23 HVAC' },
  CHR: { name: 'chilled water return', division: '23 HVAC' },
  CWS: { name: 'condenser water supply', division: '23 HVAC' },
  CWR: { name: 'condenser water return', division: '23 HVAC' },
  GS: { name: 'glycol supply', division: '23 HVAC' },
  GR: { name: 'glycol return', division: '23 HVAC' },
  RL: { name: 'refrigerant liquid', division: '23 HVAC' },
  RS: { name: 'refrigerant suction', division: '23 HVAC' },
  SPR: { name: 'sprinkler', division: '21 Fire Suppression' },
  FP: { name: 'fire protection', division: '21 Fire Suppression' },
  FS: { name: 'fire standpipe', division: '21 Fire Suppression' },
};

export interface PipeTag {
  /** Nominal size in millimetres. */
  size: number;
  /** The size as labelled ("75", "1-1/2\""). */
  says: string;
  code: string;
  existing: boolean;
}

const inches = (s: string) => {
  const m = /^(\d+)?(?:[-\s]?(\d+)\/(\d+))?$/.exec(s.trim());
  if (!m || (!m[1] && !m[2])) return NaN;
  return (m[1] ? Number(m[1]) : 0) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
};

/** A pipe label: "75Ø DCW", "50mmØ SAN", "1-1/2\"ø HWS", "Ex. 4\"ø STM", "New 3\"ø RWL from RD". */
export function pipeTag(text: string): PipeTag | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const lead = /^(NEW|EX\.?|EXIST(?:ING)?\.?)\s+/i.exec(t);
  const existing = !!lead && /^EX/i.test(lead[1]);
  const body = lead ? t.slice(lead[0].length) : t;
  const metric = /^(\d{2,3})\s*(?:mm)?\s*[Øø⌀]\s*(.*)$/i.exec(body);
  const imperial = metric ? null : /^(\d+(?:[-\s]\d\/\d)?|\d\/\d)\s*(?:"|″|''|IN\.?)\s*[Øø⌀]?\s*(.*)$/i.exec(body);
  const m = metric ?? imperial;
  if (!m) return null;
  const size = metric ? Number(m[1]) : Math.round(inches(m[1]) * 25.4);
  if (!(size >= 10 && size <= 600)) return null;
  // The service: the first word that is a known abbreviation ("INCOMING DCW LINE" → DCW).
  const words = m[2].toUpperCase().split(/[\s,.;:()]+/).filter(Boolean).slice(0, 4);
  const code = words.find((w) => SERVICES[w]);
  if (!code) return null;
  return { size, says: metric ? m[1] : `${m[1]}"`, code, existing };
}

const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Distance from a point to a run's centreline. */
export function toRun(p: Pt, r: { a: Pt; b: Pt }): number {
  const [ax, ay] = r.a;
  const dx = r.b[0] - ax;
  const dy = r.b[1] - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2));
  return Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy);
}

/** Thin dark lines: the leaders (and the rest of the fine linework). */
const isLeader = (s: Segment, maxWidth: number) => {
  if (s.filled || s.width >= maxWidth || Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 0.3) return false;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s.color ?? '#000000');
  if (!m) return true;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return 0.3 * r + 0.59 * g + 0.11 * b < 90;
};

/**
 * Where a label's leader ends: its fine lines followed from the label's end to the far end of the
 * leader, the arrow's tip. Null when no leader starts at the label.
 */
export function leaderTip(t: PageText, leaders: Segment[], maxSteps = 14): Pt | null {
  const half = [t.w / 2, t.h / 2];
  const box = [t.cx - half[0], t.cy - half[1], t.cx + half[0], t.cy + half[1]];
  const fromBox = (p: Pt) => Math.hypot(Math.max(box[0] - p[0], 0, p[0] - box[2]), Math.max(box[1] - p[1], 0, p[1] - box[3]));
  // The leader starts at the label: the end of a fine line nearest the label, within a letter.
  let start: { s: Segment; end: Pt; other: Pt } | null = null;
  let best = Math.max(t.h, 3);
  for (const s of leaders) {
    for (const [end, other] of [
      [[s.x1, s.y1], [s.x2, s.y2]],
      [[s.x2, s.y2], [s.x1, s.y1]],
    ] as [Pt, Pt][]) {
      const d = fromBox(end);
      // A line along the label's text (an underline) or away from it, not one crossing it.
      if (d < best && fromBox(other) > d) {
        best = d;
        start = { s, end, other };
      }
    }
  }
  if (!start) return null;
  // Followed end to end: at each joint, on along the line that continues from it. The arrowhead's
  // strokes turn back from the tip, so the walk stops where the next line goes back.
  const seen = new Set<Segment>([start.s]);
  let from = start.end;
  let at = start.other;
  for (let k = 0; k < maxSteps; k++) {
    const dir: Pt = [at[0] - from[0], at[1] - from[1]];
    let next: { s: Segment; other: Pt } | null = null;
    let gap = 1.2;
    for (const s of leaders) {
      if (seen.has(s)) continue;
      const a: Pt = [s.x1, s.y1];
      const b: Pt = [s.x2, s.y2];
      const da = near(a, at);
      const db = near(b, at);
      if (Math.min(da, db) >= gap) continue;
      const other = da <= db ? b : a;
      if (dir[0] * (other[0] - at[0]) + dir[1] * (other[1] - at[1]) < 0) continue;
      gap = Math.min(da, db);
      next = { s, other };
    }
    if (!next) break;
    seen.add(next.s);
    from = at;
    at = next.other;
  }
  return fromBox(at) > Math.max(t.h * 1.5, 6) ? at : null;
}

/** Runs drawn on every trade plan of a drawing (the frame, the walls under the trades): left out. */
export function background(runs: InkRun[], others: InkRun[][], tol = 1.5): boolean[] {
  return runs.map((r) => {
    const horizontal = Math.abs(r.b[1] - r.a[1]) < Math.abs(r.b[0] - r.a[0]);
    const lo = horizontal ? r.a[0] : r.a[1];
    const hi = horizontal ? r.b[0] : r.b[1];
    const at = horizontal ? r.a[1] : r.a[0];
    return others.some((list) =>
      list.some((o) => {
        const oh = Math.abs(o.b[1] - o.a[1]) < Math.abs(o.b[0] - o.a[0]);
        if (oh !== horizontal || Math.abs((horizontal ? o.a[1] : o.a[0]) - at) > tol) return false;
        const olo = horizontal ? o.a[0] : o.a[1];
        const ohi = horizontal ? o.b[0] : o.b[1];
        return Math.min(hi, ohi) - Math.max(lo, olo) >= 0.7 * (hi - lo);
      }),
    );
  });
}

/**
 * Which label each run takes: the labels' runs (where their leaders end) to start, then along the
 * connected piping, each run from the label nearest it along the pipe. -1 for runs no label reaches.
 */
export function spreadLabels(runs: InkRun[], seeds: Map<number, number>, bridge: number): number[] {
  const n = runs.length;
  const seeded = new Set(seeds.keys());
  // Two kinds of joint: end to end (a bend, a fitting in the run), along which a label goes on
  // first, and a run's end on another's side (a branch at a tee).
  const ends: number[][] = runs.map(() => []);
  const all: number[][] = runs.map(() => []);
  const horiz = runs.map((r) => Math.abs(r.b[1] - r.a[1]) < Math.abs(r.b[0] - r.a[0]));
  const len = (i: number) => near(runs[i].a, runs[i].b);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = runs[i];
      const b = runs[j];
      const tol = (a.width + b.width) / 2 + 1;
      // End to end: an end of each within a pipe's width of the other's end, or in line across a
      // short gap (a valve, a label laid over the pipe).
      const endGap = Math.min(near(a.a, b.b), near(a.b, b.a), near(a.a, b.a), near(a.b, b.b));
      const aEnd = [a.a, a.b].filter((p) => toRun(p, b) <= tol);
      const bEnd = [b.a, b.b].filter((p) => toRun(p, a) <= tol);
      let endToEnd = endGap <= tol + Math.max(a.width, b.width);
      if (!endToEnd && horiz[i] === horiz[j]) {
        const off = horiz[i] ? Math.abs(a.a[1] - b.a[1]) : Math.abs(a.a[0] - b.a[0]);
        endToEnd = off <= 1.2 && endGap <= bridge;
      }
      // A bend: an end of each on the other near its end.
      if (!endToEnd && aEnd.length && bEnd.length) endToEnd = true;
      if (endToEnd) {
        ends[i].push(j);
        ends[j].push(i);
      }
      if (endToEnd || aEnd.length || bEnd.length) {
        all[i].push(j);
        all[j].push(i);
      }
    }
  const label = new Array(n).fill(-1);
  // Outlines round hatched areas (an in-slab heating zone, work by others): hatched on one side
  // only. A pipe drawn across a hatched area is hatched on both sides; one in the open on neither.
  const out = runs.map((r) => {
    const [p, q] = r.hatch ?? [0, 0];
    return Math.max(p, q) >= 0.045 && Math.min(p, q) <= 0.45 * Math.max(p, q);
  });
  for (const i of seeded) out[i] = false;
  const walk = (adj: number[][]) => {
    const dist = runs.map((_, i) => (label[i] >= 0 ? 0 : Infinity));
    const done = new Array(n).fill(false);
    const queue = runs.map((_, i) => i).filter((i) => label[i] >= 0);
    // Dijkstra over the run graph (small: a sheet's runs), cost = the length walked.
    for (;;) {
      let i = -1;
      for (const q of queue) if (!done[q] && (i < 0 || dist[q] < dist[i])) i = q;
      if (i < 0) break;
      done[i] = true;
      for (const j of adj[i]) {
        if (out[j]) continue;
        const d = dist[i] + len(j);
        if (d < dist[j]) {
          dist[j] = d;
          label[j] = label[i];
          queue.push(j);
        }
      }
    }
  };
  for (const [r, l] of seeds) label[r] = l;
  // Along each labelled pipe through its bends and fittings, then into the branches left over.
  walk(ends);
  walk(all);
  return label;
}

export interface PipesResult extends Automation {
  checks: string[];
}

/** Plumbing, mechanical and fire protection plans at a plan scale. */
function isPipePlan(s: Sheet): boolean {
  if (s.superseded || !s.metersPerPoint || s.metersPerPoint < 0.008) return false;
  const trade = tradeOfNumber(s.name ?? '');
  if (!trade || !/^(M|MD|MH|MP|P|PD|PL|FP|F)$/.test(trade)) return false;
  return !/\b(DETAILS?|SCHEDULES?|DIAGRAMS?|RISER|SECTIONS?|ELEVATIONS?|LEGEND|NOTES|ASSEMBLY)\b/i.test(s.title ?? '') || /\bPLANS?\b/i.test(s.title ?? '');
}

export async function automatePipes(p: Project, access: SetAccess): Promise<PipesResult> {
  const metric = p.units === 'metric';
  const checks: string[] = [];
  const plans = p.sheets.filter(isPipePlan);
  if (!plans.length) return { message: 'No plumbing or mechanical plans with a scale.', checks };

  // The sheets to read: those without CAD layers (layered ones are read by their layers) and
  // with pipe labels on them; their sibling plans are drawn too, to tell the background.
  const textsOf = new Map<string, PageText[]>();
  const labelled: Sheet[] = [];
  for (const s of plans) {
    const texts = await access.texts(s);
    textsOf.set(s.id, texts);
    // A plan whose trade linework is on named CAD layers is measured from them (automateRuns).
    const layers = (await access.layers?.(s)) ?? new Map<string, string>();
    if (layers.size && tradeGroups((await access.segments(s)) ?? [], layers, null).length) continue;
    if (texts.filter((t) => pipeTag(t.str)).length >= 3) labelled.push(s);
  }
  if (!labelled.length) return { message: 'No pipe labels on the plumbing and mechanical plans without layers.', checks };

  const runsOf = new Map<string, InkRun[]>();
  const read = async (s: Sheet) => {
    if (runsOf.has(s.id)) return runsOf.get(s.id)!;
    const page = await access.page(s);
    const texts = textsOf.get(s.id) ?? (await access.texts(s));
    const tb = titleBlockBox(texts, s.width, s.height);
    const runs = page ? ((await inkRuns(page as never, { minLength: 8, maxWidth: 4.5, dashGap: 3.5, hollow: [1.2, 6], skip: tb ? [tb] : [] })) ?? []) : [];
    runsOf.set(s.id, runs);
    return runs;
  };

  const fresh: TakeoffType[] = [];
  const added: Measurement[] = [];
  const totals = new Map<string, number>();
  let unlabelled = 0;
  let existing = 0;
  for (const [i, s] of labelled.entries()) {
    access.progress?.(`Piping… ${s.name} (${i + 1} of ${labelled.length})`);
    await pause();
    await perSheet(access, s, async () => {
      const mine = await read(s);
      if (!mine.length) return;
      const siblings = plans.filter((o) => o.id !== s.id && o.docId === s.docId && Math.abs(o.width - s.width) < 1 && Math.abs(o.height - s.height) < 1);
      const others: InkRun[][] = [];
      for (const o of siblings) others.push(await read(o));
      const bg = background(mine, others);
      const runs = mine.filter((_, k) => !bg[k]);
      const texts = textsOf.get(s.id)!;
      const leaders = ((await access.segments(s)) ?? []).filter((g) => isLeader(g, 1));
      const tags: { t: PageText; tag: PipeTag }[] = [];
      for (const t of texts) {
        const tag = pipeTag(t.str);
        if (tag) tags.push({ t, tag });
      }
      // Each label's run: where its leader's arrow lands, or (no leader) the run it is written beside.
      const seeds = new Map<number, number>();
      const seedDist = new Map<number, number>();
      tags.forEach(({ t }, k) => {
        const tip = leaderTip(t, leaders);
        const at: Pt = tip ?? [t.cx, t.cy];
        const reach = tip ? 4 : Math.max(t.h * 1.6, 6);
        let best = -1;
        let bd = Infinity;
        runs.forEach((r, j) => {
          const d = toRun(at, r) - r.width / 2;
          if (d < bd) {
            bd = d;
            best = j;
          }
        });
        if (best < 0 || bd > reach) return;
        if (!seeds.has(best) || bd < seedDist.get(best)!) {
          seeds.set(best, k);
          seedDist.set(best, bd);
        }
      });
      const label = spreadLabels(runs, seeds, 12);
      const mpp = s.metersPerPoint!;
      const groups = new Map<number, Pt[][]>();
      runs.forEach((r, j) => {
        if (label[j] < 0) {
          unlabelled += near(r.a, r.b) * mpp;
          return;
        }
        const k = tags.findIndex((x) => x.tag.code === tags[label[j]].tag.code && x.tag.size === tags[label[j]].tag.size && x.tag.existing === tags[label[j]].tag.existing);
        (groups.get(k) ?? groups.set(k, []).get(k)!).push([r.a, r.b]);
      });
      for (const [k, list] of groups) {
        const tag = tags[k].tag;
        const lines = joinRuns(list, 12, 1.2);
        const length = lines.reduce((n, l) => n + l.slice(1).reduce((m, q, x) => m + near(l[x], q), 0), 0) * mpp;
        if (tag.existing) {
          existing += length;
          continue;
        }
        const svc = SERVICES[tag.code];
        const size = metric ? `${tag.size} mm` : tag.says.endsWith('"') ? tag.says : `${tag.says}"`;
        const name = `Pipe ${size} ${tag.code} (${svc.name})`;
        let t = p.types.find((x) => x.name === name) ?? fresh.find((x) => x.name === name);
        if (!t) {
          t = {
            id: newId(),
            name,
            color: svc.division.startsWith('23') ? '#e65100' : svc.division.startsWith('21') ? '#c62828' : /SAN|V|VENT|STM|ST|RWL|SD|FM|CD/.test(tag.code) ? '#6d4c41' : '#0277bd',
            kind: 'linear',
            height: 0,
            division: svc.division,
            package: svc.division.startsWith('21') ? 'Sprinkler sub' : svc.division.startsWith('23') ? 'Mechanical sub' : 'Plumbing sub',
            description: `${tags[k].t.str.trim()}: measured along the piping its label points to on the plans, to the next label. Risers, drops and fittings are not in the length.`,
            items: [{ id: newId(), name: `Pipe ${size} ${tag.code}`, unit: metric ? 'm' : 'ft', formula: 'L' }],
          };
          fresh.push(t);
        }
        for (const l of lines) added.push({ id: newId(), sheetId: s.id, typeId: t.id, points: l, holes: [], source: 'pipes', label: `${tag.says}Ø ${tag.code}` });
        totals.set(name, (totals.get(name) ?? 0) + length);
      }
    });
  }
  if (!added.length) return { message: 'The pipe labels on the plans did not lead to piping that could be read.', checks };
  checks.push('Piping on the plans without CAD layers is measured from its labels: each label\'s size and service carried along the connected piping to the next label. Check the lengths against the plans; risers, drops, diagonal runs and fittings are not in them.');
  if (unlabelled > 5) checks.push(`${Math.round(metric ? unlabelled : unlabelled / 0.3048)} ${metric ? 'm' : 'ft'} of heavy line on the piping plans has no pipe label leading to it and was not taken off (borders and boxes, or pipe without a label). Measure any piping in it by hand.`);
  if (existing) checks.push(`${Math.round(metric ? existing : existing / 0.3048)} ${metric ? 'm' : 'ft'} of piping labelled existing (EX.) was left out.`);
  const top = [...totals].sort((a, b) => b[1] - a[1]);
  return {
    message: `${Math.round(top.reduce((n, [, v]) => n + v, 0) / (metric ? 1 : 0.3048))} ${metric ? 'm' : 'ft'} of piping by label: ${top
      .slice(0, 6)
      .map(([n, v]) => `${Math.round(metric ? v : v / 0.3048)} ${n.replace(/^Pipe /, '').replace(/ \(.*\)$/, '')}`)
      .join(', ')}${top.length > 6 ? ` and ${top.length - 6} more` : ''}`,
    checks,
    apply: (q) => replaceRun(q, 'pipes', fresh, added),
  };
}
