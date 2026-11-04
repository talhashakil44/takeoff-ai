import { Calendar, schedule } from './cpm';
import { levelWords, TRADES, tradeByKey, tradeOf } from './extract';
import type { ImportResult } from './scheduleImport';
import type { Activity, ActivityKind, BuildElement, BuildModel, Dependency, Issue, Level, PlanSetup, Schedule, ScheduleEdits, UserActivity, UserLink, UserSchedule } from './types';
import type { TakeoffType } from '../model';

/**
 * A schedule the user brought (imported) or built by hand, played on the model. Each activity
 * builds the model elements linked to it: matched by its trade, level and words when it's
 * imported, or picked on the model. Its dates come from the same critical path method as the
 * generated plan, on the project's working days; an imported start is kept as "not earlier than",
 * so the file's dates hold unless its own links push work later.
 */

/** Activities in the user's schedules have ids like these; the plan's own never do. */
export const isUserActivity = (id: string) => id.startsWith('imp:') || id.startsWith('own:');
/** The start and finish markers added around a user schedule (not shown as rows). */
const START = 'ms:start';
const FINISH = 'ms:finish';

// ---------- What an activity is: its kind, trade and level, from its words ----------

/** Words that say an activity is not building anything (paper, waiting, handover). */
const KINDS: [ActivityKind, RegExp][] = [
  ['commissioning', /commission/],
  ['closeout', /close-?out|deficienc|\bo ?& ?m\b|as-?builts?|hand-?over|turnover|occupancy|warranty|punch ?list|substantial (completion|performance)/],
  ['testing', /\btest(ing|s)?\b|inspections?\b|balancing|\btab\b|flush(ing)?\b/],
  ['submittal', /submittals?|shop drawings?|product data|\bsamples?\b|mock-?up approval/],
  ['review', /\breview\b|approvals?\b|\bpermits?\b/],
  ['procurement', /procure|fabricat|deliver(y|ies)?\b|\border\b|lead time|purchas/],
  ['mobilize', /mobili[sz]|site set-?up|hoarding|site trailers?|temporary facilities/],
];

export function kindOf(name: string, duration: number, milestone?: boolean): ActivityKind {
  if (milestone || duration === 0) return 'milestone';
  const t = name.toLowerCase();
  return KINDS.find(([, re]) => re.test(t))?.[0] ?? 'work';
}

