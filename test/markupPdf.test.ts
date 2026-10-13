import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { markupPdf, safeText, toUser } from '../src/markupPdf';
import { newProject, type Sheet, defaultTypes } from '../src/model';
import { parseScale } from '../src/units';

const mpp = parseScale('1:100')!;

describe('marked-up PDF', () => {
  it('maps sheet points back to PDF user space', () => {
    // pdf.js at scale 1 on an upright 600 × 400 page flips y.
    expect(toUser([1, 0, 0, -1, 0, 400], [100, 50])).toEqual([100, 350]);
    // A page turned a quarter: x runs down the sheet.
    const [x, y] = toUser([0, 1, 1, 0, 0, 0], [30, 70]);
    expect([x, y]).toEqual([70, 30]);
  });

  it('copies the sheets with takeoffs after a summary page', async () => {
    const src = await PDFDocument.create();
    src.addPage([600, 400]);
    src.addPage([600, 400]);
    src.addPage([600, 400]);
    const bytes = await src.save();
    const p = { ...newProject('metric'), types: defaultTypes('metric') };
    p.name = 'Lodge – level 1 ²';
    const sheet = (id: string, page: number, docId = 'd'): Sheet => ({
      id,
      docId,
      page,
      name: `A${page}`,
      width: 600,
      height: 400,
      metersPerPoint: mpp,
      scaleLabel: '1:100',
      scaleSource: 'preset',
      scaleHints: [],
    });
    p.sheets = [sheet('s1', 1), sheet('s2', 2), sheet('s3', 3), sheet('s4', 1, 'gone')];
    const [w1, , floor, , doors] = p.types;
    p.measurements = [
      { id: 'a', sheetId: 's1', typeId: w1.id, points: [[10, 10], [200, 10]], holes: [] },
      { id: 'b', sheetId: 's1', typeId: floor.id, points: [[10, 10], [300, 10], [300, 200], [10, 200]], holes: [[[50, 50], [80, 50], [80, 80]]], label: 'Lobby 101' },
      { id: 'c', sheetId: 's3', typeId: doors.id, points: [[40, 40]], holes: [] },
      { id: 'd', sheetId: 's4', typeId: doors.id, points: [[40, 40]], holes: [] },
    ];
    const r = await markupPdf(p, {
      loadBytes: async (id) => (id === 'd' ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : undefined),
      transformOf: async (s) => [1, 0, 0, -1, 0, s.height],
    });
    expect(r.sheets).toBe(2);
    expect(r.missing).toEqual(['A1']);
    const out = await PDFDocument.load(r.bytes);
    expect(out.getPageCount()).toBe(3);
    expect(out.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
    expect(out.getPage(1).getSize()).toEqual({ width: 600, height: 400 });
  });

  it('writes numbers with locale spacing and drops what the font cannot draw', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    expect(safeText(font, '12\u202f346,5 m²')).toBe('12 346,5 m²');
    expect(safeText(font, 'Room 一 101')).toBe('Room  101');
  });

  it('copies resources the sheets share once', async () => {
    const src = await PDFDocument.create();
    const big = src.context.register(src.context.stream(new Uint8Array(200_000).map((_, i) => (i * 7919) % 251)));
    for (let i = 0; i < 3; i++) src.addPage([600, 400]).node.setXObject(PDFName.of('Shared'), big);
    const bytes = await src.save({ useObjectStreams: false });
    const p = { ...newProject('metric'), types: defaultTypes('metric') };
    const [, , floor] = p.types;
    p.sheets = [1, 2, 3].map((page) => ({
      id: `s${page}`,
      docId: 'd',
      page,
      name: `A${page}`,
      width: 600,
      height: 400,
      metersPerPoint: mpp,
      scaleLabel: '1:100',
      scaleSource: 'preset' as const,
      scaleHints: [],
    }));
    p.measurements = p.sheets.map((s) => ({ id: s.id, sheetId: s.id, typeId: floor.id, points: [[10, 10], [90, 10], [90, 90]], holes: [] }));
    const r = await markupPdf(p, {
      loadBytes: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      transformOf: async (s) => [1, 0, 0, -1, 0, s.height],
    });
    expect(r.sheets).toBe(3);
    expect(r.bytes.length).toBeLessThan(300_000);
  });
});
