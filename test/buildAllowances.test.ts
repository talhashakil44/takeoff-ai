import { describe, expect, it } from 'vitest';
import { schedule } from '../src/build/cpm';
import { applySetupEdits, defaultSetup, planActivities } from '../src/build/plan';
import { planningScopeIssues, suggestScopeAllowances } from '../src/build/scope';
import { replan } from '../src/build/run';
import type { BuildElement, BuildModel, ScopeAllowance } from '../src/build/types';

const element = (id: string, trade: string, level: string | null, division: string, unit: string, quantity: number): BuildElement => ({
  id, name: id, trade, level, division, unit, quantity,
  shape: null, typeId: id, typeName: id, measurementId: id, sheetId: id,
  origin: 'takeoff', status: 'new', specs: [], sources: [], placement: 'unknown', issues: [],
});

function model(): BuildModel {
  return {
    version: 15, sourceHash: 'test', units: 'metric',
    levels: [
      { id: 'fdn', name: 'Foundation', elevation: -1.2, basis: 'inferred', sheets: [] },
      { id: 'L1', name: 'Level 1', elevation: 0, basis: 'inferred', sheets: [] },
    ],
    elements: [
      element('dig', 'site', null, '31 Earthwork', 'm³', 40),
      element('pad', 'structure', 'fdn', '03 Concrete', 'm³', 12),
      element('beam', 'structure', 'L1', '06 Wood', 'ea', 10),
      element('pipe', 'mech-rough', 'L1', '22 Plumbing', 'm', 30),
      element('ceiling', 'ceilings', 'L1', '09 Finishes', 'm²', 50),
    ],
    issues: [], extent: [0, 0, 0, 0], floorAreas: { L1: 100 },
  };
}

const allowance = (quantity: number, unit: string, rate: number, provisional = true): ScopeAllowance =>
  ({ quantity, unit, rate, provisional });