/** Trade words, most specific first: the first that fits wins. */
const TRADE_WORDS: [string, RegExp][] = [
  ['demolition', /\bdemo(lition|lish)?\b|\bremov(e|al)\b|abatement|strip[- ]?out|dismantl/],
  ['fire-heads', /sprinkler heads?|fire alarm|fire devices?|smoke detectors?/],
  ['fire-rough', /sprinkler|fire protection|standpipe|fire pump/],
  ['mech-trim', /plumbing fixtures?|mechanical (trim|fixtures?|equipment)|diffusers?|grilles?|\brtus?\b|roof ?top units?|hvac (equipment|units?)|water closets?|lavator|\bsinks?\b|unit heaters?|make-?up air/],
  ['elec-trim', /light(ing)? fixtures?|\blighting\b|luminaires?|electrical (trim|devices?|fixtures?)|\bdevices?\b|receptacles?|\bswitches\b/],
  ['mech-rough', /\bhvac\b|duct(work|s)?\b|plumbing|mechanical|piping|sanitary|storm drain|\bdrains?\b|gas (line|piping)|ventilation/],
  ['elec-rough', /electrical|conduits?|wiring|\bwires?\b|cabl(e|es|ing)\b|panel ?boards?|electrical panels?|switchgear|transformers?|\bpower\b/],
  ['ceilings', /ceilings?|t-?bar|\bact\b|acoustic|bulkheads?/],
  ['painting', /paint|coatings?|primer|\bstain(ing)?\b/],
  ['finishes', /wall tile|\bfrp\b/],
  ['flooring', /floor(ing)? finish|flooring|carpet|\bvct\b|\blvt\b|vinyl|epoxy|resilient|terrazzo|floor tile|sealed concrete|polish(ed)? concrete/],
  ['partitions', /drywall|gypsum|\bstuds?\b|partitions?\b|taping|mudding|furring|demising|interior walls?/],
  ['doors', /\bdoors?\b|\bframes?\b|hollow metal|hardware|windows?\b|glazing|storefront|curtain ?wall|louv(re|er)s?/],
  ['site', /excavat|earth ?works?|grading|backfill|site ?work|\bsite\b|paving|asphalt|landscap|sewer|water ?main|\bcurbs?\b|sidewalks?|\bsod\b|topsoil|\bcivil\b|underground|utilit/],
  ['envelope', /\broofing\b|roof (covering|membrane)/],
  ['structure', /footings?|foundations?|joists?|\bdeck(ing)?\b|\bsteel\b|\bbeams?\b|columns?|rebar|reinforc|formwork|precast|grade beams?|\bpiles?\b|\bpiers?\b|\bslabs?\b|concrete/],
  ['envelope', /\broof(ing|s)?\b|cladding|siding|metal panels?|air barrier|vapou?r barrier|eaves|flashing|soffit|exterior walls?|envelope|veneer|stucco|\beifs\b|waterproof|sheathing|insulated (metal )?panels?/],
  ['structure', /\bpour\b|\bforms?\b|structural|masonry|\bblock(work)?\b|\bcmu\b|erect/],
  ['specialties', /millwork|casework|cabinet|counters?|toilet (partitions?|accessories)|accessories|signage|lockers?|specialt|equipment|furniture|blinds/],
  ['flooring', /\btile\b/],
  ['partitions', /framing|\bwalls?\b|\bboard(ing)?\b/],
  ['finishes', /finish(es)?\b|\bbase\b/],
];

/** The trade an activity belongs to, from its name (then its group's words, a CSI section number, or a trade column). */
export function tradeOfText(name: string, group?: string, tradeText?: string): string | null {
  const byWords = (t: string) => {
    const s = t.toLowerCase();
    if (!s.trim()) return null;
    const exact = TRADES.find((x) => x.key === s.trim() || x.name.toLowerCase() === s.trim());
    if (exact) return exact.key;
    return TRADE_WORDS.find(([, re]) => re.test(s))?.[0] ?? null;
  };
  const fromColumn = tradeText ? byWords(tradeText) : null;
  if (fromColumn) return fromColumn;
  const fromName = byWords(name);
  if (fromName) return fromName;
  // A CSI number ("09 21 16 Gypsum board", "Div 26"): the same rule as the takeoff's divisions.
  const div = /\b(?:div(?:ision)?\.?\s*)(\d{1,2})\b|\b(\d{2})\s?\d{2}\s?\d{2}(?:\.\d+)?\b/i.exec(`${tradeText ?? ''} ${name} ${group ?? ''}`);
  const d = div ? Number(div[1] ?? div[2]) : 0;
  if (d >= 2 && d <= 33) return tradeOf({ id: '', name, color: '', kind: 'area', items: [], division: String(d).padStart(2, '0') } as unknown as TakeoffType);
  return group ? byWords(`${group} ${name}`) : null;
}

