import { tradeByKey } from './extract';
import type { BuildModel, Issue, PlanSetup, ScopeAllowance, SpecFact } from './types';

const allowanceValue = (value: unknown): value is ScopeAllowance => {
  if (!value || typeof value !== 'object') return false;
  const a = value as Partial<ScopeAllowance>;
  return Number.isFinite(a.quantity) && a.quantity! > 0 &&
    typeof a.unit === 'string' && !!a.unit.trim() &&
    Number.isFinite(a.rate) && a.rate! > 0 &&
    typeof a.provisional === 'boolean';
};

/** Valid, active user allowances. Zero quantities are draft rows and add no work. */
export function activeAllowances(setup: PlanSetup): [string, ScopeAllowance][] {
  const entries = setup.allowances?.value;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return [];
  return Object.entries(entries)
    .filter(([key, value]) => (key === 'foundations' || tradeByKey.has(key)) && allowanceValue(value))
    .map(([key, value]) => [key, { ...value, unit: value.unit.trim() }]);
}

/** Missing scope stays a review item; only user-entered allowances create extra work. */
export function planningScopeIssues(model: BuildModel, facts: SpecFact[], setup: PlanSetup): Issue[] {
  const issues: Issue[] = [];
  const entries = setup.allowances?.value;
  if (entries && typeof entries === 'object' && !Array.isArray(entries))
    for (const [key, value] of Object.entries(entries)) {
      if ((key === 'foundations' || tradeByKey.has(key)) && value && typeof value === 'object' && (value as ScopeAllowance).quantity === 0) continue;
      if ((key !== 'foundations' && !tradeByKey.has(key)) || !allowanceValue(value))
        issues.push({ id: `scope-allowance-invalid:${key}`, severity: 'warning', text: `${key}: incomplete scope allowance; enter a positive quantity and crew-day rate, a unit, and its provisional status before it can enter the plan.` });
      else if (value.provisional)
        issues.push({ id: `scope-allowance-provisional:${key}`, severity: 'warning', text: `${key}: ${value.quantity} ${value.unit} at ${value.rate} ${value.unit} per crew-day is an unmeasured, provisional scope allowance. Confirm it against the drawings and trade before relying on the finish date.` });
    }
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
