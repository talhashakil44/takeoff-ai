import { describe, expect, it } from 'vitest';
import { ceilingsFromRcps, finishRooms, levelOfSheet } from '../src/automate/finishes';
import { newProject, type Measurement, type Project, type Sheet, type TakeoffType } from '../src/model';
import { typeTotals } from '../src/quantities';

const sheet = (id: string, title: string): Sheet => ({ id, docId: 'd', page: 1, name: id, title, width: 1000, height: 1000, metersPerPoint: 0.01, scaleLabel: null, scaleSource: null, scaleHints: [] });
const type = (id: string, name: string, kind: TakeoffType['kind'] = 'area'): TakeoffType => ({ id, name, color: '#888888', kind, height: 3, items: [] });
const box = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const m = (id: string, sheetId: string, typeId: string, label: string, extra: Partial<Measurement> = {}): Measurement =>
  ({ id, sheetId, typeId, points: box(0, 0, 100), holes: [], label, ...extra }) as Measurement;

function project(): Project {
  return {
    ...newProject('metric'),
    sheets: [sheet('p1', 'LEVEL 1 (LOWER) FLOOR PLAN'), sheet('r1', 'LEVEL 1 REFLECTED CEILING PLAN'), sheet('p2', 'LEVEL 2 (MAIN) FLOOR PLAN')],
    types: [type('rooms', 'Rooms'), type('act', 'ACT 1 – Ceiling'), type('exact', 'EX ACT – Ceiling'), type('floor', 'VPLK 1 – Floor finish'), type('rcp', 'ACT1 – ceiling'), type('paint', 'PTD – Wall finish', 'linear')],
    measurements: [
      m('a', 'p1', 'rooms', '014 OVERFLOW', { source: 'rooms', finishes: { floor: 'floor', ceiling: 'act', walls: 'paint' } }),
      m('b', 'p1', 'rooms', '001 CORRIDOR', { source: 'rooms', finishes: { floor: 'floor', ceiling: 'exact' } }),
      m('c', 'p2', 'rooms', '113 OFFICE', { source: 'rooms', finishes: { ceiling: 'act' } }),
      // An RCP area named for its rooms that an earlier finishes run wrongly finished as a room.
      m('d', 'r1', 'rcp', '014 OVERFLOW · h 8\'-0"', { source: 'ceilings', finishes: { floor: 'floor', ceiling: 'act' } }),
    ],
  };
}

describe('RCP ceilings and the finish schedule', () => {
  it('reads the level a sheet title names', () => {
    expect(levelOfSheet(sheet('x', 'LEVEL 2 (MAIN) FLOOR PLAN'))).toBe('2');
    expect(levelOfSheet(sheet('x', 'MAIN FLOOR REFLECTED CEILING PLAN'))).toBe('MAIN');
    expect(levelOfSheet(sheet('x', 'DETAILS'))).toBeNull();
  });

  it('ceiling areas are not rooms', () => {
    expect(finishRooms(project()).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('counts each ceiling and floor once', () => {
    const before = project();
    const floor = (p: Project) => typeTotals(p).find((t) => t.type.id === 'floor')?.primary ?? 0;
    expect(floor(before)).toBeCloseTo(3, 5); // two rooms and the RCP area: 1 m² each
    const { project: p, moved, existing } = ceilingsFromRcps(before);
    expect(floor(p)).toBeCloseTo(2, 5);
    // Level 1 has an RCP: its rooms' ceilings come from there. Level 2 has none: its schedule ceiling stays.
    expect(moved).toBe(2);
    expect(existing).toEqual(['001 CORRIDOR (EX ACT)']);
    const byId = new Map(p.measurements.map((x) => [x.id, x]));
    expect(byId.get('a')!.finishes).toEqual({ floor: 'floor', walls: 'paint' });
    expect(byId.get('c')!.finishes).toEqual({ ceiling: 'act' });
    expect(byId.get('d')!.finishes).toBeUndefined();
    // EX ACT is used by nothing now; ACT 1 still is (level 2).
    expect(p.types.map((t) => t.id)).toEqual(['rooms', 'act', 'floor', 'rcp', 'paint']);
  });

  it('keeps the schedule ceiling of a room no measured ceiling covers (a plain gypsum ceiling)', () => {
    const at = (id: string, x: number, label: string, extra: Partial<Measurement>) => ({ ...m(id, 'p1', 'rooms', label, extra), points: box(x, 0, 100) });
    const p: Project = {
      ...project(),
      measurements: [
        at('a', 0, '101 OFFICE', { source: 'rooms', finishes: { ceiling: 'act' } }),
        at('b', 200, '102 OFFICE', { source: 'rooms', finishes: { ceiling: 'act' } }),
        at('g', 400, '103 WASHROOM', { source: 'rooms', finishes: { ceiling: 'gyp' } }),
        // The RCP drawn where the plan is: tile over 101 and 102; 103 left plain.
        { ...m('r', 'r1', 'rcp', '', { source: 'ceilings' }), points: box(0, 0, 300) },
      ],
      types: [...project().types, type('gyp', 'GB – Ceiling')],
    };
    const { project: out, moved } = ceilingsFromRcps(p);
    expect(moved).toBe(2);
    expect(out.measurements.find((x) => x.id === 'g')!.finishes).toEqual({ ceiling: 'gyp' });
    expect(out.measurements.find((x) => x.id === 'a')!.finishes).toEqual({});
  });

  it('leaves a project without RCP ceilings alone', () => {
    const p = project();
    const none = { ...p, measurements: p.measurements.filter((x) => x.source !== 'ceilings') };
    expect(ceilingsFromRcps(none).project).toBe(none);
  });
});
