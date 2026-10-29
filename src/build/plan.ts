import type { SpecSection } from '../spec/parse';
import { TRADES, tradeByKey } from './extract';
import type { Activity, Assumption, Basis, BuildEdits, BuildModel, Dependency, PlanSetup, SourceRef, SpecFact, TradeSetup } from './types';

/**
 * The plan: activities for everything the project needs, not only what has a shape —
 * submittals and their review, procurement, the work level by level, testing, commissioning
 * and closeout — each tied to the elements, quantities and spec sections it covers, with
 * explicit links between them. Durations come from quantities and production rates, from the
 * specification, or from stated assumptions; nothing is shortened to meet a target.
 */

// Production per crew per day (imperial units; metric converted), lead times in working days.
const DEFAULTS: Record<string, { LF: number; SF: number; ea: number; lead: number; crews: number }> = {
  demolition: { LF: 120, SF: 500, ea: 20, lead: 0, crews: 1 },
  structure: { LF: 60, SF: 300, ea: 10, lead: 20, crews: 1 },
  envelope: { LF: 100, SF: 800, ea: 10, lead: 20, crews: 1 },
  'mech-rough': { LF: 90, SF: 400, ea: 10, lead: 25, crews: 1 },
  'elec-rough': { LF: 180, SF: 600, ea: 30, lead: 15, crews: 1 },
  'fire-rough': { LF: 120, SF: 600, ea: 20, lead: 20, crews: 1 },
  'fire-heads': { LF: 150, SF: 600, ea: 30, lead: 20, crews: 1 },
  partitions: { LF: 70, SF: 400, ea: 10, lead: 10, crews: 1 },
  ceilings: { LF: 120, SF: 650, ea: 20, lead: 15, crews: 1 },
  doors: { LF: 60, SF: 300, ea: 6, lead: 40, crews: 1 },
  painting: { LF: 300, SF: 1800, ea: 20, lead: 5, crews: 1 },
  flooring: { LF: 200, SF: 800, ea: 20, lead: 20, crews: 1 },
  finishes: { LF: 120, SF: 600, ea: 15, lead: 15, crews: 1 },
  specialties: { LF: 40, SF: 300, ea: 8, lead: 30, crews: 1 },
  'mech-trim': { LF: 80, SF: 400, ea: 10, lead: 30, crews: 1 },
  'elec-trim': { LF: 150, SF: 600, ea: 25, lead: 30, crews: 1 },
  site: { LF: 150, SF: 1500, ea: 10, lead: 10, crews: 1 },
  other: { LF: 100, SF: 500, ea: 12, lead: 15, crews: 1 },
};

/** What each trade waits for on the same level (the usual order of work: an editable assumption). */
const AFTER: Record<string, string[]> = {
  demolition: [],
  structure: ['demolition'],
  envelope: ['structure'],
  site: [],
  'mech-rough': ['demolition', 'structure'],
  'elec-rough': ['demolition', 'structure'],
  'fire-rough': ['demolition', 'structure'],
  partitions: ['demolition', 'structure'],
  other: ['partitions'],
  ceilings: ['mech-rough', 'elec-rough', 'fire-rough', 'partitions'],
  doors: ['partitions'],
  painting: ['partitions'],
  flooring: ['ceilings', 'painting'],
  finishes: ['painting'],
  specialties: ['painting', 'flooring'],
  'mech-trim': ['ceilings'],
  'elec-trim': ['ceilings'],
  'fire-heads': ['ceilings'],
};

const a = <T>(value: T, basis: Basis, why: string, source?: SourceRef): Assumption<T> => ({ value, basis, why, ...(source ? { source } : {}) });

