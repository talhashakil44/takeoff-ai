import type { Activity, Feasibility, Issue, PlanSetup, Schedule, Scheduled } from './types';

/**
 * The schedule: the critical path method on a working-day calendar. Every start follows from
 * the links (finish-to-start or start-to-start, with lags) and the durations; nothing is moved
 * to meet the target. When the plan can't meet it, the chain of activities that sets the
 * earliest finish is the explanation, split into what the documents require and what is an
 * assumption that could be changed.
 */

export class Calendar {
  private days: string[] = [];
  private index = new Map<string, number>();
  private readonly work: Set<number>;
  private readonly off: Set<string>;
  constructor(
    readonly start: string,
    workDays: number[],
    holidays: string[],
  ) {
    this.work = new Set(workDays.length ? workDays : [1, 2, 3, 4, 5]);
    this.off = new Set(holidays);
  }
  private grow(n: number) {
    let d = this.days.length ? this.next(this.days[this.days.length - 1]) : this.start;
    while (this.days.length <= n) {
      if (this.isWork(d)) {
        this.index.set(d, this.days.length);
        this.days.push(d);
      }
      d = this.next(d);
    }
  }
  private next(iso: string) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  isWork(iso: string) {
    return this.work.has(new Date(`${iso}T12:00:00`).getDay()) && !this.off.has(iso);
  }
  /** The date of working day i (0 = the first working day on or after the start). */
  date(i: number): string {
    if (i < 0) return this.start;
    this.grow(i);
    return this.days[i];
  }
  /** How many working days fall from the start up to and including this date. */
  workingDaysTo(iso: string): number {
    if (iso < this.start) return 0;
    let i = 0;
    while (this.date(i) <= iso) i++;
    return i;
  }
}

