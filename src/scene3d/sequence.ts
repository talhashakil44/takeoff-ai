import { meshOf, type Element3D, type Scene3D } from './scene';

/**
 * The 4D sequence of a 3D model: activities on calendar days, and when each element goes up.
 * From the Build It schedule when there is one (generated, imported or the user's own), or else
 * worked out from the model itself in the usual order (site, foundations, structure, envelope,
 * roof, interiors, services, finishes, landscape) with durations from how much there is of each.
 * Days count from `start` (day 0); an element appears when its work starts and is in place when
 * its own part of that work is done.
 */

export type Phase = 'mobilize' | 'earthworks' | 'underground' | 'foundations' | 'structure' | 'roof' | 'envelope' | 'openings' | 'interiors' | 'services' | 'finishes' | 'landscape' | 'closeout';

export interface Activity4D {
  id: string;
  name: string;
  phase: Phase;
  /** First day of the work. */
  s: number;
  /** Day it is done (milestones: the same as s). */
  e: number;
  milestone?: boolean;
  /** Elements it puts up. */
  count: number;
}

export interface Install {
  /** Day it starts going up. */
  s: number;
  /** Day it is in place. */
  e: number;
  act: string;
  /** Taken away again (temporary works): from s, gone by e. */
  gone?: { s: number; e: number };
}

export interface Sequence4D {
  /** ISO date of day 0. */
  start: string;
  /** The last day (completion). */
  days: number;
  activities: Activity4D[];
  /** Each element's days; missing: there from the start (existing work, the ground). */
  install: Map<string, Install>;
  source: 'model' | 'generated' | 'imported' | 'own' | 'plan';
}

const FINISH = new Set(['epoxy', 'vinyl', 'carpet', 'tile', 'sealed_concrete']);

/** The work an element belongs to (null: there before the job, like existing neighbours). */
export function phaseOf(e: Element3D): Phase | null {
  const name = e.name.toLowerCase();
  if (/\bexisting\b/.test(name) && !/\bnew\b/.test(name)) return null;
  switch (e.category) {
    case 'foundation':
      return 'foundations';
    case 'civil':
      return 'underground';
    case 'structure':
    case 'stairs':
      return 'structure';
    case 'floor':
      return FINISH.has(e.material) && !/slab/.test(name) ? 'finishes' : 'structure';
    case 'roof':
      return 'roof';
    case 'envelope':
      return 'envelope';
    case 'glazing':
    case 'doors':
      return 'openings';
    case 'interior':
      return 'interiors';
    case 'mechanical':
    case 'plumbing':
      return 'services';
    case 'electrical':
      return e.material === 'light' ? 'finishes' : 'services';
    case 'ceiling':
    case 'fixtures':
    case 'furniture':
      return 'finishes';
    case 'site':
      return e.material === 'soil' ? 'earthworks' : 'landscape';
    case 'paving':
      return 'landscape';
    case 'context':
      // Neighbours and what is there already stand throughout; new planting, lights and vehicles come last.
      return /\bcontext\b|\bto remain\b|\bindicative\b/.test(name) && !/\bnew\b/.test(name) ? null : 'landscape';
    default:
      return 'finishes';
  }
}

const PHASE_NAME: Record<Phase, string> = {
  mobilize: 'Mobilize and set up the site',
  earthworks: 'Site clearing and earthworks',
  underground: 'Underground services',
  foundations: 'Foundations',
  structure: 'Structure',
  roof: 'Roof structure and roofing',
  envelope: 'Exterior walls and cladding',
  openings: 'Windows, glazing and doors',
  interiors: 'Interior framing and partitions',
  services: 'Mechanical, plumbing and electrical rough-in',
  finishes: 'Ceilings, fixtures and finishes',
  landscape: 'Paving and landscaping',
  closeout: 'Substantial completion',
};
/** Calendar days: a base for the trade plus a little per element it puts up. */
const PACE: Record<Phase, [number, number]> = {
  mobilize: [7, 0],
  earthworks: [21, 0.5],
  underground: [14, 0.5],
  foundations: [21, 0.6],
  structure: [20, 0.5],
  roof: [18, 0.4],
  envelope: [24, 0.35],
  openings: [16, 0.3],
  interiors: [24, 0.35],
  services: [30, 0.3],
  finishes: [30, 0.25],
  landscape: [18, 0.15],
  closeout: [0, 0],
};
const span = (p: Phase, n: number) => Math.round(Math.min(160, PACE[p][0] + PACE[p][1] * n));