/** The model level an activity is on, from words like "Level 2", "L2", "2nd floor", "Mezzanine", "Roof", "Footings". */
export function levelOfText(text: string, levels: Level[]): string | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;
  const byId = levels.find((l) => l.id.toLowerCase() === t);
  if (byId) return byId.id;
  for (const l of levels) {
    const n = l.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (n && new RegExp(`\\b${n}\\b`).test(t)) return l.id;
  }
  const w = levelWords(text);
  if (!w.word && /\bfootings?\b|\bfoundations?\b/i.test(text)) w.word = 'foundation';
  const find = (re: RegExp, id: string) => levels.find((l) => l.id === id || re.test(l.name))?.id ?? null;
  if (w.word === 'roof') return find(/roof/i, 'roof');
  if (w.word === 'foundation') return find(/foundation/i, 'fdn');
  if (w.word === 'mezzanine') return find(/mezz/i, 'mezz');
  const short = /\bl(\d{1,2})\b/i.exec(text);
  const num = w.num ?? (short ? Number(short[1]) : undefined);
  if (num !== undefined) return levels.find((l) => l.id === `L${num}` || new RegExp(`\\blevel\\s*${num}\\b`, 'i').test(l.name))?.id ?? null;
  const floors = levels.filter((l) => l.id !== 'fdn' && l.id !== 'roof' && l.id !== 'mezz').sort((a, b) => a.elevation - b.elevation);
  if (w.word === 'main') return levels.find((l) => l.id === 'L1')?.id ?? floors[0]?.id ?? null;
  if (w.word === 'lower') return levels.find((l) => l.id === 'L0')?.id ?? null;
  return null;
}

const STOP = new Set(['and', 'the', 'for', 'with', 'from', 'install', 'installation', 'supply', 'complete', 'level', 'floor', 'area', 'zone', 'phase', 'work', 'works', 'new', 'all', 'main', 'rough', 'trim', 'finish', 'start', 'final', 'of', 'to', 'in', 'on', 'at']);
/** An activity's telling words, singular ("doors" finds "door"); short trade abbreviations (HM, ACT) count. */
const words = (s: string) =>
  [...new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w) && !/^l\d+$/.test(w)).map((w) => (w.length > 3 ? w.replace(/(?<!s)s$/, '') : w)))];

/** Elements an activity builds: its trade's on its level (or every level), narrowed to those its words name when some do. */
export function matchElements(a: Pick<UserActivity, 'name' | 'trade' | 'level' | 'kind'>, model: BuildModel): string[] {
  if (a.kind !== 'work' || !a.trade) return [];
  let pool = model.elements.filter((e) => e.trade === a.trade && e.status !== 'existing' && (!a.level || e.level === a.level));
  // Narrowed to the elements its words name; when some name two or more of them, to the best named.
  const w = words(a.name);
  const score = new Map(pool.map((e) => {
    const text = ` ${`${e.name} ${e.typeName}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
    return [e.id, w.filter((x) => (x.length < 4 ? text.includes(` ${x} `) : text.includes(x))).length];
  }));
  const best = Math.max(0, ...score.values());
  if (best > 0) pool = pool.filter((e) => score.get(e.id)! >= (best >= 2 ? best : 1));
  return pool.map((e) => e.id);
}

/** Trade, level and elements for an activity, from its words. Only fills what it isn't already given. */
export function classify(a: UserActivity, model: BuildModel, hints: { trade?: string; level?: string } = {}): UserActivity {
  const kind = a.kind;
  const trade = a.trade ?? (kind === 'work' || kind === 'submittal' || kind === 'procurement' || kind === 'review' || kind === 'testing' ? tradeOfText(a.name, a.group, hints.trade) : null);
  const level = a.level ?? levelOfText(hints.level ?? '', model.levels) ?? levelOfText(a.name, model.levels) ?? (a.group ? levelOfText(a.group, model.levels) : null);
  const next = { ...a, trade, level };
  if (!a.elements.length) {
    const elements = matchElements(next, model);
    if (elements.length) return { ...next, elements, linked: 'matched' };
  }
  return next;
}

/** Working days from a start to a finish, both included (0 for a finish before the start). */
const workingDays = (cal: Calendar, start: string, finish: string) => (finish < start ? 0 : cal.workingDaysTo(finish));

