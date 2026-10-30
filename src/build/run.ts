import { connectStructure } from './connectStructure';
import type { DrawingLines } from './roof';
import type { DrawingTexts } from "./building";
import type { Project } from '../model';
import type { SpecSection } from '../spec/parse';
import { planToTarget } from "./replanTarget";
import { extractModel, type ExtractInput } from './extract';
import { applySetupEdits, defaultSetup, planActivities } from './plan';
import type { BuildEdits, BuildModel, PlanSetup, Schedule, SpecFact } from './types';

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
export function replan(model: BuildModel, setup: PlanSetup, input: Pick<BuildInput, 'sections' | 'facts' | 'edits'>): { schedule: Schedule } {
  const acts = planActivities(model, setup, input.sections, input.facts, input.edits);
  return { schedule: planToTarget(acts, setup) };
}
