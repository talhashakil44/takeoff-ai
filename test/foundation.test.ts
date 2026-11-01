import { describe, expect, it } from 'vitest';
import { findRoot, maxOf, minOf, pushAll } from '../src/arrays';
import { scalesFromSet } from '../src/automate/sheets';
import { simplify } from '../src/fill/raster';
import type { Sheet } from '../src/model';
import type { PageText } from '../src/pageText';
import { classifySet, classifySheet, hasCeilingPlan } from '../src/sheetKind';
import { drawingTitles, mainDrawingScale, scaleHintsOf, scaleNotes, viewTitle } from '../src/sheetScale';
import { parseScale } from '../src/units';

const text = (str: string, cx: number, cy: number, h = 5): PageText => ({ str, cx, cy, w: str.length * h * 0.6, h, angle: 0 });

describe('sheets sorted as an estimator sorts a set', () => {
  const kind = (title: string, name = 'A101') => {
    const k = classifySheet({ name, title });
    return `${k.kind}${k.level ? ` ${k.level}` : ''}${k.ceilings ? ' +ceilings' : ''}`;
  };

  it('finds reflected ceiling plans however they are titled', () => {
    expect(kind('REFLECTED CEILING PLAN')).toBe('RCP');
    expect(kind('GROUND FLOOR RCP')).toBe('RCP');
    expect(kind('Ceiling Plan')).toBe('RCP');
    expect(kind('RCP GROUND FLOOR PLAN')).toBe('RCP');
    expect(kind('PHASE 2 - OFFICES CEILING - DEMOLITION PLAN')).toBe('RCP');
    // A floor plan drawn as the RCP too: a floor plan the ceilings are read off as well.
    expect(kind('GROUND FLOOR PLAN & RCP')).toBe('floor plan level +ceilings');
    expect(hasCeilingPlan({ name: 'A2.1', title: 'GROUND FLOOR PLAN & RCP' })).toBe(true);
    // An RCP legend is a legend.
    expect(kind('LEGEND - RCP')).toBe('legend');
  });

  it('reads a title naming several drawings by the plan it names', () => {
    expect(kind('GROUND FLOOR PLAN & FINISHES SCHEDULE')).toBe('floor plan level');
    expect(kind('ROOF PLAN AND CANOPY DETAILS')).toBe('floor plan roof');
    expect(kind('ROOM FINISH PLAN AND SCHEDULE')).toBe('finish plan');
    expect(kind('PLAN AND SECTION DETAILS')).toBe('other');
    expect(kind('DOOR AND SCREEN SCHEDULE')).toBe('schedule');
    expect(kind('STAIRS - PLANS, SECTIONS & ELEVATIONS')).toBe('other');
  });

  it('takes a washroom layout as an enlarged plan, and as the floor plan of a set with no other', () => {
    expect(classifySheet({ name: 'A101', title: 'PROPOSED WASHROOM LAYOUTS' })).toMatchObject({ kind: 'floor plan', level: 'enlarged' });
    // A trade's layout stays a trade drawing.
    expect(classifySheet({ name: 'A101', title: 'LIGHTING LAYOUT' }).kind).toBe('other');
    const set = [
      { name: 'A100', title: 'SITE PLAN & PROJECT NOTES' },
      { name: 'A101', title: 'PROPOSED WASHROOM LAYOUTS' },
    ];
    expect(classifySet(set).map((k) => `${k.kind} ${k.level ?? ''}`.trim())).toEqual(['other', 'floor plan level']);
    // With a plan of the level, the layouts stay enlarged plans (walls only).
    expect(classifySet([{ name: 'A100', title: 'OVERALL FLOOR PLAN' }, set[1]!])[1]).toMatchObject({ level: 'enlarged' });
  });

  it('tells finish plans from floor plans', () => {
    expect(kind('FIRST FLOOR PLAN FINISHES')).toBe('finish plan');
    expect(kind('SECOND FLOOR PLAN - PAINT COLOURS')).toBe('finish plan');
    expect(kind('Basement Floor Finishes Plan')).toBe('finish plan');
    expect(kind('FINISHES & MILLWORK - FLOOR PLAN')).toBe('finish plan');
    expect(kind('PHASE 1 - FINISHES + FURNITURE PLAN')).toBe('finish plan');
  });

  it('leaves the trades\' plans out by their sheet number', () => {
    expect(kind('GROUND FLOOR PLAN', 'M1.1')).toBe('other');
    expect(kind('FOUNDATION PLAN', 'S1.1')).toBe('other');
    expect(kind('LIGHTING RCP', 'E-201')).toBe('other');
    expect(kind('S2.01 – Foundation Plan', 'Page 18')).toBe('other');
    // Architectural and interiors numbering in any style.
    expect(kind('GROUND FLOOR PLAN', 'A-201')).toBe('floor plan level');
    expect(kind('GROUND FLOOR PLAN', 'A2.1')).toBe('floor plan level');
    expect(kind('REFLECTED CEILING PLAN', 'A501')).toBe('RCP');
    expect(kind('PLAN', 'ID1.0')).toBe('floor plan level');
    expect(kind('GROUND FLOOR PLAN', '311')).toBe('floor plan level');
  });

  it('takes a sheet\'s title from its biggest drawing title, not a note or a callout key', () => {
    expect(viewTitle([text('Revise vent location on the roof plan.', 0, 0, 9), text('GROUND FLOOR PLAN', 0, 50, 7)])).toBe('GROUND FLOOR PLAN');
    expect(viewTitle([text('B - DETAIL NO. ORIGIN', 0, 0, 9), text('SECOND FLOOR PLAN', 0, 50, 7)])).toBe('SECOND FLOOR PLAN');
  });
});