/** An imported file as the user's schedule: each task with a duration, kind, trade, level and its elements. */
export function fromImport(result: ImportResult, fileName: string, model: BuildModel, setup: PlanSetup): UserSchedule {
  const used = new Set<string>();
  const idOf = new Map<string, string>();
  for (const t of result.tasks) {
    let id = `imp:${t.code}`;
    for (let n = 2; used.has(id); n++) id = `imp:${t.code}#${n}`;
    used.add(id);
    idOf.set(t.key, id);
  }
  const known = new Set(model.elements.map((e) => e.id));
  const activities = result.tasks.map((t): UserActivity => {
    const cal = t.start ? new Calendar(t.start, setup.workDays.value, setup.holidays.value) : null;
    const span = t.start && t.finish && cal ? workingDays(cal, t.start, t.finish) : undefined;
    const duration = Math.max(0, Math.round(t.duration ?? span ?? (t.milestone ? 0 : 1)));
    const elements = (t.elements ?? []).filter((id) => known.has(id));
    const a: UserActivity = {
      id: idOf.get(t.key)!,
      code: t.code,
      name: t.name,
      ...(t.group ? { group: t.group } : {}),
      kind: kindOf(t.name, duration, t.milestone),
      trade: null,
      level: null,
      duration,
      ...(t.start ? { start: t.start } : {}),
      ...(t.finish ? { finish: t.finish } : {}),
      preds: t.preds.filter((p) => idOf.has(p.key) && idOf.get(p.key) !== idOf.get(t.key)).map((p) => ({ from: idOf.get(p.key)!, type: p.type, lag: Math.round(p.lag) })),
      elements,
      ...(elements.length ? { linked: 'picked' as const } : {}),
    };
    return classify(a, model, { trade: t.trade, level: t.level });
  });
  return { name: fileName, format: result.format, importedAt: new Date().toISOString(), activities };
}

/** The generated plan as a schedule of the user's own, to change by hand. */
export function fromGenerated(acts: Activity[]): UserSchedule {
  const id = (x: string) => `own:${x}`;
  const kept = acts.filter((a) => a.id !== START && a.id !== FINISH);
  const ids = new Set(kept.map((a) => a.id));
  return {
    name: 'My schedule',
    format: 'own',
    activities: kept.map((a, i) => ({
      id: id(a.id),
      code: String(i + 1),
      name: a.name,
      kind: a.kind,
      trade: a.trade,
      level: a.level,
      duration: a.duration,
      preds: a.deps.filter((d) => ids.has(d.from)).map((d) => ({ from: id(d.from), type: d.type, lag: d.lag })),
      elements: [...a.elements],
      ...(a.elements.length ? { linked: 'matched' as const } : {}),
    })),
  };
}

/** A new activity for the user's own schedule. */
export function newActivity(s: UserSchedule | undefined, fields: Partial<UserActivity> = {}): UserActivity {
  const taken = new Set((s?.activities ?? []).map((a) => a.id));
  const codes = (s?.activities ?? []).map((a) => Number(a.code)).filter(Number.isFinite);
  let n = Math.max(0, ...codes) + 1;
  while (taken.has(`own:${n}`)) n++;
  return { id: `own:${n}`, code: String(n), name: 'New activity', kind: 'work', trade: null, level: null, duration: 5, preds: [], elements: [], ...fields };
}

// ---------- Its dates ----------

/** The first working day on or after a date, as a working-day index. */
const dayIndex = (cal: Calendar, iso: string) => {
  let i = 0;
  while (cal.date(i) < iso) i++;
  return i;
};

/**
 * The user's schedule through the critical path method. Finish-to-finish and start-to-finish
 * links become start-to-start ones with the lag that gives the same finish; a start date is
 * a "not earlier than" link from the project's start.
 */