/** The lowest point of an element (m), for building up from the bottom. */
const bases = new WeakMap<Element3D, { z: number; x: number }>();
function base(e: Element3D) {
  const hit = bases.get(e);
  if (hit) return hit;
  let z = Infinity, x = Infinity;
  for (const s of e.shapes) {
    try {
      const m = meshOf(s);
      for (let i = 0; i < m.positions.length; i += 3) {
        z = Math.min(z, m.positions[i + 2]);
        x = Math.min(x, m.positions[i]);
      }
    } catch {
      // a shape that can't be drawn doesn't place it
    }
  }
  const b = { z: Number.isFinite(z) ? z : 0, x: Number.isFinite(x) ? x : 0 };
  bases.set(e, b);
  return b;
}

/** Spreads an activity's elements over its days, bottom up and along the building. */
function spread(els: Element3D[], a: Activity4D, out: Map<string, Install>) {
  const n = els.length;
  if (!n) return;
  const len = Math.max(1, a.e - a.s);
  const order = els.map((e) => ({ e, b: base(e) })).sort((p, q) => Math.round(p.b.z * 2) - Math.round(q.b.z * 2) || p.b.x - q.b.x);
  // Each piece takes about a quarter of the activity (at least a day), the last finishing with it.
  const each = Math.max(1, len * (n > 1 ? 0.25 : 1));
  order.forEach(({ e }, i) => {
    const s = a.s + (n > 1 ? ((len - each) * i) / (n - 1) : 0);
    out.set(e.id, { s, e: Math.min(a.e, s + each), act: a.id });
  });
}

/** Level names in height order, from the elements on them. */
function levelOrder(els: Element3D[]) {
  const lo = new Map<string, number[]>();
  for (const e of els) {
    const l = e.level || '';
    const list = lo.get(l) ?? [];
    list.push(base(e).z);
    lo.set(l, list);
  }
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  // A column running all the floors goes up with the first.
  return [...lo.keys()].sort((a, b) => (/^all$/i.test(a) ? -1e9 : med(lo.get(a)!)) - (/^all$/i.test(b) ? -1e9 : med(lo.get(b)!)));
}

