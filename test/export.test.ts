import { describe, expect, it } from 'vitest';
import { buildWorkbook } from '../src/exportExcel';
import { newProject, type Project, type Sheet, defaultTypes } from '../src/model';
import { parseScale } from '../src/units';

const mpp = parseScale('1:100')!;
const pts = (meters: number) => meters / mpp;

function sampleProject(): Project {
  const p = { ...newProject('metric'), types: defaultTypes('metric') };
  p.name = 'Kelso test';
  const sheet = (id: string, name: string, scaled = true): Sheet => ({
    id,
    docId: 'd',
    page: 1,
    name,
    width: 2592,
    height: 1728,
    metersPerPoint: scaled ? mpp : null,
    scaleLabel: scaled ? '1:100' : null,
    scaleSource: scaled ? 'preset' : null,
    scaleHints: [],
  });
  p.sheets = [sheet('s1', 'A2.1'), sheet('s2', 'A2.2'), sheet('s3', 'A9.1', false)];
  const [w1, , floor, , doors] = p.types;
  w1.height = 3;
  p.types.push({ id: 'misc', name: 'Curb', color: '#000', kind: 'linear', height: 0, items: [] });
  p.measurements = [
    { id: 'a', sheetId: 's1', typeId: w1.id, points: [[0, 0], [pts(10), 0]], holes: [] },
    { id: 'b', sheetId: 's1', typeId: w1.id, points: [[0, 0], [0, pts(5)]], holes: [] },
    { id: 'c', sheetId: 's2', typeId: w1.id, points: [[0, 0], [pts(4), 0]], holes: [] },
    { id: 'd', sheetId: 's3', typeId: w1.id, points: [[0, 0], [100, 0]], holes: [] },
    {
      id: 'e',
      sheetId: 's1',
      typeId: floor.id,
      points: [[0, 0], [pts(10), 0], [pts(10), pts(8)], [0, pts(8)]],
      holes: [],
    },
    { id: 'f', sheetId: 's1', typeId: doors.id, points: [[5, 5]], holes: [] },
    { id: 'g', sheetId: 's1', typeId: doors.id, points: [[9, 9]], holes: [] },
    { id: 'h', sheetId: 's2', typeId: 'misc', points: [[0, 0], [pts(2), 0]], holes: [] },
  ];
  return p;
}

const formulaOf = (v: unknown) => (v as { formula?: string })?.formula;

describe('buildWorkbook', () => {
  it('creates a Bid Summary, one tab per division, and detail sheets', async () => {
    const wb = await buildWorkbook(sampleProject());
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Bid Summary',
      '06 Wood Framing & Partitions',
      '08 Openings',
      '09 Finishes',
      'Unassigned',
      'Assembly Materials',
      'Measurements',
    ]);
  });

  it('writes division rows with the bid workbook columns, groups and subtotal', async () => {
    const wb = await buildWorkbook(sampleProject());
    const ws = wb.getWorksheet('06 Wood Framing & Partitions')!;
    expect(ws.getCell('A1').value).toBe('06 - WOOD FRAMING & PARTITIONS');
    expect(ws.getRow(4).values).toContain('Qty for pricing (IMPERIAL)');
    // FR1 has no measurements, so the Drywall & framing group holds W1's three sheet rows.
    expect(ws.getCell('A5').value).toBe('GRP');
    expect(ws.getCell('B5').value).toBe('GROUP - Drywall & framing sub');
    expect(formulaOf(ws.getCell('Q5').value)).toBe('SUM(Q6:Q8)');
    expect([6, 7, 8].map((r) => ws.getCell(`E${r}`).value)).toEqual(['A2.1', 'A2.2', 'A9.1']);
    expect(ws.getCell('A6').value).toBe('W1');
    expect(ws.getCell('G6').value).toBe(2);
    expect(ws.getCell('H6').value as number).toBeCloseTo(15);
    expect(ws.getCell('I6').value).toBe('M');
    expect(ws.getCell('J6').value).toBe(3);
    expect(formulaOf(ws.getCell('Q6').value)).toBe('K6*O6*P6');
    // The unscaled sheet shows zero with a note rather than a guess.
    expect(ws.getCell('H8').value).toBe(0);
    expect(String(ws.getCell('U8').value)).toContain('no scale');
    expect(ws.getCell('B9').value).toBe('06 - WOOD FRAMING & PARTITIONS  -  SUBTOTAL');
    expect(formulaOf(ws.getCell('Q9').value)).toBe('SUM(Q5:Q8)-SUMIF(P5:P8,"GRP",Q5:Q8)');
  });

  it('leaves height blank for linear types not priced by area', async () => {
    const wb = await buildWorkbook(sampleProject());
    const ws = wb.getWorksheet('Unassigned')!;
    expect(ws.getCell('B5').value).toBe('Curb');
    expect(ws.getCell('J5').value).toBeNull();
    expect(ws.getCell('H5').value as number).toBeCloseTo(2);
  });

  it('links the Bid Summary to each division subtotal', async () => {
    const wb = await buildWorkbook(sampleProject());
    const s = wb.getWorksheet('Bid Summary')!;
    expect(s.getCell('A5').value).toBe('06 - WOOD FRAMING & PARTITIONS');
    expect(formulaOf(s.getCell('B5').value)).toBe("'06 Wood Framing & Partitions'!Q9");
    expect(formulaOf(s.getCell('B8').value)).toBe("'Unassigned'!Q6");
    expect(formulaOf(s.getCell('E9').value)).toBe('SUM(E5:E8)');
  });
});

describe('room finishes in the workbook', () => {
  it('lists named rooms with their finishes, and counts them in the finish types', async () => {
    const p = sampleProject();
    const [, , floor, ceiling] = p.types;
    const room = p.measurements.find((m) => m.id === 'e')!;
    room.label = '101 LOBBY';
    room.finishes = { ceiling: ceiling.id };
    const wb = await buildWorkbook(p);
    const ws = wb.getWorksheet('Room Finishes')!;
    expect(ws.getRow(2).values).toEqual([undefined, '101 LOBBY', 'A2.1', expect.closeTo(80, 3), expect.closeTo(36, 3), undefined, '', '', '', 'Ceiling']);
    // The ceiling type carries the room's 80 m² on the finishes tab.
    const fin = wb.getWorksheet('09 Finishes')!;
    const rows = [...Array(fin.rowCount).keys()].map((i) => fin.getRow(i + 1));
    const ceil = rows.find((r) => r.getCell('B').value === 'Ceiling')!;
    expect(ceil.getCell('H').value as number).toBeCloseTo(80);
    expect(floor.name).toBe('Floor finish');
  });

  it('leaves out areas a legend found, which are a finish named by their room', async () => {
    const p = sampleProject();
    const room = p.measurements.find((m) => m.id === 'e')!;
    room.label = '101 LOBBY';
    p.measurements.push({ ...room, id: 'legend-area', label: '101 LOBBY', source: 'legend' });
    const ws = (await buildWorkbook(p)).getWorksheet('Room Finishes')!;
    expect(ws.rowCount).toBe(2);
  });
});
