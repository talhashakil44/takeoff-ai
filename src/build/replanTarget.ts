import { schedule } from './cpm';
import type { Activity, PlanSetup, Schedule } from './types';

/** Rebuild from the lean baseline every time. Never carry acceleration into the next target. */
export function planToTarget(baseline: Activity[], setup: PlanSetup): Schedule {
  let activities = structuredClone(baseline);
  let result = schedule(activities, setup);
  const baselineFinish = result.feasibility.earliestFinish;
  result.feasibility.baselineFinish = baselineFinish;
  const changes: string[] = [];
  if (!setup.target.value || result.issues.some((i) => i.id === 'loop')) return result;
  // Bounded resource levelling: at most three crews per package. Fixed dates, procurement,
  // reviews, explicit user edits and unknown production rates cannot be compressed.
  for (let step = 0; result.feasibility.overBy > 0 && step < baseline.length * 2; step++) {
    const candidates: {
      acts: Activity[];
      plan: Schedule;
      cost: number;
      change: string;
    }[] = [];
    for (const a of activities) {
      if (!result.times[a.id]?.critical || a.kind !== 'work' || a.edited || a.durationBasis === 'documented' || !a.quantities || !a.rates || (a.crews ?? 1) >= 3) continue;
      if (Object.entries(a.quantities).some(([u, q]) => q > 0 && !(a.rates![u] > 0))) continue;
      const crewDays = Math.max(
        a.allowanceCrewDays ?? 0,
        Object.entries(a.quantities).reduce((n, [u, q]) => n + (q > 0 ? q / a.rates![u] : 0), 0),
      );
      const crews = (a.crews ?? 1) + 1;
      const duration = Math.max(a.minimumDays ?? 1, Math.ceil(crewDays / crews));
      if (duration >= a.duration) continue;
      const acts = structuredClone(activities),
        next = acts.find((x) => x.id === a.id)!;
      next.crews = crews;
      next.duration = duration;
      next.durationWhy += ` · target recovery: ${crews} crews; congestion and supervision premium; production must be confirmed`;
      const plan = schedule(acts, setup);
      const gain = result.feasibility.overBy - plan.feasibility.overBy;
      if (gain > 0)
        candidates.push({
          acts,
          plan,
          cost: duration / gain,
          change: `${a.name}: ${a.crews ?? 1} → ${crews} crews, ${a.duration} → ${duration} production days. Extra crew mobilization and congestion risk; cost not priced.`,
        });
    }
    // A separate crew may start the next level after its physical prerequisites; retain all
    // other links, including weather-tight, inspection, and procurement gates.
    for (const a of activities) {
      if (!result.times[a.id]?.critical || a.kind !== 'work' || a.edited || !a.level) continue;
      const resource = a.deps.filter((d) => /Same crew, level after level/.test(d.why));
      if (!resource.length) continue;
      const acts = structuredClone(activities),
        next = acts.find((x) => x.id === a.id)!;
      next.deps = next.deps.filter((d) => !resource.some((r) => r.from === d.from));
      const plan = schedule(acts, setup);
      const gain = result.feasibility.overBy - plan.feasibility.overBy;
      if (gain > 0)
        candidates.push({
          acts,
          plan,
          cost: next.duration / gain,
          change: `${a.name}: dedicated ${a.crews ?? 1}-crew team on this level overlaps the previous level. Additional concurrent labour, access and supervision required; cost not priced.`,
        });
    }
    // Equal critical branches can mask every individual improvement. Advance them together
    // only when no single change helps, then recompute before accepting the resource cost.
    if (!candidates.length) {
      const acts = structuredClone(activities),
        names: string[] = [];
      for (const a of acts) {
        if (
          !result.times[a.id]?.critical || a.kind !== 'work' ||
          a.edited ||
          a.durationBasis === 'documented' ||
          !a.quantities ||
          !a.rates ||
          (a.crews ?? 1) >= 3
        )
          continue;
        if (Object.entries(a.quantities).some(([u, q]) => q > 0 && !(a.rates![u] > 0))) continue;
        const effort = Math.max(
          a.allowanceCrewDays ?? 0,
          Object.entries(a.quantities).reduce((n, [u, q]) => n + (q > 0 ? q / a.rates![u] : 0), 0),
        );
        const crews = (a.crews ?? 1) + 1,
          duration = Math.max(a.minimumDays ?? 1, Math.ceil(effort / crews));
        if (duration >= a.duration) continue;
        names.push(`${a.name}: ${a.crews ?? 1} → ${crews} crews`);
        a.crews = crews;
        a.duration = duration;
        a.durationWhy += ` · target recovery: ${crews} crews on tied critical branches; additional labour and congestion risk`;
      }
      if (names.length) {
        const plan = schedule(acts, setup);
        if (plan.feasibility.overBy < result.feasibility.overBy)
          candidates.push({
            acts,
            plan,
            cost: 1,
            change: `Concurrent recovery of tied driving branches: ${names.join('; ')}. Additional concurrent crews and supervision; cost not priced.`,
          });
      }
    }
    candidates.sort((a, b) => a.cost - b.cost);
    const chosen = candidates[0];
    if (!chosen) break;
    activities = chosen.acts;
    result = chosen.plan;
    changes.push(chosen.change);
  }
  result.feasibility.changes = changes;
  result.feasibility.baselineFinish = baselineFinish;
  if (changes.length)
    result.issues.push({
      id: 'target-recovery',
      severity: 'warning',
      text: `Target recovery assumes additional resources: ${changes.join(' ')}`,
    });
  return result;
}