export function scheduleUser(us: UserSchedule, base: PlanSetup): { schedule: Schedule; setup: PlanSetup } {
  const starts = us.activities.map((a) => a.start).filter((x): x is string => !!x).sort();
  const imported = us.format !== 'own';
  const setup: PlanSetup = {
    ...base,
    start: imported && starts.length ? { value: starts[0], basis: 'assumed', why: `The earliest start in ${us.name}` } : base.start,
    targetFor: 'ms:finish',
  };
  const cal = new Calendar(setup.start.value, setup.workDays.value, setup.holidays.value);
  const byId = new Map(us.activities.map((a) => [a.id, a]));
  const why = imported ? `From ${us.name}` : 'Set by you';
  const acts: Activity[] = [{ id: START, name: 'Start', kind: 'milestone', trade: null, level: null, elements: [], duration: 0, durationBasis: setup.start.basis, durationWhy: setup.start.why, deps: [], specs: [], sources: [] }];
  const link = (a: UserActivity, l: UserLink): Dependency | null => {
    const p = byId.get(l.from);
    if (!p) return null;
    const lag = l.type === 'FF' ? p.duration + l.lag - a.duration : l.type === 'SF' ? l.lag - a.duration : l.lag;
    return { from: l.from, type: l.type === 'FS' ? 'FS' : 'SS', lag, basis: 'assumed', why: `${l.type}${l.lag ? ` ${l.lag > 0 ? '+' : ''}${l.lag}d` : ''} · ${why}` };
  };
  for (const a of us.activities) {
    const deps = a.preds.map((l) => link(a, l)).filter((d): d is Dependency => !!d);
    if (a.start) deps.push({ from: START, type: 'SS', lag: dayIndex(cal, a.start), basis: 'assumed', why: `Not earlier than ${a.start}` });
    acts.push({ id: a.id, name: a.name, kind: a.kind, trade: a.trade, level: a.level, elements: a.elements, duration: Math.max(0, Math.round(a.duration)), durationBasis: 'assumed', durationWhy: why, deps, specs: [], sources: [], edited: !imported || undefined });
  }
  // The finish waits for everything nothing else waits for.
  const waited = new Set(us.activities.flatMap((a) => a.preds.map((p) => p.from)));
  acts.push({ id: FINISH, name: 'Finish', kind: 'milestone', trade: null, level: null, elements: [], duration: 0, durationBasis: 'assumed', durationWhy: 'The last activity’s finish', deps: us.activities.filter((a) => !waited.has(a.id)).map((a) => ({ from: a.id, type: 'FS', lag: 0, basis: 'assumed', why: 'The schedule ends when this does' })), specs: [], sources: [] });
  const out = schedule(acts, setup);
  out.issues.push(...scheduleIssues(us));
  return { schedule: out, setup };
}

/** What the user should know: activities not on the model, links to activities that aren't there. */
export function scheduleIssues(us: UserSchedule): Issue[] {
  const issues: Issue[] = [];
  const unlinked = us.activities.filter((a) => a.kind === 'work' && !a.elements.length);
  if (unlinked.length)
    issues.push({
      id: 'user-schedule-unlinked',
      severity: 'warning',
      text: `${unlinked.length} of ${us.activities.filter((a) => a.kind === 'work').length} work activities in ${us.name} aren’t linked to anything in the model${unlinked.some((a) => a.trade) ? ' (those with a trade still play on the AI model by trade and level)' : ''}. Select elements on the model and link them: ${unlinked.slice(0, 6).map((a) => a.name).join('; ')}${unlinked.length > 6 ? '; …' : ''}.`,
      refs: unlinked.map((a) => a.id),
    });
  const ids = new Set(us.activities.map((a) => a.id));
  const broken = us.activities.filter((a) => a.preds.some((p) => !ids.has(p.from)));
  if (broken.length) issues.push({ id: 'user-schedule-broken-links', severity: 'warning', text: `${broken.length} activities wait for activities that were deleted; those links are ignored.`, refs: broken.map((a) => a.id) });
  return issues;
}

// ---------- On the model ----------

export interface Span {
  es: number;
  ef: number;
}

/**
 * When each element goes up: the activities it is linked to (all of them, first start to last
 * finish). Walls read from the plans and the building's slabs and roof, which no one links,
 * go up with their trade's work on their level (or anywhere). A measured element nothing is
 * linked to has no time: the schedule doesn't build it.
 */
