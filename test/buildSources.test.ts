import { describe, expect, it } from 'vitest';
import { drawingFingerprint, needsLines, needsText, packLines, slimLines, unpackLines } from '../src/build/sources';
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
  });

  it('keeps every line exactly, without the fields the model never reads', () => {
    const lines = [seg(1), seg(2, { curve: true }), seg(3, { dashed: true, filled: true })];
    const slim = slimLines(lines);
    expect(slim[1]).toEqual({ x1: 2, y1: 4, x2: 12.123456789, y2: 6, width: 0.5, filled: false, curve: true });
    expect(slim.every((l) => !('color' in l) && !('layer' in l))).toBe(true);
    expect(unpackLines(packLines(slim))).toEqual(slim);
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