export function defaultSetup(model: BuildModel, facts: SpecFact[], today: string): PlanSetup {
  const metric = model.units === 'metric';
  const fact = (k: SpecFact['key']) => facts.find((f) => f.key === k);
  const review = fact('reviewDays');
  const reviewDays = review ? (review.unit === 'calendar days' ? Math.ceil(((review.value as number) * 5) / 7) : (review.value as number)) : 10;
  const sub = fact('substantialDate');
  const weeks = fact('durationWeeks');
  const start = nextWorkday(today);
  const target = sub ? a<string | null>(sub.value as string, 'documented', 'Substantial performance date in the specification', sub.source) : weeks ? a<string | null>(addCalendarDays(start, Math.round((weeks.value as number) * 7)), 'documented', `Contract time of ${weeks.value} weeks in the specification`, weeks.source) : a<string | null>(null, 'unknown', 'No completion date found in the documents: set one to check the plan against it');
  const trades: Record<string, Assumption<TradeSetup>> = {};
  for (const t of TRADES) {
    const d = DEFAULTS[t.key] ?? DEFAULTS.other;
    const rates: Record<string, number> = metric ? { m: Math.round(d.LF * 0.3048), 'm²': Math.round(d.SF * 0.0929), ea: d.ea } : { ft: d.LF, SF: d.SF, ea: d.ea };
    trades[t.key] = a({ rates, crews: d.crews, leadDays: d.lead }, 'assumed', 'Typical production and lead time: confirm with the trade');
  }
  return {
    start: a(start, 'assumed', 'Next working day: set the real start'),
    target,
    targetFor: sub ? 'ms:substantial' : 'ms:finish',
    workDays: a([1, 2, 3, 4, 5], 'assumed', 'Monday to Friday'),
    holidays: a<string[]>([], 'assumed', 'No holidays entered'),
    mobilizeDays: a(5, 'assumed', 'Site set-up and mobilization'),
    submittalPrepDays: a(10, 'assumed', 'Preparing shop drawings and product data'),
    reviewDays: review ? a(reviewDays, 'documented', `Review period in ${review.source.label}${review.unit === 'calendar days' ? ` (${review.value} calendar days)` : ''}`, review.source) : a(10, 'assumed', 'No review period found in the specification'),
    resubmitRounds: a(1, 'assumed', 'Plan for one resubmission'),
    resubmitReviewDays: review ? a(reviewDays, 'documented', `Same review period (${review.source.label})`, review.source) : a(10, 'assumed', 'Same as the first review'),
    floorToFloor: a(metric ? 3.6 : 12, 'assumed', 'Typical floor-to-floor height'),
    levelsInParallel: a(false, 'assumed', 'One crew per trade, going level by level'),
    testingDays: a(3, 'assumed', 'Field testing and inspection per trade'),
    commissioningDays: a(10, 'assumed', 'Commissioning of building systems'),
    closeoutDays: a(15, 'assumed', 'Closeout documents, O&M manuals, as-builts'),
    trades,
  };
}

/** The user's edits over the defaults: each becomes the user's own assumption. */
export function applySetupEdits(setup: PlanSetup, edits?: BuildEdits): PlanSetup {
  const out: PlanSetup = { ...setup, trades: { ...setup.trades } };
  const e = edits?.setup ?? {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'trades' || v === undefined) continue;
    const cur = (out as unknown as Record<string, Assumption<unknown>>)[k];
    if (cur) (out as unknown as Record<string, Assumption<unknown>>)[k] = { value: v, basis: 'assumed', why: cur.basis === 'documented' ? `Set by you (the documents say ${JSON.stringify(cur.value)})` : 'Set by you' };
  }
  for (const [t, v] of Object.entries(e.trades ?? {})) {
    const cur = out.trades[t];
    if (cur) out.trades[t] = { value: { ...cur.value, ...v, rates: { ...cur.value.rates, ...(v.rates ?? {}) } }, basis: 'assumed', why: 'Set by you' };
  }
  return out;
}

const SUBMIT = /SUBMITTAL|SHOP DRAWING|PRODUCT DATA|SAMPLES/i;
const TESTS = /FIELD QUALITY CONTROL|TEST|INSPECTION/i;