describe('Build It unmeasured scope allowances', () => {
  it('offers floor-area proxies only for absent measured trades and never applies them by itself', () => {
    const m = model();
    const setup = defaultSetup(m, [], '2026-11-02');
    const suggestions = suggestScopeAllowances(m, setup);
    expect(suggestions.map((s) => s.key)).toEqual(expect.arrayContaining(['elec-rough', 'fire-rough', 'painting', 'flooring']));
    expect(suggestions.some((s) => s.key === 'mech-rough' || s.key === 'ceilings')).toBe(false);
    expect(suggestions.some((s) => s.key === 'site' || s.key === 'doors')).toBe(false);
    expect(suggestions.find((s) => s.key === 'elec-rough')).toMatchObject({
      allowance: { quantity: 100, unit: 'm²', rate: 56, provisional: true },
      areaBasis: 'inferred', rateBasis: 'assumed',
    });
    expect(setup.allowances.value).toEqual({});
    expect(planActivities(m, setup, [], []).some((a) => a.id === 'allowance:elec-rough')).toBe(false);
    const accepted = applySetupEdits(setup, { setup: { allowances: { 'elec-rough': suggestions.find((s) => s.key === 'elec-rough')!.allowance } } });
    expect(planActivities(m, accepted, [], []).find((a) => a.id === 'allowance:elec-rough')).toMatchObject({ duration: 2, elements: [] });
    expect(suggestScopeAllowances(m, accepted).some((s) => s.key === 'elec-rough')).toBe(false);
    expect(replan(m, accepted, { sections: [], facts: [], today: '2026-11-02' }).scopeSuggestions.some((s) => s.key === 'elec-rough')).toBe(false);
    m.floorAreas = {};
    expect(suggestScopeAllowances(m, setup)).toEqual([]);
  });
  it('uses the measured slab footprint for a provisional roof/envelope proposal', () => {
    const m = model();
    m.elements.push({ ...element('slab', 'structure', 'fdn', '03 Concrete', 'm²', 702.065), typeName: 'Slab on grade' });
    const setup = defaultSetup(m, [], '2026-11-02');
    expect(suggestScopeAllowances(m, setup).find((s) => s.key === 'envelope')).toMatchObject({
      allowance: { quantity: 702.1, unit: 'm²', rate: 74, provisional: true },
      referenceAreaM2: 702.065,
    });
    m.floorAreas = {};
    expect(suggestScopeAllowances(m, setup).map((s) => s.key)).toEqual(['envelope']);
  });
  it('has no quantity or work activity until the user enters one', () => {
    const m = model();
    const setup = defaultSetup(m, [], '2026-11-02');
    expect(setup.allowances.value).toEqual({});
    expect(planActivities(m, setup, [], []).some((a) => a.id.startsWith('allowance:'))).toBe(false);
  });

  it('adds separate user-entered work in the graph without changing measured elements', () => {
    const m = model();
    const before = JSON.stringify(m.elements);
    const base = defaultSetup(m, [], '2026-11-02');
    const setup = applySetupEdits(base, { setup: { allowances: {
      site: allowance(100, 'm²', 20),
      foundations: allowance(60, 'm³', 6),
      structure: allowance(20, 'ea', 4, false),
      'mech-rough': allowance(50, 'm', 10),
    } } });
    const acts = planActivities(m, setup, [], []);
    const byId = new Map(acts.map((a) => [a.id, a]));
    const deps = (id: string) => byId.get(id)!.deps.map((d) => d.from);
    expect(byId.get('allowance:foundations')).toMatchObject({
      quantities: { 'm³': 60 }, rates: { 'm³': 6 }, duration: 10, elements: [], level: null,
    });
    expect(deps('allowance:site')).toEqual(['mobilize']);
    expect(deps('allowance:foundations')).toContain('work:structure:fdn');
    expect(deps('work:structure:L1')).toContain('allowance:foundations');
    expect(deps('allowance:structure')).toContain('work:structure:L1');
    expect(deps('work:mech-rough:L1')).toContain('allowance:structure');
    expect(deps('allowance:mech-rough')).toContain('work:mech-rough:L1');
    expect(deps('work:ceilings:L1')).toContain('allowance:mech-rough');
    expect(deps('work:structure:fdn')).not.toContain('allowance:site');
    expect(JSON.stringify(m.elements)).toBe(before);
    const baseline = schedule(planActivities(m, base, [], []), base);
    const extended = schedule(acts, setup);
    expect(extended.issues.some((i) => i.id === 'loop')).toBe(false);
    expect(extended.feasibility.earliestFinish > baseline.feasibility.earliestFinish).toBe(true);
    expect(planningScopeIssues(m, [], setup).map((i) => i.id)).toContain('scope-allowance-provisional:foundations');
    expect(planningScopeIssues(m, [], setup).map((i) => i.id)).not.toContain('scope-allowance-provisional:structure');
  });

  it('rejects incomplete entries and treats zero quantity as an inactive draft', () => {
    const m = model();
    const setup = applySetupEdits(defaultSetup(m, [], '2026-11-02'), { setup: { allowances: {
      site: allowance(0, 'm²', 20),
      foundations: allowance(60, 'm³', 0),
      bogus: allowance(10, 'ea', 2),
    } } });
    expect(planActivities(m, setup, [], []).some((a) => a.id.startsWith('allowance:'))).toBe(false);
    expect(planningScopeIssues(m, [], setup).map((i) => i.id)).toEqual(expect.arrayContaining([
      'scope-allowance-invalid:foundations', 'scope-allowance-invalid:bogus',
    ]));
    expect(planningScopeIssues(m, [], setup).some((i) => i.id === 'scope-allowance-invalid:site')).toBe(false);
  });

  it('plans an allowance-only structural and mechanical path without inventing takeoffs', () => {
    const m = model();
    m.elements = m.elements.filter((e) => e.trade === 'site' || e.trade === 'ceilings');
    const setup = applySetupEdits(defaultSetup(m, [], '2026-11-02'), { setup: { allowances: {
      foundations: allowance(30, 'm³', 5),
      structure: allowance(12, 'ea', 3),
      'mech-rough': allowance(80, 'm', 10),
    } } });
    const acts = planActivities(m, setup, [], []);
    const deps = (id: string) => acts.find((a) => a.id === id)!.deps.map((d) => d.from);
    expect(deps('allowance:foundations')).toContain('work:site:earthwork');
    expect(deps('allowance:structure')).toContain('allowance:foundations');
    expect(deps('allowance:mech-rough')).toContain('allowance:structure');
    expect(deps('work:ceilings:L1')).toContain('allowance:mech-rough');
    expect(deps('cx:mech')).toContain('allowance:mech-rough');
    expect(schedule(acts, setup).issues.some((i) => i.id === 'loop')).toBe(false);
    expect(m.elements.some((e) => e.trade === 'structure' || e.trade === 'mech-rough')).toBe(false);
  });
});