export function schedule(acts: Activity[], setup: PlanSetup): Schedule {
  acts = structuredClone(acts);
  const cal = new Calendar(
    setup.start.value,
    setup.workDays.value,
    setup.holidays.value,
  );
  const issues: Issue[] = [];
  const byId = new Map(acts.map((x) => [x.id, x]));
  const succ = new Map<string, string[]>();
  for (const x of acts) for (const d of x.deps) if (byId.has(d.from)) succ.set(d.from, [...(succ.get(d.from) ?? []), x.id]);
  // Order: predecessors first (Kahn); a loop the user made is reported and broken.
  const indeg = new Map(acts.map((x) => [x.id, x.deps.filter((d) => byId.has(d.from)).length]));
  const order: Activity[] = [];
  const ready = acts.filter((x) => indeg.get(x.id) === 0);
  while (ready.length) {
    const x = ready.shift()!;
    order.push(x);
    for (const s of succ.get(x.id) ?? []) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) ready.push(byId.get(s)!);
    }
  }
  if (order.length < acts.length) {
    const stuck = acts.filter((x) => !order.includes(x));
    issues.push({ id: 'loop', severity: 'conflict', text: `These activities wait for each other in a loop, so they can't be scheduled: ${stuck.map((x) => x.name).join('; ')}. Remove one of the links.`, refs: stuck.map((x) => x.id) });
    for (const x of stuck) order.push({ ...x, deps: [] });
  }

  // Forward pass: the earliest each can start and finish.
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const driver = new Map<string, string | null>();
  for (const x of order) {
    let start = 0;
    let drv: string | null = null;
    for (const d of x.deps) {
      if (!ef.has(d.from)) continue;
      const t = d.type === 'SS' ? es.get(d.from)! + d.lag : ef.get(d.from)! + d.lag;
      if (t > start || (t === start && drv === null && x.deps.length)) {
        start = t;
        drv = d.from;
      }
    }
    if (x.weather && x.duration > 0) {
      const production = x.duration;
      let earned = 0, elapsed = 0;
      while (earned < production) {
        const month = Number(cal.date(start + elapsed).slice(5, 7));
        // Ontario planning assumption, not a forecast: roof work pauses in
        // Dec–Feb; site/structure use winter protection at 60% output.
        const winter = month === 12 || month <= 2;
        earned += winter ? (x.weather === 'roof' ? 0 : 0.6) : (month === 3 || month === 11 ? 0.85 : 1);
        elapsed++;
      }
      x.duration = elapsed;
      if (elapsed > production) x.durationWhy += ` · Ontario weather allowance: ${elapsed - production} working days; winter protection/site access assumption`;
    }
    es.set(x.id, start);
    ef.set(x.id, start + x.duration);
    driver.set(x.id, drv);
  }
  const finish = Math.max(0, ...ef.values());
  // Backward pass: the latest each can start and finish without moving the finish.
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const x of [...order].reverse()) {
    let late = finish;
    for (const s of succ.get(x.id) ?? []) {
      const sx = byId.get(s)!;
      const d = sx.deps.find((y) => y.from === x.id)!;
      if (!ls.has(s)) continue;
      const t = d.type === 'SS' ? ls.get(s)! - d.lag + x.duration : ls.get(s)! - d.lag;
      late = Math.min(late, t);
    }
    lf.set(x.id, late);
    ls.set(x.id, late - x.duration);
  }

  const target = setup.target.value;
  const targetFor = byId.has(setup.targetFor) ? setup.targetFor : 'ms:finish';
  const targetIdx = target ? cal.workingDaysTo(target) : null;
  const overBy = targetIdx !== null ? Math.max(0, (ef.get(targetFor) ?? finish) - targetIdx) : 0;
  // What must come before the target milestone (the rest isn't held to the target).
  const before = new Set<string>();
  const walk = (id: string) => {
    if (before.has(id)) return;
    before.add(id);
    for (const d of byId.get(id)?.deps ?? []) walk(d.from);
  };
  walk(targetFor);
  // Latest finishes that still meet the target (a backward pass from the target milestone).
  const lfT = new Map<string, number>();
  if (targetIdx !== null)
    for (const x of [...order].reverse()) {
      if (!before.has(x.id)) continue;
      let late = x.id === targetFor ? targetIdx : Infinity;
      for (const sId of succ.get(x.id) ?? []) {
        if (!lfT.has(sId)) continue;
        const sx = byId.get(sId)!;
        const d = sx.deps.find((y) => y.from === x.id)!;
        const lsS = lfT.get(sId)! - sx.duration;
        late = Math.min(late, d.type === 'SS' ? lsS - d.lag + x.duration : lsS - d.lag);
      }
      lfT.set(x.id, late);
    }

  const times: Record<string, Scheduled> = {};
  for (const x of acts) {
    const s = es.get(x.id) ?? 0;
    const f = ef.get(x.id) ?? 0;
    const fl = (ls.get(x.id) ?? 0) - s;
    times[x.id] = {
      id: x.id,
      es: s,
      ef: f,
      ls: ls.get(x.id) ?? 0,
      lf: lf.get(x.id) ?? 0,
      float: fl,
      start: cal.date(s),
      finish: cal.date(Math.max(s, f - 1)),
      critical: fl === 0,
      driver: driver.get(x.id) ?? null,
      // It can't make the target if its slack (to the target milestone) is less than the overrun.
      late: lfT.has(x.id) && f > lfT.get(x.id)!,
    };
  }

  // The chain that sets the finish: back from the target milestone through each start's driver.
  const chain: Feasibility['chain'] = [];
  let at: string | null = targetFor;
  const guard = new Set<string>();
  while (at && !guard.has(at)) {
    guard.add(at);
    const x = byId.get(at);
    if (!x) break;
    const drv: string | null = times[at]?.driver ?? null;
    const lag = drv ? (x.deps.find((d) => d.from === drv)?.lag ?? 0) : 0;
    chain.unshift({ id: x.id, name: x.name, duration: x.duration, basis: x.durationBasis, why: x.durationWhy, lag });
    at = drv;
  }
  const documentedDays = chain.filter((c) => c.basis === 'documented').reduce((s, c) => s + c.duration, 0);
  const assumedDays = chain.filter((c) => c.basis !== 'documented').reduce((s, c) => s + c.duration, 0);
  const levers: string[] = [];
  for (const c of chain) {
    const x = byId.get(c.id)!;
    if (!x.duration) continue;
    if (x.kind === 'work') levers.push(`More crews on “${x.name}” (now ${x.crews ?? 1}, ${x.duration} days)`);
    else if (x.kind === 'review') levers.push(c.basis === 'documented' ? `Review takes ${x.duration} days by the specification (${x.durationWhy}): only the consultant can shorten it` : `Shorter consultant review (assumed ${x.duration} days)`);
    else if (x.kind === 'resubmittal') levers.push(`Plan for no resubmission on “${x.name.replace(/^Resubmission and re-review — /, '')}” (${x.duration} days now)`);
    else if (x.kind === 'procurement') levers.push(`Confirm a shorter lead time for “${x.name.replace(/^Fabrication and delivery — /, '')}” (assumed ${x.duration} days)`);
    else if (x.kind === 'submittal') levers.push(`Faster submittal preparation (assumed ${x.duration} days)`);
    else if (c.basis === 'assumed') levers.push(`“${x.name}”: ${x.duration} days assumed`);
  }
  if (!setup.levelsInParallel.value && chain.some((c) => byId.get(c.id)?.deps.some((d) => /level after level/.test(d.why)))) levers.push('Let crews work on more than one level at a time (more crews on site)');

  if (overBy > 0 && target)
    issues.push({
      id: 'target',
      severity: 'conflict',
      text: `The plan can't meet ${target}: under the current assumptions the earliest ${targetFor === 'ms:substantial' ? 'substantial performance' : 'finish'} is ${cal.date(Math.max(0, (ef.get(targetFor) ?? finish) - 1))}, ${overBy} working days late.`,
      refs: chain.map((c) => c.id),
    });
  for (const x of acts) if (x.kind === 'work' && x.durationWhy.includes('no rate for')) issues.push({ id: `rate:${x.id}`, severity: 'warning', text: `${x.name}: ${x.durationWhy.split(' · ')[1]} — its duration leaves that quantity out.`, refs: [x.id] });

  for (const a of acts)
    if (a.requiredBy && times[a.id].ef > cal.workingDaysTo(a.requiredBy))
      issues.push({
        id: `deadline:${a.id}`,
        severity: "conflict",
        text: `${a.name} misses its documented ${a.requiredBy} milestone by ${times[a.id].ef - cal.workingDaysTo(a.requiredBy)} working days.`,
        refs: [a.id],
        sources: a.sources,
      });

  return {
    activities: acts,
    times,
    feasibility: {
      earliestFinish: cal.date(Math.max(0, (ef.get(targetFor) ?? finish) - 1)),
      target,
      overBy,
      chain,
      documentedDays,
      assumedDays,
      levers: [...new Set(levers)].slice(0, 8),
    },
    issues,
  };
}