/** A sequence from the model alone. */
export function modelSequence(scene: Scene3D, start: string): Sequence4D {
  const by = new Map<Phase, Element3D[]>();
  for (const e of scene.elements) {
    const p = phaseOf(e);
    if (!p) continue;
    by.set(p, [...(by.get(p) ?? []), e]);
  }
  const acts: Activity4D[] = [];
  const install = new Map<string, Install>();
  const add = (phase: Phase, s: number, els: Element3D[], name = PHASE_NAME[phase], id: string = phase) => {
    const a: Activity4D = { id, name, phase, s: Math.round(s), e: Math.round(s) + span(phase, els.length), count: els.length };
    acts.push(a);
    spread(els, a, install);
    return a;
  };
  const has = (p: Phase) => (by.get(p)?.length ?? 0) > 0;
  const mob: Activity4D = { id: 'mobilize', name: PHASE_NAME.mobilize, phase: 'mobilize', s: 0, e: 7, count: 0 };
  acts.push(mob);
  let prev = mob;
  const after = (a: Activity4D, f: number) => a.s + (a.e - a.s) * f;
  const earth = add('earthworks', mob.e, by.get('earthworks') ?? []);
  prev = earth;
  if (has('underground')) add('underground', after(earth, 0.5), by.get('underground')!);
  const found = has('foundations') ? add('foundations', after(earth, 0.75), by.get('foundations')!) : null;
  if (found) prev = found;
  // The frame level by level, each starting when the one below is well along.
  const frame = by.get('structure') ?? [];
  const levels = levelOrder(frame);
  const frames: Activity4D[] = [];
  for (const l of levels) {
    const els = frame.filter((e) => (e.level || '') === l);
    const s = frames.length ? after(frames[frames.length - 1], 0.6) : after(prev, 0.8);
    const multi = levels.length > 1 && !!l;
    const name = !multi ? PHASE_NAME.structure : /^all$/i.test(l) ? 'Structure: main frame' : `Structure: ${l.toLowerCase()}`;
    frames.push(add('structure', s, els, name, `structure:${l || 'all'}`));
  }
  const topFrame = frames.length ? frames[frames.length - 1] : prev;
  const firstFrame = frames[0] ?? prev;
  const roof = has('roof') ? add('roof', after(topFrame, 0.85), by.get('roof')!) : null;
  const env = has('envelope') ? add('envelope', after(firstFrame, 1), by.get('envelope')!) : null;
  const openings = has('openings') ? add('openings', env ? after(env, 0.5) : after(topFrame, 1), by.get('openings')!) : null;
  const dry = roof ?? env ?? topFrame;
  const interiors = has('interiors') ? add('interiors', after(dry, 0.7), by.get('interiors')!) : null;
  const services = has('services') ? add('services', interiors ? after(interiors, 0.3) : after(dry, 0.8), by.get('services')!) : null;
  const inner = services ?? interiors ?? dry;
  const finishes = has('finishes') ? add('finishes', after(inner, 0.6), by.get('finishes')!) : null;
  const last = finishes ?? inner;
  // Landscaping last, finishing a week or so after the inside.
  if (has('landscape')) add('landscape', Math.max(after(last, 0.45), last.e + 7 - span('landscape', by.get('landscape')!.length)), by.get('landscape')!);
  const end = Math.max(...acts.map((a) => a.e));
  const ms = (id: string, name: string, d: number) => acts.push({ id, name, phase: 'closeout', s: Math.round(d), e: Math.round(d), milestone: true, count: 0 });
  ms('ms:start', 'Mobilization', 0);
  if (found) ms('ms:foundations', 'Foundations complete', found.e);
  if (frames.length) ms('ms:topped', 'Structure topped out', topFrame.e);
  if (roof || env) ms('ms:enclosed', 'Building enclosed', Math.max(roof?.e ?? 0, env?.e ?? 0, openings?.e ?? 0));
  ms('ms:complete', 'Substantial completion', end);
  return { start, days: end, activities: sortActs(acts), install, source: 'model' };
}

const sortActs = (a: Activity4D[]) => [...a].sort((x, y) => x.s - y.s || (x.milestone ? 1 : 0) - (y.milestone ? 1 : 0) || x.e - y.e);

/**
 * A sequence on a schedule: its activities (calendar days from `start`) and which one puts up
 * each element. Elements none of them builds keep the model's own order, fitted to the schedule.
 */
export function scheduleSequence(scene: Scene3D, input: { start: string; activities: Activity4D[]; activityOf: (e: Element3D) => string | null; source: Sequence4D['source'] }): Sequence4D {
  const acts = input.activities.map((a) => ({ ...a, count: 0 }));
  const byId = new Map(acts.map((a) => [a.id, a]));
  const groups = new Map<string, Element3D[]>();
  const loose: Element3D[] = [];
  for (const e of scene.elements) {
    if (!phaseOf(e)) continue;
    const id = input.activityOf(e);
    const a = id ? byId.get(id) : undefined;
    if (a && !a.milestone) groups.set(a.id, [...(groups.get(a.id) ?? []), e]);
    else loose.push(e);
  }
  const install = new Map<string, Install>();
  for (const [id, els] of groups) {
    const a = byId.get(id)!;
    a.count = els.length;
    spread(els, a, install);
  }
  const days = Math.max(1, ...acts.map((a) => a.e));
  if (loose.length) {
    // The rest in the model's order, scaled to the schedule's length.
    const own = modelSequence({ ...scene, elements: loose }, input.start);
    const k = days / Math.max(1, own.days);
    for (const e of loose) {
      const t = own.install.get(e.id);
      if (t) install.set(e.id, { s: t.s * k, e: t.e * k, act: t.act });
    }
  }
  return { start: input.start, days, activities: sortActs(acts), install, source: input.source };
}

