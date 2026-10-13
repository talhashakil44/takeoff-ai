import { describe, expect, it } from 'vitest';
import { describeGroup, diffProjects, groupActivity } from '../src/activity';
import { newProject, type Measurement, type Project, type Sheet, defaultTypes } from '../src/model';

const sheet: Sheet = {
  id: 's1',
  docId: 'd1',
  page: 1,
  name: 'A2.1',
  width: 1000,
  height: 800,
  metersPerPoint: (100 * 0.0254) / 72,
  scaleLabel: '1:100',
  scaleSource: 'preset',
  scaleHints: [],
};

function base(): Project {
  const p = { ...newProject('metric'), types: defaultTypes('metric') };
  return { ...p, docs: [{ id: 'd1', name: 'set.pdf' }], sheets: [sheet] };
}

const floor = (p: Project) => p.types.find((t) => t.kind === 'area')!;
const square = (p: Project, id: string): Measurement => ({
  id,
  sheetId: 's1',
  typeId: floor(p).id,
  points: [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ],
  holes: [],
});

describe('activity log', () => {
  it('records takeoffs added, changed and deleted, with their quantity', () => {
    const p0 = base();
    const p1 = { ...p0, measurements: [square(p0, 'm1'), square(p0, 'm2')] };
    const added = diffProjects(p0, p1, 'Fill room');
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({ action: 'created', what: 'takeoff', sheet: 'A2.1', source: 'Fill room' });
    expect(added[0].detail).toMatch(/12\.\d m²/); // 100 pt square at 1:100 = 12.45 m²
    expect(new Set(added.map((e) => e.batch)).size).toBe(1);

    const m2 = { ...p1.measurements[1], points: p1.measurements[1].points.map(([x, y]) => [x * 2, y * 2] as [number, number]) };
    const p2 = { ...p1, measurements: [p1.measurements[0], m2] };
    expect(diffProjects(p1, p2, 'Fill room')).toMatchObject([{ action: 'updated', what: 'takeoff' }]);

    const p3 = { ...p2, measurements: [p2.measurements[1]] };
    expect(diffProjects(p2, p3, 'Delete')).toMatchObject([{ action: 'deleted', what: 'takeoff' }]);
  });

  it('records type and scale changes, and nothing when nothing changed', () => {
    const p0 = base();
    expect(diffProjects(p0, p0, 'x')).toEqual([]);
    const renamed = { ...p0, types: p0.types.map((t, i) => (i === 0 ? { ...t, name: 'W9' } : t)) };
    expect(diffProjects(p0, renamed, 'Edit type')[0]).toMatchObject({ action: 'updated', what: 'type', name: 'W9' });
    const rescaled = { ...p0, sheets: [{ ...sheet, scaleLabel: '1:50', metersPerPoint: (50 * 0.0254) / 72 }] };
    expect(diffProjects(p0, rescaled, 'Scale')[0]).toMatchObject({ what: 'sheet', detail: 'scale 1:50' });
  });

  it('groups a batch into one line, newest first', () => {
    const p0 = base();
    const p1 = { ...p0, measurements: [square(p0, 'a'), square(p0, 'b'), square(p0, 'c')] };
    const first = diffProjects(p0, p1, 'Wall takeoff', new Date('2026-01-01T10:00:00Z'));
    const second = diffProjects(p1, { ...p1, measurements: [] }, 'Delete', new Date('2026-01-01T11:00:00Z'));
    const groups = groupActivity([...first, ...second]);
    expect(groups).toHaveLength(2);
    expect(describeGroup(groups[0])).toBe('Deleted 3 takeoffs');
    expect(describeGroup(groups[1])).toBe('Added 3 takeoffs');
  });
});