describe('the scale of a sheet noting several', () => {
  // A roof plan at 1:50 with a detail at 1:25 beside it, each scale under its title; the title
  // block names the sheet.
  const roof = [
    text('PROPOSED ROOF PLAN', 1500, 1700, 14),
    text('PROPOSED ROOF PLAN', 400, 1000, 9),
    text('SCALE: 1:50', 400, 1014, 9),
    text('PLAN DETAIL OF ROOF PERIMETER EDGE FLASHING', 400, 1400, 9),
    text('SCALE: 1:25', 400, 1414, 9),
  ];

  it('finds each note and where it is', () => {
    const notes = scaleNotes(roof);
    expect(notes.map((n) => n.label).sort()).toEqual(['1:25', '1:50']);
    expect(drawingTitles(roof)[0].str).toBe('PROPOSED ROOF PLAN');
  });

  it('takes the scale under the drawing the sheet is titled for', () => {
    expect(mainDrawingScale(['1:25', '1:50'], roof, null, 'metric', 'PROPOSED ROOF PLAN')?.label).toBe('1:50');
    // Listed the other way round, or the detail drawn first: the same.
    const swapped = roof.map((t) => (t.cy === 1014 ? { ...t, cy: 1414 } : t.cy === 1414 ? { ...t, cy: 1014 } : t.cy === 1000 ? { ...t, cy: 1400 } : t.cy === 1400 ? { ...t, cy: 1000 } : t));
    expect(mainDrawingScale(['1:25', '1:50'], swapped, null, 'metric', 'PROPOSED ROOF PLAN')?.label).toBe('1:50');
  });

  it('takes the plan\'s scale over a detail\'s when the sheet title does not say', () => {
    const page = [text('GROUND FLOOR PLAN', 400, 1000, 9), text('1/8" = 1\'-0"', 400, 1014, 7), text('DETAIL 3', 1400, 400, 9), text('1/2" = 1\'-0"', 1400, 414, 7)];
    expect(mainDrawingScale(['1/8" = 1\'-0"', '1/2" = 1\'-0"'], page, null, 'imperial')?.label).toBe('1/8" = 1\'-0"');
  });

  it('reads an imperial note whose "=" is drawn as linework', () => {
    const page = [text('3/16"', 100, 100), text('1\'-0"', 125, 100)];
    expect(scaleHintsOf(page)).toEqual(['3/16" = 1\'-0"']);
    // A dimension string beside a size is not one.
    expect(scaleHintsOf([text('12\'-3 1/4"', 100, 100), text('1\'-0"', 140, 100)])).toEqual([]);
  });

  it('scales a ceiling plan noting none like its level\'s floor plan', () => {
    const sheet = (id: string, title: string, label: string | null): Sheet => ({ id, docId: 'd', page: 1, name: id, title, width: 3000, height: 2000, metersPerPoint: label ? parseScale(label) : null, scaleLabel: label, scaleSource: label ? 'detected' : null, scaleHints: label ? [label] : [] });
    const out = scalesFromSet([sheet('A2.1', 'GROUND FLOOR PLAN', '1:50'), sheet('A2.2', 'SECOND FLOOR PLAN', '1:100'), sheet('A3.1', 'GROUND FLOOR RCP', null), sheet('A3.2', 'REFLECTED CEILING PLAN', null), sheet('A5.1', 'WALL SECTIONS', null)]);
    expect(out[2].scaleLabel).toBe('1:50');
    // No level to go by and the plans differ: left for the estimator.
    expect(out[3].scaleLabel).toBeNull();
    expect(out[4].scaleLabel).toBeNull();
  });
});

describe('dense sheets', () => {
  it('handles arrays far past the argument limit', () => {
    const big = Array.from({ length: 300000 }, (_, i) => (i * 7919) % 300001);
    expect(maxOf(big)).toBe(big.reduce((m, v) => (v > m ? v : m), -Infinity));
    expect(() => Math.max(...big)).toThrow(RangeError);
    expect(minOf(big)).toBe(0);
    expect(maxOf([])).toBe(-Infinity);
    expect(minOf([1, NaN, 3])).toBeNaN();
    expect(pushAll([1], big).length).toBe(300001);
    // A union-find chain 300000 long.
    const parent = Array.from({ length: 300000 }, (_, i) => Math.max(0, i - 1));
    expect(findRoot(parent, 299999)).toBe(0);
    expect(parent[299999]).toBe(0);
  });

  it('simplifies a long staircase outline without recursion', () => {
    // A pixel staircase 200000 steps long, closed back along the axes.
    const pts: [number, number][] = [];
    for (let i = 0; i < 100000; i++) pts.push([i, i], [i + 1, i]);
    pts.push([100000, 0]);
    const out = simplify(pts, 0.75);
    expect(out.length).toBeLessThan(10);
    expect(out[0]).toEqual([0, 0]);
  });
});
