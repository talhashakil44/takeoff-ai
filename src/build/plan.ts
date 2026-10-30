import type { SpecSection } from '../spec/parse';
import { TRADES, tradeByKey } from './extract';
import { activeAllowances } from './scope';
import type { Activity, Assumption, Basis, BuildEdits, BuildModel, Dependency, PlanSetup, ScopeAllowance, SourceRef, SpecFact, TradeSetup } from './types';

/**
 * The plan: activities for measured work, including items that cannot be placed in 3D,
 * with linked submittals, procurement, testing and closeout. Missing trades and phase zones
 * are review issues; a floor outline alone does not authorize work or a vendor lead time.
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
  site: { LF: 150, SF: 1500, ea: 10, lead: 0, crews: 1 },
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
  const startFact = fact('startDate');
  const start = startFact ? String(startFact.value) : nextWorkday(today);
  const target = sub ? a<string | null>(sub.value as string, 'documented', 'Substantial performance date in the specification', sub.source) : weeks ? a<string | null>(addCalendarDays(start, Math.round((weeks.value as number) * 7)), 'documented', `Contract time of ${weeks.value} weeks in the specification`, weeks.source) : a<string | null>(null, 'unknown', 'No completion date found in the documents: set one to check the plan against it');
  const trades: Record<string, Assumption<TradeSetup>> = {};
  for (const t of TRADES) {
    const d = DEFAULTS[t.key] ?? DEFAULTS.other;
    const rates: Record<string, number> = metric ? { m: Math.round(d.LF * 0.3048), 'm²': Math.round(d.SF * 0.0929), ea: d.ea } : { ft: d.LF, SF: d.SF, ea: d.ea };
    if (t.key === 'structure') rates[metric ? 'm³' : 'CY'] = metric ? 8 : 10;
    if (t.key === 'site') rates[metric ? 'm³' : 'CY'] = metric ? 50 : 65;
    trades[t.key] = a({ rates, crews: d.crews, leadDays: d.lead }, 'assumed', t.key === 'structure'
      ? 'Planning allowances: 10 members or 8 m³ of foundation concrete per metric crew-day (10 CY imperial); confirm member complexity, forming, reinforcement and crew size with the trade'
      : t.key === 'elec-rough'
        ? 'Assumed 30 tagged electrical points per crew-day for rough-in, with 15 working days lead time; confirm device complexity, circuits, containment and crew size with the trade'
        : 'Typical production and lead time: confirm with the trade');
  }
  return {
    start: startFact ? a(start, 'documented', 'Contract start in the specification', startFact.source) : a(start, 'assumed', 'Next working day: set the real start'),
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
    dryInBeforeFinishes: a(true, 'assumed', 'Interior finishes start after an assumed weather-tight milestone; confirm enclosure and timing on site'),
    testingDays: a(3, 'assumed', 'Field testing and inspection per trade'),
    commissioningDays: a(10, 'assumed', 'Commissioning of building systems'),
    closeoutDays: a(15, 'assumed', 'Closeout documents, O&M manuals, as-builts'),
    trades,
    allowances: a<Record<string, ScopeAllowance>>({}, 'unknown', 'No unmeasured scope allowances entered'),
  };
}

/** The user's edits over the defaults: each becomes the user's own assumption. */
export function applySetupEdits(setup: PlanSetup, edits?: BuildEdits): PlanSetup {
  const out: PlanSetup = { ...setup, trades: { ...setup.trades } };
  const e = edits?.setup ?? {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'trades' || v === undefined) continue;
    if (k === 'targetFor') { out.targetFor = v as PlanSetup['targetFor']; continue; }
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
  for (const e of model.elements.filter(e => e.origin !== 'building' && e.status !== 'existing')) {
    const k = `${e.trade}|${e.level ?? ''}`;
    byTL.set(k, [...(byTL.get(k) ?? []), e]);
  }
  // Device tags are measured finish points. They also provide a count proxy for
  // rough-in when no rough-in takeoff exists on that level. A saved user allowance
  // takes precedence, so old GFA allowances and these counts never stack.
  const taggedRough = activeAllowances(setup).some(([key]) => key === 'elec-rough') ? [] : model.elements.filter((e) =>
    e.origin === 'takeoff' && e.status !== 'existing' && e.measurementSource === 'etags' &&
    e.trade === 'elec-trim' && e.unit === 'ea' && Number.isFinite(e.quantity) && e.quantity > 0);
  const workId = (t: string, l: string | null) => `work:${t}:${l ?? (t === 'site' ? 'site' : 'unplaced')}`;
  const tradesUsed = TRADES.filter((t) => model.elements.some((e) => e.trade === t.key) || (t.key === 'elec-rough' && taggedRough.length > 0));
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
      const all = byTL.get(`${t.key}|${l ?? ''}`) ?? [];
      const proxyTags = t.key === 'elec-rough' && !all.length ? taggedRough.filter((e) => e.level === l) : [];
      const groups = t.key === 'site' && l === null ? [
        { id: 'work:site:earthwork', name: 'Site work — Excavation', els: all.filter((e) => /^\s*31\b/.test(e.division)) },
        { id: workId(t.key, l), name: t.name, els: all.filter((e) => !/^\s*31\b/.test(e.division)) },
      ] : [{ id: workId(t.key, l), name: `${t.name} — ${levelName(l)}`, els: all }];
      for (const { id, name, els } of groups) {
        const tags = t.key === 'elec-rough' && !els.length ? proxyTags : [];
        if (!els.length && !tags.length) continue;
        const workElements = tags.length ? tags : els;
        const quantities: Record<string, number> = {};
        for (const e of workElements) {
          const q = e.production ?? e;
          quantities[q.unit] = (quantities[q.unit] ?? 0) + q.quantity;
        }
        const crews = Math.max(1, setupT.crews);
        const rates = id === 'work:site:earthwork'
          ? Object.fromEntries(Object.entries(setupT.rates).filter(([unit]) => unit === 'm³' || unit === 'CY'))
          : setupT.rates;
        let crewDays = 0;
        const missing: string[] = [];
        for (const [u, q] of Object.entries(quantities)) {
          const r = rates[u];
          if (r && r > 0) crewDays += q / r;
          else if (q > 0) missing.push(u);
        }
        const duration = Math.max(1, Math.ceil(crewDays / crews));
        const qty = Object.entries(quantities).map(([u, q]) => `${Math.round(q).toLocaleString()} ${u}`).join(' + ');
        const earthwork = id === 'work:site:earthwork';
        const deps: Dependency[] = earthwork
          ? [dep('mobilize', 'Excavation after mobilization')]
          : [dep(before, before === 'mobilize' ? 'After mobilization' : 'Material approved and on site', before === 'mobilize' ? 'assumed' : 'documented')];
        if (!earthwork && before !== 'mobilize') deps.push(dep('mobilize', 'Site set up first'));
        if (prevLevel && !setup.levelsInParallel.value) deps.push(dep(workId(t.key, prevLevel), `Same crew, level after level (${setup.levelsInParallel.why})`));
        add({
          id,
          name,
          kind: 'work',
          trade: t.key,
          level: l,
          elements: workElements.map((e) => e.id),
          quantities,
          rates,
          crews,
          duration,
          durationBasis: tags.length ? 'assumed' : 'inferred',
          durationWhy: `${tags.length ? 'Rough-in proxy from measured electrical device tags: ' : ''}${qty} at ${Object.entries(rates)
            .filter(([u]) => quantities[u])
            .map(([u, r]) => `${r} ${u}`)
            .join(' / ')} per crew-day, ${crews} crew${crews === 1 ? '' : 's'}${tags.length ? ' · rate and device-to-rough-in equivalence assumed; confirm with electrical trade' : ''}${missing.length ? ` · no rate for ${missing.join(', ')}` : ''}`,
          deps,
          specs: specKeys,
          sources: [],
        });
        prevLevel = l;
      }
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
    if (x.trade === 'structure' && x.level === 'fdn' && has.has('work:site:earthwork'))
      x.deps.push(dep('work:site:earthwork', 'Excavation before foundation construction'));
  }

  // User-entered work that is absent from the takeoff stays separate from measured elements.
  // It has no model geometry or inferred quantity, and only enters the plan when the user
  // supplies a positive quantity and production rate in Build setup.
  const measuredWork = acts.filter((x) => x.kind === 'work');
  const lastMeasured = (trade: string) => measuredWork.filter((x) => x.trade === trade).at(-1)?.id;
  const follows = (trade: string, prior: string, seen = new Set<string>()): boolean =>
    (AFTER[trade] ?? []).some((p) => p === prior || (!seen.has(p) && (seen.add(p), follows(p, prior, seen))));
  const allowanceEntries = activeAllowances(setup).sort(([a], [b]) =>
    (a === 'site' ? 0 : a === 'foundations' ? 1 : a === 'structure' ? 2 : 3) -
    (b === 'site' ? 0 : b === 'foundations' ? 1 : b === 'structure' ? 2 : 3));
  const areaLevels = model.levels.filter((l) => l.id !== 'roof' && l.id !== 'fdn' && (model.floorAreas?.[l.id] ?? 0) > 0);
  const totalFloorArea = areaLevels.reduce((sum, l) => sum + model.floorAreas![l.id], 0);
  const unit = model.units === 'metric' ? 'm²' : 'SF';
  const allowancePackages = new Map<string, { id: string; level: string | null; quantity: number }[]>();
  for (const [key, value] of allowanceEntries) {
    const expected = model.units === 'metric' ? totalFloorArea : totalFloorArea / 0.09290304;
    const legacyProxy = value.provisional && Math.abs(value.quantity - expected) <= Math.max(0.2, expected * 0.001);
    const split = key !== 'envelope' && key !== 'site' && key !== 'foundations' && key !== 'structure' &&
      value.unit === unit && areaLevels.length > 0 && (value.distribution === 'gfa-by-level' || legacyProxy);
    const packages = split
      ? areaLevels.map((l) => ({ id: `allowance:${key}:${l.id}`, level: l.id, quantity: value.quantity * model.floorAreas![l.id] / totalFloorArea }))
      : [{ id: `allowance:${key}`, level: null, quantity: value.quantity }];
    allowancePackages.set(key, packages);
  }
  const allowanceIds = new Set([...allowancePackages.values()].flat().map((p) => p.id));
  const allowanceBefore = (key: string, level: string | null): string | undefined => {
    const packages = allowancePackages.get(key);
    return packages?.find((p) => p.level === level)?.id ?? packages?.find((p) => p.level === null)?.id ?? packages?.at(-1)?.id;
  };
  for (const [key, value] of allowanceEntries) {
    const packages = allowancePackages.get(key)!;
    for (const [index, pack] of packages.entries()) {
      const predecessors = new Set<string>();
      if (key === 'site') {
        predecessors.add('mobilize');
      } else if (key === 'foundations') {
        predecessors.add(has.has('work:structure:fdn') ? 'work:structure:fdn' : has.has('work:site:earthwork') ? 'work:site:earthwork' : 'mobilize');
        if (!has.has('work:structure:fdn') && has.has('proc:structure')) predecessors.add('proc:structure');
      } else if (key === 'structure') {
        predecessors.add(lastMeasured('structure') ?? (has.has('work:site:earthwork') ? 'work:site:earthwork' : 'mobilize'));
        const foundation = allowanceBefore('foundations', null);
        if (foundation) predecessors.add(foundation);
      } else {
        const own = measuredWork.filter((x) => x.trade === key && x.level === pack.level).at(-1)?.id ?? lastMeasured(key);
        predecessors.add(own ?? 'mobilize');
        if (!own) {
          for (const prior of AFTER[key] ?? []) {
            const work = measuredWork.find((x) => x.id === workId(prior, pack.level))?.id ?? lastMeasured(prior);
            if (work) predecessors.add(work);
          }
        }
      }
      if (index > 0 && !setup.levelsInParallel.value) predecessors.add(packages[index - 1].id);
      if (key !== 'foundations')
        for (const [prior] of allowanceEntries)
          if (prior !== key && follows(key, prior)) {
            const id = allowanceBefore(prior, pack.level);
            if (id && allowanceIds.has(id)) predecessors.add(id);
          }
      add({
        id: pack.id,
        name: `${key === 'foundations' ? 'Foundations' : tradeByKey.get(key)?.name ?? key} — unmeasured scope allowance${pack.level ? ` — ${levelName(pack.level)}` : ''}`,
        kind: 'work',
        trade: key === 'foundations' ? 'structure' : key,
        level: pack.level,
        elements: [],
        quantities: { [value.unit]: pack.quantity },
        rates: { [value.unit]: value.rate },
        crews: 1,
        duration: Math.max(1, Math.ceil(pack.quantity / value.rate)),
        durationBasis: 'assumed',
        durationWhy: `${Math.round(pack.quantity * 10) / 10} ${value.unit} at ${value.rate} ${value.unit} per crew-day · ${value.provisional ? 'provisional' : 'confirmed by you'} unmeasured scope${pack.level ? `, allocated by ${levelName(pack.level)} gross floor area` : ''}, entered in Build setup`,
        deps: [...predecessors].map((from) => dep(from, 'Scope allowance after prerequisite work')),
        specs: [],
        sources: [],
      });
    }
  }
  for (const x of measuredWork) {
    for (const [key] of allowanceEntries) {
      if (key === 'site') continue;
      const required = key === 'foundations'
        ? (x.trade === 'structure' && x.level !== 'fdn') || follows(x.trade!, 'structure')
        : x.trade !== key && follows(x.trade!, key);
      const prior = allowanceBefore(key, x.level);
      if (required && prior && !x.deps.some((d) => d.from === prior))
        x.deps.push(dep(prior, `Unmeasured ${key} scope before this work`));
    }
  }

  if (setup.dryInBeforeFinishes?.value) {
    const envelope = acts.filter((x) => x.kind === 'work' && x.trade === 'envelope');
    const roofEvidence = model.elements.some((e) => e.trade === 'envelope' && /roof/i.test(e.typeName) && (e.unit === 'm²' || e.unit === 'SF')) || allowanceIds.has('allowance:envelope');
    const wallEvidence = model.elements.some((e) => e.trade === 'envelope' && e.level !== 'roof');
    if (envelope.length && roofEvidence && wallEvidence) {
      const dryIn = add({ id: 'ms:dry-in', name: 'Weather-tight / dry-in (assumed)', kind: 'milestone', trade: null, level: null, elements: [], duration: 0, durationBasis: setup.dryInBeforeFinishes.basis, durationWhy: setup.dryInBeforeFinishes.why, deps: envelope.map((x) => dep(x.id, 'Envelope work before dry-in', 'assumed')), specs: [], sources: [] });
      const finishTrades = new Set(['partitions', 'ceilings', 'doors', 'painting', 'flooring', 'finishes', 'specialties']);
      for (const x of acts) if (x.kind === 'work' && finishTrades.has(x.trade ?? ''))
        x.deps.push(dep(dryIn.id, 'Interior finish after assumed dry-in', 'assumed'));
    }
  }

  // Testing and inspection where a trade's sections call for it.
  const tests: string[] = [];
  for (const t of tradesUsed) {
    const ws = acts.filter((x) => x.kind === 'work' && x.trade === t.key);
    if (!ws.length || t.key === 'demolition') continue;
    const secs = [...new Set(ws.flatMap((w) => w.specs))].map((k) => secByKey.get(k)).filter((s): s is SpecSection => !!s && s.articles.some((x) => TESTS.test(x.title)));
    if (!secs.length) continue;
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
  const closeFact = facts.find(f => f.key === 'closeoutDays');
  const substantialFact = facts.find(f => f.key === 'substantialDate');
  add({ id: 'ms:finish', name: 'Project complete', requiredBy: closeFact && substantialFact ? addCalendarDays(String(substantialFact.value), Number(closeFact.value)) : undefined, kind: 'milestone', trade: null, level: null, elements: [], duration: 0, durationBasis: 'inferred', durationWhy: 'After closeout', deps: [dep(close.id, 'Closeout done')], specs: [], sources: [] });

  // The user's edits: durations, crews, links.
  const byId = new Map(acts.map((x) => [x.id, x]));
  for (const [id, ed] of Object.entries(edits?.activities ?? {})) {
    const x = byId.get(id);
    if (!x) continue;
    if (ed.crews && x.kind === 'work' && x.quantities && x.rates) {
      let crewDays = 0;
      for (const [u, q] of Object.entries(x.quantities)) if (x.rates[u]) crewDays += q / x.rates[u];
      crewDays = Math.max(crewDays, x.allowanceCrewDays ?? 0);
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