export function planActivities(model: BuildModel, setup: PlanSetup, sections: SpecSection[], facts: SpecFact[], edits?: BuildEdits): Activity[] {
  const acts: Activity[] = [];
  const add = (x: Activity) => (acts.push(x), x);
  const secByKey = new Map(sections.map((s) => [s.key, s]));
  const specRef = (s: SpecSection, page?: number): SourceRef => ({ kind: 'spec', id: s.docId, page: page ?? s.pages[0] ?? 1, label: s.number, section: s.key });
  const dep = (from: string, why: string, basis: Basis = 'assumed', lag = 0, type: 'FS' | 'SS' = 'FS'): Dependency => ({ from, type, lag, basis, why });
  const days = (x: Assumption) => Math.max(0, Math.round(x.value));

  add({ id: 'ms:start', name: 'Start of construction', kind: 'milestone', trade: null, level: null, elements: [], duration: 0, durationBasis: setup.start.basis, durationWhy: setup.start.why, deps: [], specs: [], sources: [] });
  add({ id: 'mobilize', name: 'Mobilization and site set-up', kind: 'mobilize', trade: null, level: null, elements: [], duration: days(setup.mobilizeDays), durationBasis: setup.mobilizeDays.basis, durationWhy: setup.mobilizeDays.why, deps: [dep('ms:start', 'After the start')], specs: [], sources: [] });

  // The work, by trade and level.
  const levelOrder = [...model.levels.map((l) => l.id), null];
  const byTL = new Map<string, typeof model.elements>();
  for (const e of model.elements) {
    const k = `${e.trade}|${e.level ?? ''}`;
    byTL.set(k, [...(byTL.get(k) ?? []), e]);
  }
  const workId = (t: string, l: string | null) => `work:${t}:${l ?? 'unplaced'}`;
  const tradesUsed = TRADES.filter((t) => model.elements.some((e) => e.trade === t.key));
  const levelName = (l: string | null) => (l ? model.levels.find((x) => x.id === l)?.name ?? l : 'Unplaced (level not known)');
  for (const t of tradesUsed) {
    const setupT = setup.trades[t.key]?.value ?? { rates: {}, crews: 1, leadDays: 0 };
    const specKeys = [...new Set(model.elements.filter((e) => e.trade === t.key).flatMap((e) => e.specs.map((s) => s.key)))];
    const specs = specKeys.map((k) => secByKey.get(k)).filter((s): s is SpecSection => !!s);
    // Submittals: what the trade's spec sections ask for, reviewed, maybe resubmitted, then ordered and delivered.
    const asked = specs.filter((s) => s.articles.some((x) => SUBMIT.test(x.title)));
    const notIssued = specs.filter((s) => s.missing);
    const askedSrc = asked.map((s) => specRef(s, s.articles.find((x) => SUBMIT.test(x.title))?.page));
    const subBasis: Basis = asked.length ? 'documented' : 'assumed';
    let before = 'mobilize';
    // Demolition has no products to submit or order.
    if (t.key !== 'demolition' && (setupT.leadDays > 0 || asked.length)) {
      const prep = add({ id: `sub:prep:${t.key}`, name: `Submittals — ${t.name}`, kind: 'submittal', trade: t.key, level: null, elements: [], duration: days(setup.submittalPrepDays), durationBasis: setup.submittalPrepDays.basis, durationWhy: `${setup.submittalPrepDays.why}${asked.length ? ` · required by ${asked.map((s) => s.number).join(', ')}` : notIssued.length ? ` · its sections (${notIssued.map((s) => s.number).join(', ')}) are not issued: the requirement is assumed` : ' · no spec section linked: the requirement is assumed'}`, deps: [dep('ms:start', 'Shop drawings start at award', subBasis)], specs: asked.map((s) => s.key), sources: askedSrc });
      const rev = add({ id: `sub:review:${t.key}`, name: `Consultant review — ${t.name}`, kind: 'review', trade: t.key, level: null, elements: [], duration: days(setup.reviewDays), durationBasis: setup.reviewDays.basis, durationWhy: setup.reviewDays.why, deps: [dep(prep.id, 'Reviewed once submitted', 'documented')], specs: prep.specs, sources: setup.reviewDays.source ? [setup.reviewDays.source] : [] });
      let approved = rev.id;
      if (setup.resubmitRounds.value > 0) {
        const r = add({
          id: `sub:resubmit:${t.key}`,
          name: `Resubmission and re-review — ${t.name}`,
          kind: 'resubmittal',
          trade: t.key,
          level: null,
          elements: [],
          duration: Math.round(setup.resubmitRounds.value) * (Math.ceil(days(setup.submittalPrepDays) / 2) + days(setup.resubmitReviewDays)),
          durationBasis: 'assumed',
          durationWhy: `${setup.resubmitRounds.value} round(s): half the preparation time plus ${days(setup.resubmitReviewDays)} days review (${setup.resubmitReviewDays.basis})`,
          deps: [dep(rev.id, 'After comments are returned')],
          specs: prep.specs,
          sources: [],
        });
        approved = r.id;
      }
      before = approved;
      if (setupT.leadDays > 0) {
        const proc = add({ id: `proc:${t.key}`, name: `Fabrication and delivery — ${t.name}`, kind: 'procurement', trade: t.key, level: null, elements: [], duration: setupT.leadDays, durationBasis: setup.trades[t.key]?.basis ?? 'assumed', durationWhy: `Lead time ${setupT.leadDays} working days after approval (${setup.trades[t.key]?.why ?? 'assumed'})`, deps: [dep(approved, 'Ordered once approved', 'documented')], specs: [], sources: [] });
        before = proc.id;
      }
    }
    // Work on each level.
    let prevLevel: string | null = null;
    for (const l of levelOrder) {
      const els = byTL.get(`${t.key}|${l ?? ''}`);
      if (!els?.length) continue;
      const quantities: Record<string, number> = {};
      for (const e of els) quantities[e.unit] = (quantities[e.unit] ?? 0) + e.quantity;
      const crews = Math.max(1, setupT.crews);
      let crewDays = 0;
      const missing: string[] = [];
      for (const [u, q] of Object.entries(quantities)) {
        const r = setupT.rates[u];
        if (r && r > 0) crewDays += q / r;
        else if (q > 0) missing.push(u);
      }
      const duration = Math.max(1, Math.ceil(crewDays / crews));
      const qty = Object.entries(quantities).map(([u, q]) => `${Math.round(q).toLocaleString()} ${u}`).join(' + ');
      const deps: Dependency[] = [dep(before, before === 'mobilize' ? 'After mobilization' : 'Material approved and on site', before === 'mobilize' ? 'assumed' : 'documented')];
      if (before !== 'mobilize') deps.push(dep('mobilize', 'Site set up first'));
      if (prevLevel && !setup.levelsInParallel.value) deps.push(dep(workId(t.key, prevLevel), `Same crew, level after level (${setup.levelsInParallel.why})`));
      add({
        id: workId(t.key, l),
        name: `${t.name} — ${levelName(l)}`,
        kind: 'work',
        trade: t.key,
        level: l,
        elements: els.map((e) => e.id),
        quantities,
        rates: setupT.rates,
        crews,
        duration,
        durationBasis: 'inferred',
        durationWhy: `${qty} at ${Object.entries(setupT.rates)
          .filter(([u]) => quantities[u])
          .map(([u, r]) => `${r} ${u}`)
          .join(' / ')} per crew-day, ${crews} crew${crews === 1 ? '' : 's'}${missing.length ? ` · no rate for ${missing.join(', ')}` : ''}`,
        deps,
        specs: specKeys,
        sources: [],
      });
      prevLevel = l;
    }
  }
  // The usual order of trades on a level: a trade waits for the ones before it (skipping trades with no work there).
  const has = new Set(acts.map((x) => x.id));
  const waitsFor = (t: string, l: string | null, seen = new Set<string>()): string[] =>
    (AFTER[t] ?? []).flatMap((p) => {
      if (seen.has(p)) return [];
      seen.add(p);
      return has.has(workId(p, l)) ? [workId(p, l)] : waitsFor(p, l, seen);
    });
  for (const x of acts.filter((x) => x.kind === 'work')) {
    for (const p of waitsFor(x.trade!, x.level)) if (!x.deps.some((d) => d.from === p)) x.deps.push(dep(p, `${tradeByKey.get(p.split(':')[1])?.name ?? p} first on this level (usual order of work)`));
  }

  // Testing and inspection where a trade's sections call for it.
  const lastWork = (t: string) => {
    const ws = acts.filter((x) => x.kind === 'work' && x.trade === t);
    return ws[ws.length - 1];
  };
  const tests: string[] = [];
  for (const t of tradesUsed) {
    const lw = lastWork(t.key);
    if (!lw || t.key === 'demolition') continue;
    const secs = lw.specs.map((k) => secByKey.get(k)).filter((s): s is SpecSection => !!s && s.articles.some((x) => TESTS.test(x.title)));
    if (!secs.length) continue;
    const ws = acts.filter((x) => x.kind === 'work' && x.trade === t.key);
    tests.push(
      add({
        id: `test:${t.key}`,
        name: `Testing and inspection — ${t.name}`,
        kind: 'testing',
        trade: t.key,
        level: null,
        elements: [],
        duration: days(setup.testingDays),
        durationBasis: setup.testingDays.basis,
        durationWhy: `${setup.testingDays.why} · required by ${secs.map((s) => s.number).join(', ')}`,
        deps: ws.map((w) => dep(w.id, 'Tested once installed', 'documented')),
        specs: secs.map((s) => s.key),
        sources: secs.map((s) => specRef(s, s.articles.find((x) => TESTS.test(x.title))?.page)),
      }).id,
    );
  }
  // Commissioning of the building systems.
  const cxFact = facts.find((f) => f.key === 'commissioningRequired');
  const cx: string[] = [];
  for (const [key, name, trades] of [
    ['mech', 'Commissioning — mechanical systems', ['mech-rough', 'mech-trim']],
    ['elec', 'Commissioning — electrical systems', ['elec-rough', 'elec-trim']],
    ['fire', 'Verification — fire protection systems', ['fire-rough', 'fire-heads']],
  ] as const) {
    const ws = acts.filter((x) => x.kind === 'work' && trades.includes(x.trade as never));
    if (!ws.length) continue;
    const ts = trades.map((t) => `test:${t}`).filter((id) => has.has(id) || tests.includes(id));
    cx.push(
      add({
        id: `cx:${key}`,
        name,
        kind: 'commissioning',
        trade: trades[trades.length - 1],
        level: null,
        elements: [],
        duration: days(setup.commissioningDays),
        durationBasis: setup.commissioningDays.basis,
        durationWhy: `${setup.commissioningDays.why}${cxFact ? ` · required by ${cxFact.source.label}` : ' · no commissioning section found: assumed'}`,
        deps: [...ws.map((w) => dep(w.id, 'Systems installed')), ...ts.map((id) => dep(id, 'Tested'))],
        specs: cxFact?.source.section ? [cxFact.source.section] : [],
        sources: cxFact ? [cxFact.source] : [],
      }).id,
    );
  }
  // Substantial performance, closeout, the end.
  const works = acts.filter((x) => x.kind === 'work').map((x) => x.id);
  const sp = add({ id: 'ms:substantial', name: 'Substantial performance', kind: 'milestone', trade: null, level: null, elements: [], duration: 0, durationBasis: 'inferred', durationWhy: 'When all work, testing and commissioning are done', deps: [...works, ...tests, ...cx].map((id) => dep(id, 'Work complete')), specs: [], sources: setup.target.basis === 'documented' && setup.targetFor === 'ms:substantial' && setup.target.source ? [setup.target.source] : [] });
  const closeSec = sections.find((s) => /^01/.test(s.key) && /CLOSE-?OUT|PROJECT RECORD|OPERATION AND MAINTENANCE/i.test(s.title));
  const close = add({ id: 'closeout', name: 'Closeout: deficiencies, O&M manuals, as-builts, warranties', kind: 'closeout', trade: null, level: null, elements: [], duration: days(setup.closeoutDays), durationBasis: setup.closeoutDays.basis, durationWhy: `${setup.closeoutDays.why}${closeSec ? ` · required by ${closeSec.number}` : ''}`, deps: [dep(sp.id, 'After substantial performance')], specs: closeSec ? [closeSec.key] : [], sources: closeSec ? [specRef(closeSec)] : [] });
  add({ id: 'ms:finish', name: 'Project complete', kind: 'milestone', trade: null, level: null, elements: [], duration: 0, durationBasis: 'inferred', durationWhy: 'After closeout', deps: [dep(close.id, 'Closeout done')], specs: [], sources: [] });

  // The user's edits: durations, crews, links.
  const byId = new Map(acts.map((x) => [x.id, x]));
  for (const [id, ed] of Object.entries(edits?.activities ?? {})) {
    const x = byId.get(id);
    if (!x) continue;
    if (ed.crews && x.kind === 'work' && x.quantities && x.rates) {
      let crewDays = 0;
      for (const [u, q] of Object.entries(x.quantities)) if (x.rates[u]) crewDays += q / x.rates[u];
      x.crews = ed.crews;
      x.duration = Math.max(1, Math.ceil(crewDays / ed.crews));
      x.durationWhy = x.durationWhy.replace(/\d+ crews?/, `${ed.crews} crew${ed.crews === 1 ? '' : 's'} (set by you)`);
      x.edited = true;
    }
    if (ed.duration !== undefined) {
      x.duration = Math.max(0, Math.round(ed.duration));
      x.durationBasis = 'assumed';
      x.durationWhy = `${x.duration} working days, set by you (was: ${x.durationWhy})`;
      x.edited = true;
    }
    if (ed.dropDeps?.length) {
      x.deps = x.deps.filter((d) => !ed.dropDeps!.includes(d.from));
      x.edited = true;
    }
    for (const d of ed.addDeps ?? []) {
      if (byId.has(d.from) && !x.deps.some((y) => y.from === d.from)) x.deps.push(dep(d.from, 'Added by you', 'assumed', d.lag ?? 0));
      x.edited = true;
    }
  }
  return acts;
}

// Dates (ISO, local calendar days).
export function addCalendarDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
export function nextWorkday(iso: string): string {
  let d = iso;
  for (let i = 0; i < 7; i++) {
    const w = new Date(`${d}T12:00:00`).getDay();
    if (w >= 1 && w <= 5) return d;
    d = addCalendarDays(d, 1);
  }
  return d;
}