export function elementTimes(acts: Activity[], times: Record<string, Span>) {
  const byElement = new Map<string, Span>();
  const byTrade = new Map<string, Span>();
  const add = (m: Map<string, Span>, k: string, t: Span) => {
    const o = m.get(k);
    m.set(k, o ? { es: Math.min(o.es, t.es), ef: Math.max(o.ef, t.ef) } : { es: t.es, ef: t.ef });
  };
  for (const a of acts) {
    const t = times[a.id];
    if (!t || !isUserActivity(a.id)) continue;
    for (const id of a.elements) add(byElement, id, t);
    if (a.kind !== 'work' || !a.trade) continue;
    add(byTrade, a.trade, t);
    if (a.level) add(byTrade, `${a.trade}|${a.level}`, t);
  }
  return (e: Pick<BuildElement, 'id' | 'trade' | 'level' | 'name' | 'shape' | 'origin'>): Span | undefined => {
    const own = byElement.get(e.id);
    if (own || (e.origin !== 'drawing' && e.origin !== 'building')) return own;
    const roof = /roof/i.test(e.name) && e.shape?.type === 'surface';
    const trades = roof ? ['envelope'] : e.shape?.type === 'surface' && e.trade !== 'flooring' && e.trade !== 'ceilings' ? [e.trade, 'structure'] : [e.trade, 'partitions', 'envelope', 'structure'];
    for (const t of trades) {
      const s = byTrade.get(`${t}|${e.level}`);
      if (s) return s;
    }
    return byTrade.get(e.trade);
  };
}

/** Gantt rows for a user schedule: by its groups (summary tasks, WBS, phases) in the file's order. */
export function scheduleGroups(us: UserSchedule, acts: Activity[]): { title: string; items: Activity[] }[] {
  const byId = new Map(acts.map((a) => [a.id, a]));
  const grouped = us.activities.some((a) => a.group);
  const out = new Map<string, Activity[]>();
  for (const a of us.activities) {
    const x = byId.get(a.id);
    if (!x) continue;
    const title = grouped ? a.group || 'Other activities' : us.format === 'own' ? 'My schedule' : us.name;
    out.set(title, [...(out.get(title) ?? []), x]);
  }
  return [...out].map(([title, items]) => ({ title, items }));
}

// ---------- Saving it out ----------

const LINK = (l: UserLink, codeOf: Map<string, string>) => `${codeOf.get(l.from) ?? l.from}${l.type !== 'FS' || l.lag ? l.type : ''}${l.lag ? `${l.lag > 0 ? '+' : ''}${l.lag}d` : ''}`;

/** The schedule as CSV that MS Project, P6 (via its spreadsheet import) and this app read back, links and model elements included. */
export function scheduleCsv(us: UserSchedule, times: Record<string, { start: string; finish: string }>, levels: Level[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const codeOf = new Map(us.activities.map((a) => [a.id, a.code]));
  const rows = [['ID', 'Name', 'Duration', 'Start', 'Finish', 'Predecessors', 'Trade', 'Level', 'WBS Name', 'Milestone', 'Elements'].map(esc).join(',')];
  for (const a of us.activities) {
    const t = times[a.id];
    rows.push(
      [a.code, a.name, `${a.duration} days`, t?.start ?? a.start ?? '', t?.finish ?? '', a.preds.map((l) => LINK(l, codeOf)).join(', '), a.trade ? tradeByKey.get(a.trade)?.name ?? a.trade : '', a.level ? levels.find((l) => l.id === a.level)?.name ?? a.level : '', a.group ?? '', a.kind === 'milestone' ? 'Yes' : 'No', a.elements.join(' ')]
        .map(esc)
        .join(','),
    );
  }
  return rows.join('\r\n');
}

/** Which schedule the model follows, when it's the user's (null: the generated plan). */
export function activeUserSchedule(s: ScheduleEdits | undefined): UserSchedule | null {
  if (!s) return null;
  if (s.use === 'imported') return s.imported ?? null;
  if (s.use === 'own') return s.own ?? null;
  return null;
}
