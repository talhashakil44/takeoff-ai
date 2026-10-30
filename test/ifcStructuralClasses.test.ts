import { expect, it } from 'vitest';
import { ifcClassOf } from '../src/build/ifcClass';
import type { BuildElement } from '../src/build/types';

const member = (typeName: string, fields: Partial<BuildElement> = {}): BuildElement => ({
  id: 'member', name: typeName, typeName, typeId: '', measurementId: 'member',
  division: '03', trade: 'structure', measurementSource: 'foundations', origin: 'takeoff',
  quantity: 1, unit: 'ea', level: 'ground', sheetId: 's1', specs: [], sources: [],
  placement: 'documented', issues: [],
  shape: { type: 'point', at: [0, 0], z: -.65, size: [1.5, 6.2, .4] }, ...fields,
});
it.each(['F1 – Pad footing', 'MF2 – Mass footing', 'MF3'])('classifies physical footing %s', name => {
  expect(ifcClassOf(member(name))).toEqual({ cls: 'IFCFOOTING', tail: ',.PAD_FOOTING.' });
});
it('classifies source-only MF3 and strip runs without treating foundations as walls', () => {
  expect(ifcClassOf(member('MF3', { origin: 'drawing', quantity: 0, unit: '' })).cls).toBe('IFCFOOTING');
  expect(ifcClassOf(member('SF-2 – Strip footing', { shape: { type: 'run', points: [[0, 0], [3, 0]], z0: -.65, height: .3, thickness: .9 } })))
    .toEqual({ cls: 'IFCFOOTING', tail: ',.STRIP_FOOTING.' });
});
it.each(['P2 – Concrete pier 480 x 800', 'C1 – Column 265 x 342'])('classifies physical %s as column', name => {
  expect(ifcClassOf(member(name))).toEqual({ cls: 'IFCCOLUMN', tail: ',.COLUMN.' });
});
it('does not promote unresolved counts, equipment tags, demolition, or arbitrary P codes', () => {
  for (const shape of [null, { type: 'locator' as const, at: [0, 0] as [number, number], z: 0 }, { type: 'axis' as const, points: [[0, 0], [1, 0]] as [number, number][], z: 0 }])
    expect(ifcClassOf(member('MF3', { shape })).cls).toBe('IFCBUILDINGELEMENTPROXY');
  for (const e of [member('F1', { trade: 'specialties', measurementSource: 'equipment' }), member('C1 Column', { trade: 'demolition' }), member('P2')])
    expect(['IFCFOOTING', 'IFCCOLUMN']).not.toContain(ifcClassOf(e).cls);
});
