import { describe, expect, it } from 'vitest';
import { disciplineOf, takeoffTree } from '../src/takeoffTree';
import type { Doc, Measurement, Sheet, TakeoffType } from '../src/model';

const doc = (id: string, name: string): Doc => ({ id, name }) as Doc;
const sheet = (id: string, docId: string, name: string, ocr = false): Sheet =>
  ({ id, docId, page: 1, name, width: 100, height: 100, metersPerPoint: null, scaleLabel: null, scaleSource: null, scaleHints: [], ...(ocr ? { ocr } : {}) }) as Sheet;
const type = (id: string): TakeoffType => ({ id, name: id, color: '#000', kind: 'count', height: 0, items: [] });
const m = (id: string, sheetId: string, typeId: string): Measurement => ({ id, sheetId, typeId, points: [[0, 0]], holes: [] });

describe('discipline of a sheet', () => {
  it('reads the sheet number first', () => {
    expect(disciplineOf({ name: 'A2-1' }, { name: '01 - Architectural.pdf' })).toBe('Architectural');
    expect(disciplineOf({ name: 'S1-1' }, { name: 'Drawings.pdf' })).toBe('Structural');
    expect(disciplineOf({ name: 'M3-1' }, { name: '04 - Mechanical.pdf' })).toBe('Mechanical');
    expect(disciplineOf({ name: 'E2-1' })).toBe('Electrical');
    expect(disciplineOf({ name: 'P-101' })).toBe('Plumbing');
    expect(disciplineOf({ name: 'C-1' })).toBe('Civil');
    expect(disciplineOf({ name: 'L1.01' })).toBe('Landscape');
    expect(disciplineOf({ name: 'FP-1' })).toBe('Mechanical');
  });

  it('falls back to the file name, then Other', () => {
    expect(disciplineOf({ name: 'Page 3' }, { name: '05 - Structural.pdf' })).toBe('Structural');
    expect(disciplineOf({ name: 'G-001' }, { name: 'Site servicing and grading' })).toBe('Civil');
    expect(disciplineOf({ name: 'Page 3' }, { name: 'Bid set.pdf' })).toBe('Other');
  });

  it('trusts the file over a number OCR read', () => {
    expect(disciplineOf({ name: 'S2', ocr: true }, { name: 'Architectural.pdf' })).toBe('Architectural');
  });
});

describe('takeoff tree', () => {
  const project = {
    docs: [doc('a', '01 - Architectural.pdf'), doc('s', '05 - Structural.pdf')],
    sheets: [sheet('a1', 'a', 'A2-1'), sheet('a2', 'a', 'A2-2'), sheet('s1', 's', 'S1-1')],
    types: [type('P-1'), type('F-1'), type('W1')],
  };

  it('groups by discipline, sheet and type in set order', () => {
    const list = [m('1', 's1', 'F-1'), m('2', 's1', 'P-1'), m('3', 'a1', 'W1'), m('4', 's1', 'P-1')];
    const tree = takeoffTree(project, list);
    expect(tree.map((d) => [d.discipline, d.count])).toEqual([
      ['Architectural', 1],
      ['Structural', 3],
    ]);
    const s = tree[1].sheets[0];
    expect(s.sheet.name).toBe('S1-1');
    expect(s.types.map((t) => [t.type.id, t.items.map((x) => x.id)])).toEqual([
      ['P-1', ['2', '4']],
      ['F-1', ['1']],
    ]);
    // Sheets with nothing on them are left out.
    expect(tree[0].sheets.map((x) => x.sheet.id)).toEqual(['a1']);
  });

  it('leaves out takeoffs whose type is gone', () => {
    expect(takeoffTree(project, [m('1', 'a1', 'nope')])).toEqual([]);
  });
});
