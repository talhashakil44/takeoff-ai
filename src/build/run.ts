import { connectStructure } from './connectStructure';
import type { DrawingLines } from './roof';
import type { DrawingTexts } from "./building";
import type { Project } from '../model';
import type { SpecSection } from '../spec/parse';
import { planToTarget } from "./replanTarget";
import { extractModel, type ExtractInput } from './extract';
import { applySetupEdits, defaultSetup, planActivities } from './plan';
import { planningScopeIssues, suggestScopeAllowances } from './scope';
import type { BuildEdits, BuildModel, PlanSetup, Schedule, ScopeSuggestion, SpecFact } from './types';

export interface BuildInput {
  project: Project;
  sections: SpecSection[];
  facts: SpecFact[];
  levelHints?: Record<string, string>;
  drawingTexts?: DrawingTexts;
  drawingLines?: DrawingLines;
  edits?: BuildEdits;
  /** Today (ISO), for the default start. */
  today: string;
}

export interface BuildOutput {
  model: BuildModel;
  setup: PlanSetup;
  schedule: Schedule;
  scopeSuggestions: ScopeSuggestion[];
  /** Milliseconds spent, for keeping an eye on it. */
  ms: { model: number; plan: number };
}

/** The model, the plan's setup and the schedule, from the project as it is now. */
export function buildAll(input: BuildInput): BuildOutput {
  const t0 = Date.now();
  // The floor-to-floor height is a setup value the model needs first.
  const probe = defaultSetup({ units: input.project.units } as BuildModel, input.facts, input.today);
  const ftf = applySetupEdits(probe, input.edits).floorToFloor.value;
  const ex: ExtractInput = { project: input.project, sections: input.sections, drawingTexts: input.drawingTexts, drawingLines: input.drawingLines, levelHints: input.levelHints, edits: input.edits, floorToFloor: input.project.units === 'imperial' ? ftf * 0.3048 : ftf };
  const model = connectStructure(input.project, extractModel(ex), input.drawingTexts ?? {}, input.drawingLines ?? {});
  const t1 = Date.now();
  const setup = applySetupEdits(defaultSetup(model, input.facts, input.today), input.edits);
  return { model, setup, ...replan(model, setup, input), ms: { model: t1 - t0, plan: Date.now() - t1 } };
}

/** Just the plan and schedule again (setup or activity edits; the model unchanged). */
export function replan(model: BuildModel, setup: PlanSetup, input: Pick<BuildInput, 'sections' | 'facts' | 'edits'> & { today?: string }): { schedule: Schedule; scopeSuggestions: ScopeSuggestion[] } {
  const acts = planActivities(model, setup, input.sections, input.facts, input.edits);
  const schedule = planToTarget(acts, setup);
  schedule.issues.push(...planningScopeIssues(model, input.facts, setup));
  if (model.roofPlan && acts.some((a) => a.id === 'work:envelope:roof-covering'))
    schedule.issues.push({
      id: 'roof-plan-area-derived',
      severity: 'warning',
      text: `${Math.round(model.roofPlan.areaM2)} m² of roof covering is inferred from registered roof-plan grids. Confirm the actual roof edges, roof-type areas and slope before relying on its duration.`,
      sources: [model.roofPlan.source],
    });
  const tagIds = new Set(model.elements.filter((e) => e.measurementSource === 'etags').map((e) => e.id));
  const tagRough = acts.filter((a) => a.id.startsWith('work:elec-rough:') && a.elements.length > 0 && a.elements.every((id) => tagIds.has(id)));
  if (tagRough.length) {
    const points = tagRough.reduce((sum, a) => sum + (a.quantities?.ea ?? 0), 0);
    const unplaced = tagRough.find((a) => a.level === null)?.quantities?.ea ?? 0;
    schedule.issues.push({
      id: 'electrical-rough-in-tag-proxy',
      severity: 'warning',
      text: `Electrical rough-in uses ${points} measured device and fixture tags as an assumed point-count proxy at ${setup.trades['elec-rough']?.value.rates.ea ?? '?'} points per crew-day. Cable and conduit routes, circuit complexity and crew output are unverified${unplaced ? `; ${unplaced} tags have no known building level and are planned as unplaced work` : ''}. Confirm scope and production with the electrical trade.`,
    });
  }
  if (setup.dryInBeforeFinishes?.value && !acts.some((a) => a.id === 'ms:dry-in') &&
      acts.some((a) => a.kind === 'work' && ['partitions', 'ceilings', 'doors', 'painting', 'flooring', 'finishes', 'specialties'].includes(a.trade ?? '')))
    schedule.issues.push({
      id: 'dry-in-evidence-missing',
      severity: 'warning',
      text: 'The dry-in gate is on, but roof covering and exterior wall evidence is incomplete. Finish work remains sequenced by its other prerequisites; confirm the enclosure and set a weather-tight milestone before relying on its dates.',
    });
  const structureRates = setup.trades.structure?.value.rates;
  const structureRateRefs = model.elements.filter((e) => e.trade === 'structure' && (
    (e.unit === 'ea' && structureRates?.ea === 10) ||
    (e.production?.unit === 'm³' && structureRates?.['m³'] === 8) ||
    (e.production?.unit === 'CY' && structureRates?.CY === 10)
  )).map((e) => e.id);
  if (structureRateRefs.length)
    schedule.issues.push({
      id: 'structure-production-review',
      severity: 'warning',
      text: 'Structural member counts and foundation concrete use provisional crew-day rates. Confirm erection complexity, forming, reinforcement and concrete placing rates with the trade before relying on the finish date.',
      refs: structureRateRefs,
    });
  const excavationRefs = model.elements.filter((e) => e.trade === 'site' && /^\s*31\b/.test(e.division)).map((e) => e.id);
  const missingExcavationVolume = model.elements.filter((e) => e.trade === 'site' && /^\s*31\b/.test(e.division) && !e.production).map((e) => e.id);
  const excavationRate = setup.trades.site?.value.rates[model.units === 'metric' ? 'm³' : 'CY'];
  if (excavationRefs.length && excavationRate === (model.units === 'metric' ? 50 : 65))
    schedule.issues.push({
      id: 'excavation-production-review',
      severity: 'warning',
      text: 'Excavation uses a provisional bank-volume production rate. Confirm excavation depth, access, hauling and crew output before relying on the foundation start or finish date.',
      refs: excavationRefs,
    });
  if (missingExcavationVolume.length)
    schedule.issues.push({
      id: 'excavation-volume-missing',
      severity: 'warning',
      text: 'Some Division 31 work has no usable bank volume. Its activity duration is a placeholder until an excavation quantity and rate are set.',
      refs: missingExcavationVolume,
    });
  const now = new Date();
  const today = input.today ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (setup.start.value < today)
    schedule.issues.push({
      id: 'historical-start',
      severity: 'warning',
      text: `The plan starts on ${setup.start.value}, before today's ${today}. This may be the documented contract start, but the schedule is historical; set the actual remaining-work start to forecast from today.`,
      sources: setup.start.source ? [setup.start.source] : [],
    });
  return { schedule, scopeSuggestions: suggestScopeAllowances(model, setup) };
}
