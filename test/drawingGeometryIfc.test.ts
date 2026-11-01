import { expect, it } from 'vitest';
import { newProject } from '../src/model';
import { toIfc } from '../src/build/ifc';
import { ifcGuid } from '../src/build/ifcClass';
import { defaultSetup, planActivities } from '../src/build/plan';
import { schedule } from '../src/build/cpm';
import type { BuildElement, BuildModel, Activity } from '../src/build/types';

it('exports source-only solids without accepted quantities or process assignments', () => {
  const project = newProject('metric');
  const candidate: BuildElement = {
    id: 'drawing:add5:21:MF3:left', measurementId: 'drawing:add5:21:MF3:left',
    name: 'MF3 source footprint', typeName: 'MF3', typeId: '', division: '03',
    trade: 'foundations', level: 'ground', origin: 'drawing', sheetId: 's1',
    quantity: 0, unit: '', planningExcluded: 'No accepted takeoff quantity',
    placement: 'inferred', specs: [], issues: ['Top inferred from adjacent strip'],
    sources: [{ kind: 'spec', id: 'add5', page: 21, label: 'Addendum 5 S1.0', quote: 'MF3 6200 x 1500 x 400' }],
    shape: { type: 'run', points: [[0, 0], [6.2, 0]], z0: -.65, thickness: 1.5, height: .4 },
  };
  const model: BuildModel = { version: 1, sourceHash: '', units: 'metric', elements: [], drawingGeometry: [candidate],
    levels: [{ id: 'ground', name: 'Ground', elevation: 0, basis: 'documented', sheets: ['s1'] }], issues: [], extent: [0, 0, 6.2, 1.5] };
  const setup = defaultSetup(model, [], '2026-11-02');
  const activities = planActivities(model, setup, [], []);
  expect(activities.flatMap(a => a.elements)).not.toContain(candidate.id);
  // Even a stale external schedule reference must never assign the unaccepted candidate.
  const stale: Activity = { id: 'stale', name: 'Stale work', kind: 'work', trade: 'foundations', level: 'ground',
    elements: [candidate.id], duration: 1, durationBasis: 'assumed', durationWhy: 'Test', deps: [], specs: [], sources: [] };
  const before = JSON.stringify({ model, project });
  const ifc = toIfc({ model, project, sections: [], schedule: schedule([stale], setup) });
  expect(ifc).toContain(ifcGuid(candidate.id));
  expect(ifc).toContain('IFCEXTRUDEDAREASOLID');
  expect(ifc).toContain('Not accepted takeoff');
  expect(ifc).toContain('Addendum 5 S1.0, page 21: MF3 6200 x 1500 x 400');
  expect(ifc).not.toContain('IFCELEMENTQUANTITY(');
  expect(ifc).not.toContain("'Quantity'");
  expect(ifc).not.toContain('IFCRELASSIGNSTOPROCESS(');
  expect(ifc).not.toContain("'ScheduledStart'");
  expect(JSON.stringify({ model, project })).toBe(before);
  const withdrawn = toIfc({ model: { ...model, drawingGeometry: [] }, project, sections: [], schedule: null });
  expect(withdrawn).not.toContain(ifcGuid(candidate.id));
});