/**
 * The model's own plan (Scene3D.schedule): each element up during its activity, temporary works
 * taken down during theirs (top down, along the building); elements with no activity are there
 * throughout.
 */
export function planSequence(scene: Scene3D): Sequence4D | null {
  const plan = scene.schedule;
  if (!plan?.activities?.length) return null;
  const known = new Set(['mobilize', 'earthworks', 'underground', 'foundations', 'structure', 'roof', 'envelope', 'openings', 'interiors', 'services', 'finishes', 'landscape', 'closeout']);
  const acts: Activity4D[] = plan.activities.map((a) => ({ id: a.id, name: a.name, phase: (known.has(a.phase) ? a.phase : 'finishes') as Phase, s: a.s, e: a.milestone ? a.s : Math.max(a.s + 0.5, a.e), milestone: a.milestone, count: 0 }));
  const byId = new Map(acts.map((a) => [a.id, a]));
  const groups = new Map<string, Element3D[]>();
  for (const e of scene.elements) {
    const a = e.activity ? byId.get(e.activity) : undefined;
    if (a && !a.milestone) groups.set(a.id, [...(groups.get(a.id) ?? []), e]);
  }
  const install = new Map<string, Install>();
  for (const [id, els] of groups) {
    const a = byId.get(id)!;
    a.count = els.length;
    spread(els, a, install);
  }
  // Taken down: the last up comes down first.
  const downs = new Map<string, Element3D[]>();
  for (const e of scene.elements) if (e.until && byId.has(e.until) && install.has(e.id)) downs.set(e.until, [...(downs.get(e.until) ?? []), e]);
  for (const [id, els] of downs) {
    const a = byId.get(id)!;
    const n = els.length, len = Math.max(1, a.e - a.s), each = Math.max(1, len * (n > 1 ? 0.3 : 1));
    els.forEach((e, i) => {
      const s = a.s + (n > 1 ? ((len - each) * i) / (n - 1) : 0);
      install.get(e.id)!.gone = { s, e: Math.min(a.e, s + each) };
    });
  }
  const days = Math.max(1, ...acts.map((a) => a.e));
  return { start: plan.start, days, activities: sortActs(acts), install, source: 'plan' };
}

/** An element's progress on a day: below 0 not started, 0–1 going up, 1 in place. */
export function progressOn(seq: Sequence4D, e: Element3D, day: number): number {
  const t = seq.install.get(e.id);
  if (!t) return 1;
  if (t.gone && day >= t.gone.e) return -1;
  // Coming down: shrinks back to its base.
  if (t.gone && day >= t.gone.s) return Math.max(0.02, 1 - (day - t.gone.s) / Math.max(0.01, t.gone.e - t.gone.s));
  if (day < t.s) return -1;
  if (day >= t.e) return 1;
  return (day - t.s) / Math.max(0.01, t.e - t.s);
}

/** Calendar helpers: day numbers from an ISO date. */
export const dayDate = (start: string, day: number) => {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.floor(day + 1e-7));
  return d;
};
export const isoDay = (start: string, day: number) => dayDate(start, day).toISOString().slice(0, 10);
export const dayOf = (start: string, iso: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000);

/** The first Monday on or after the first of next month: a plausible start for a model alone. */
export function nextStart(today = new Date()) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1, 12));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
