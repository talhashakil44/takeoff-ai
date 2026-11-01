import { describe, expect, it } from 'vitest';
import { automateRoof, isExteriorWall } from '../src/automate/envelope';
import { newProject, type Project } from '../src/model';

describe('roof from the exterior walls', () => {
  it('knows an exterior wall type by its name or description', () => {
    expect(isExteriorWall({ name: 'EW1A', kind: 'linear' })).toBe(true);
    expect(isExteriorWall({ name: 'W3', kind: 'linear', description: 'Exterior wall, brick veneer' })).toBe(true);
    expect(isExteriorWall({ name: 'IW2', kind: 'linear' })).toBe(false);
  });

  it('takes the outline the exterior walls enclose, with eaves', () => {
    const k = 0.035277777777777776;
    const m = (v: number) => v / k;
    const p: Project = {
      ...newProject('metric'),
      sheets: [{ id: 's1', name: 'A2.0', title: 'GROUND FLOOR PLAN', docId: 'd', page: 1, width: 2592, height: 1728, metersPerPoint: k } as never],
      types: [{ id: 'ew', name: 'EW1', kind: 'linear', color: '#000', height: 3 } as never],
      measurements: [
        { id: 'a', sheetId: 's1', typeId: 'ew', points: [[m(1), m(1)], [m(21), m(1)], [m(21), m(11)]], holes: [] },
        { id: 'b', sheetId: 's1', typeId: 'ew', points: [[m(21), m(11)], [m(1), m(11)], [m(1), m(1)]], holes: [] },
      ] as never,
    };
    const r = automateRoof(p);
    expect(r.apply).toBeTruthy();
    const q = r.apply!(p);
    const roof = q.measurements.find((x) => x.source === 'envelope')!;
    const area = Math.abs(roof.points.reduce((n, pt, i) => n + pt[0] * roof.points[(i + 1) % roof.points.length][1] - roof.points[(i + 1) % roof.points.length][0] * pt[1], 0)) / 2 * k * k;
    // 20 x 10 plus 0.3 m eaves all round ≈ 20.6 x 10.6
    expect(area).toBeGreaterThan(200);
    expect(area).toBeLessThan(235);
    expect(q.measurements).toHaveLength(3);
  });
});
