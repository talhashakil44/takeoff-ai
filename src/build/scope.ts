import type { BuildModel, Issue, SpecFact } from './types';

/** Missing scope is a review item, never an activity with an invented quantity or lead time. */
export function planningScopeIssues(model: BuildModel, facts: SpecFact[]): Issue[] {
  const issues: Issue[] = [];
  const phase = facts.find((f) => f.key === 'phaseDate');
  if (phase)
    issues.push({
      id: 'phase-scope-unmapped',
      severity: 'warning',
      text: `The specification gives a phase occupancy date of ${phase.value}, but the phase's rooms or zones are not mapped to takeoffs. Assign the actual phase scope before checking that milestone; no whole-floor work has been inferred.`,
      sources: [phase.source],
    });
  for (const level of model.levels.filter((l) => l.id !== 'roof' && l.id !== 'fdn')) {
    if ((model.floorAreas?.[level.id] ?? 0) > 0) continue;
    issues.push({
      id: `scope-floor-evidence:${level.id}`,
      severity: 'warning',
      text: `${level.name}: no defensible exterior boundary or gross floor area was recovered. Review the drawing and measured work; scheduling cannot infer missing floor trades.`,
    });
  }
  return issues;
}
