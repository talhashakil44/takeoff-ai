import { describe, expect, it } from 'vitest';
import { doorSheets, drawingFingerprint, linePlans, slimText, structuralSheets, markPolylineArcs, needsLines, needsText, packLines, slimLines, unpackLines } from '../src/build/sources';
import { sourceHashOf } from '../src/build/extract';
import { writtenDate } from '../src/build/facts';
import type { Segment } from '../src/fill/vectors';
import type { Project } from '../src/model';

const seg = (i: number, extra: Partial<Segment> = {}): Segment => ({ x1: i, y1: i * 2, x2: i + 10.123456789, y2: i * 3, width: 0.5, filled: false, color: '#000000', layer: 'A-WALL', sub: i, ...extra });

describe('Build It drawing evidence', () => {
  it('reads only the sheets the model uses', () => {
    const measured = new Set(['m']);
    expect(needsText({ id: 'm', title: 'GENERAL NOTES' }, measured)).toBe(true);
    expect(needsText({ id: 'a', title: 'SECOND FLOOR PLAN' }, measured)).toBe(true);
    expect(needsText({ id: 'b', title: 'NORTH ELEVATION' }, measured)).toBe(true);
    expect(needsText({ id: 'c', title: 'WINDOW SCHEDULE' }, measured)).toBe(true);
    expect(needsText({ id: 'd', title: '' }, measured)).toBe(true);
    expect(needsText({ id: 'e', title: 'ASSEMBLY TYPES' }, measured)).toBe(false);
    expect(needsText({ id: 'f', title: 'MILLWORK DETAILS' }, measured)).toBe(false);
    expect(needsLines({ title: 'BUILDING SECTIONS' })).toBe(true);
    expect(needsLines({ title: 'INTERIOR ELEVATIONS' })).toBe(false);
    // Structural sections and framing elevations: beam tops against the level heads.
    expect(needsLines({ name: 'S4.0', title: 'SECTIONS' })).toBe(true);
    expect(needsLines({ name: 'S3.1', title: 'ELEVATIONS' })).toBe(true);
    expect(needsLines({ name: 'S6.0', title: 'DETAILS' })).toBe(false);
    expect(needsLines({ name: 'A4.20', title: 'SECTION DETAILS' })).toBe(false);
    expect(needsLines({ name: 'M4.0', title: 'SECTIONS' })).toBe(false);
    // Plans with counted doors: their swing arcs host the doors.
    const doors = doorSheets({
      types: [{ id: 'd', name: 'Doors', kind: 'count' } as Project['types'][number], { id: 'w', name: 'Windows', kind: 'count' } as Project['types'][number]],
      measurements: [
        { id: '1', sheetId: 'p1', typeId: 'd', points: [], holes: [] },
        { id: '2', sheetId: 'p2', typeId: 'x', points: [], holes: [], source: 'doors' },
        { id: '3', sheetId: 'p3', typeId: 'w', points: [], holes: [] },
      ] as Project['measurements'],
    });
    expect([...doors].sort()).toEqual(['p1', 'p2']);
    expect(needsLines({ id: 'p1', title: 'GROUND FLOOR PLAN' }, doors)).toBe(true);
    expect(needsLines({ id: 'p3', title: 'GROUND FLOOR PLAN' }, doors)).toBe(false);
  });

  it('reads the linework of measured structural plans (lintel and beam strokes), not M/E/P foundation plans', () => {
    const sheet = (id: string, name: string, title: string) => ({ id, name, title }) as Project['sheets'][number];
    const project = {
      sheets: [sheet('s1', 'S2.0', 'FRAMING PLAN'), sheet('s2', 'A2.0', 'FOUNDATION PLAN'), sheet('s3', 'M1-01', 'FOUNDATION PLAN'), sheet('s4', 'S3.0', 'PLAN'), sheet('s5', 'A2.1', 'FLOOR PLAN')],
      measurements: ['s1', 's2', 's3', 's5'].map((sheetId, i) => ({ id: `${i}`, sheetId, typeId: 't', points: [], holes: [] })) as Project['measurements'],
    };
    expect([...structuralSheets(project)].sort()).toEqual(['s1', 's2']);
    const plans = linePlans({ ...project, types: [{ id: 't', name: 'Doors', kind: 'count' } as Project['types'][number]] });
    expect(plans.has('s5') && plans.has('s1') && !plans.has('s4')).toBe(true);
  });

  it('marks a door swing drawn as straight chords as curve pieces, not a rectangle or a short bend', () => {
    const chain = (pts: number[][], sub: number): Segment[] =>
      pts.slice(1).map((p, i) => ({ x1: pts[i][0], y1: pts[i][1], x2: p[0], y2: p[1], width: 0.5, filled: false, sub }));
    const arc = chain(Array.from({ length: 9 }, (_, k) => [30 * Math.cos((k * Math.PI) / 16), 30 * Math.sin((k * Math.PI) / 16)]), 1);
    const box = chain([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], 2);
    const bend = chain([[0, 0], [10, 0], [20, 1], [30, 3]], 3);
    const out = markPolylineArcs([...arc, ...box, ...bend]);
    expect(out.slice(0, 8).every((l) => l.curve)).toBe(true);
    expect(out.slice(8).some((l) => l.curve)).toBe(false);
  });

  it('keeps every line exactly, with its ink, without the fields the model never reads', () => {
    const lines = [seg(1), seg(2, { curve: true }), seg(3, { dashed: true, filled: true, color: '#ff8000' }), seg(4, { color: undefined })];
    const slim = slimLines(lines);
    expect(slim[1]).toEqual({ x1: 2, y1: 4, x2: 12.123456789, y2: 6, width: 0.5, filled: false, curve: true, color: '#000000' });
    expect(slim[2].color).toBe('#ff8000');
    expect('color' in slim[3]).toBe(false);
    expect(slim.every((l) => !('layer' in l) && !('sub' in l))).toBe(true);
    expect(unpackLines(packLines(slim))).toEqual(slim);
  });

  it('keeps a text\'s size and angle where the PDF gave them, and invents none', () => {
    expect(slimText({ str: 'B7', cx: 1, cy: 2, w: 9, h: 4, angle: -Math.PI / 2, extra: 1 } as never)).toEqual({ str: 'B7', cx: 1, cy: 2, w: 9, h: 4, angle: -Math.PI / 2 });
    expect(slimText({ str: 'B7', cx: 1, cy: 2, w: NaN, angle: undefined })).toEqual({ str: 'B7', cx: 1, cy: 2 });
  });

  it('fingerprints linework cheaply and still sees a different read', () => {
    const many = Array.from({ length: 200_000 }, (_, i) => seg(i));
    const t = performance.now();
    const a = drawingFingerprint({ s: [{ str: 'A', cx: 1, cy: 2 }] }, { s: many });
    expect(performance.now() - t).toBeLessThan(50);
    expect(drawingFingerprint({ s: [{ str: 'A', cx: 1, cy: 2 }] }, { s: many.slice(1) })).not.toBe(a);
    expect(drawingFingerprint({ s: [{ str: 'B', cx: 9, cy: 2 }] }, { s: many })).not.toBe(a);
    const project = { units: 'metric', sheets: [], types: [], measurements: [] } as unknown as Project;
    const h1 = sourceHashOf({ project, sections: [], drawingLines: { s: many }, floorToFloor: 3.6 });
    expect(sourceHashOf({ project, sections: [], drawingLines: { s: many.slice(5) }, floorToFloor: 3.6 })).not.toBe(h1);
  });
});

describe('written dates', () => {
  it('reads the day written, whatever the time zone', () => {
    expect(writtenDate('February 24, 2025')).toBe('2025-02-24');
    expect(writtenDate('Oct. 31 2025')).toBe('2025-10-31');
    expect(writtenDate('July 1, 2027')).toBe('2027-07-01');
    expect(writtenDate('February 29, 2028')).toBe('2028-02-29');
    expect(writtenDate('February 30, 2026')).toBeNull();
    expect(writtenDate('Smarch 3, 2026')).toBeNull();
  });
});
