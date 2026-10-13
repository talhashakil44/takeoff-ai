import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { findLegendAreas, readLegend } from '../src/fill/legend';
import { buildWallModel } from '../src/fill/roomFill';
import { findSimilar } from '../src/fill/similar';
import { fillRooms, findDoorTags, findRoomLabels } from '../src/fill/rooms';
import { extractSegments } from '../src/fill/vectors';
import { ringArea } from '../src/geometry';
import type { Sheet } from '../src/model';
import { pageTexts } from '../src/pageText';
import { inspectPage, type PDFPageProxy } from '../src/pdf';
import { samplePlanPdf } from '../src/samplePlan';
import { readFinishSchedule } from '../src/finishSchedule';
import { checkScale } from '../src/scaleCheck';
import { parseScale } from '../src/units';
import { sheetWallTakeoff } from '../src/walls/sheetWallTakeoff';
import { lengthsByType } from '../src/walls/wallTakeoff';

// src/pdf.ts points pdf.js at the bundled worker URL, which only the app serves.
GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;

// The sample plan doubles as an end-to-end check of the readers on a known drawing.
describe('sample plan', () => {
  it('reads as a 1:100 sheet with five rooms, five doors and two wall types', async () => {
    const doc = await getDocument({ data: await samplePlanPdf() }).promise;
    const page = (await doc.getPage(1)) as unknown as PDFPageProxy;
    const info = await inspectPage(page);
    expect(info.name).toBe('A1.01');
    expect(info.scaleHints).toEqual(['1:100']);
    const mpp = parseScale('1:100')!;

    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const segs = extractSegments(ops.fnArray, ops.argsArray, vp.transform as never);
    const texts = await pageTexts(page);
    const scale = checkScale(texts, segs, 'metric')!;
    expect(scale.label).toBe('1:100');
    expect(scale.agree).toBeGreaterThanOrEqual(5);

    const rooms = fillRooms(buildWallModel(segs, mpp), findRoomLabels(texts, segs), vp.width, vp.height);
    const areas = Object.fromEntries(rooms.map((r) => [r.labels[0].number, +(ringArea(r.points ?? []) * mpp * mpp).toFixed(1)]));
    expect(areas).toEqual({ '101': 62.9, '102': 30.7, '103': 30.7, '104': 30.7, '105': 30.7 });
    // Doorways along each room's outline: the lobby's four doors and the entry, one door elsewhere.
    const doorways: Record<string, number> = { '101': 5.4, '102': 0.9, '103': 0.9, '104': 0.9, '105': 0.9 };
    for (const r of rooms) expect(Math.abs((r.openings ?? 0) * mpp - doorways[r.labels[0].number])).toBeLessThan(0.15);

    expect(findDoorTags(texts, segs).map((d) => d.number).sort()).toEqual(['101', '102', '103', '104', '105']);

    const schedule = readFinishSchedule(texts)!;
    expect(schedule.rows.map((r) => [r.number, r.name, r.finishes.floor, r.finishes.base, r.finishes.walls, r.finishes.ceiling])).toEqual([
      ['101', 'LOBBY', 'POR-1', 'RB-1', 'PT-2', 'GWB-1'],
      ['102', 'OFFICE', 'CPT-1', 'RB-1', 'PT-1', 'ACT-1'],
      ['103', 'OFFICE', 'CPT-1', 'RB-1', 'PT-1', 'ACT-1'],
      ['104', 'MEETING ROOM', 'CPT-1', 'RB-1', 'PT-1', 'ACT-1'],
      ['105', 'STORAGE', 'SC-1', 'RB-1', 'PT-1', 'GWB-1'],
    ]);

    const sheet = { id: 's', docId: 'd', page: 1, name: 'A1.01', width: vp.width, height: vp.height, metersPerPoint: mpp, scaleLabel: '1:100', scaleSource: 'preset', scaleHints: [] } as Sheet;
    const walls = lengthsByType((await sheetWallTakeoff(page, sheet, 3, true)).runs, mpp);
    expect(Math.round(walls.get('EW1')!.length)).toBe(58);
    expect(Math.round(walls.get('W1')!.length)).toBe(34);
  }, 60000);

  it('reads the imperial version at 1/8" = 1\'-0" from its feet-and-inch dimensions', async () => {
    const doc = await getDocument({ data: await samplePlanPdf('imperial') }).promise;
    const page = (await doc.getPage(1)) as unknown as PDFPageProxy;
    const info = await inspectPage(page);
    expect(info.scaleHints).toEqual(['1/8" = 1\'-0"']);
    const mpp = parseScale(info.scaleHints[0])!;
    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const segs = extractSegments(ops.fnArray, ops.argsArray, vp.transform as never);
    const texts = await pageTexts(page);
    const scale = checkScale(texts, segs, 'imperial')!;
    expect(scale.label).toBe('1/8" = 1\'-0"');
    expect(scale.agree).toBeGreaterThanOrEqual(5);
    // Read with a metric project too: the dimensions decide, not the project's units.
    expect(checkScale(texts, segs, 'metric')!.label).toBe('1/8" = 1\'-0"');

    const sf = (pts: number) => +((pts * mpp * mpp) / 0.09290304).toFixed(1);
    const rooms = fillRooms(buildWallModel(segs, mpp), findRoomLabels(texts, segs), vp.width, vp.height);
    const areas = Object.fromEntries(rooms.map((r) => [r.labels[0].number, sf(ringArea(r.points ?? []))]));
    expect(areas).toEqual({ '101': 698.8, '102': 341.6, '103': 341.6, '104': 341.6, '105': 341.6 });

    const sheet = { id: 's', docId: 'd', page: 1, name: 'A1.01', width: vp.width, height: vp.height, metersPerPoint: mpp, scaleLabel: info.scaleHints[0], scaleSource: 'preset', scaleHints: [] } as Sheet;
    const walls = lengthsByType((await sheetWallTakeoff(page, sheet, 3, true)).runs, mpp);
    expect(walls.get('EW1')!.length / 0.3048).toBeCloseTo(193.3, 0);
    expect(walls.get('W1')!.length / 0.3048).toBeCloseTo(113.3, 0);
  }, 60000);

  it('reads the ceiling plan: its legend, every downlight, and the ACT rooms from one', async () => {
    const doc = await getDocument({ data: await samplePlanPdf() }).promise;
    const page = (await doc.getPage(2)) as unknown as PDFPageProxy;
    expect((await inspectPage(page)).name).toBe('A2.01');
    const mpp = parseScale('1:100')!;
    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const segs = extractSegments(ops.fnArray, ops.argsArray, vp.transform as never);
    const texts = await pageTexts(page);

    const legend = readLegend(texts, segs, [725, 195, 905, 340]);
    expect(legend.map((r) => [r.label, r.kind])).toEqual([
      ['ACT-1 ACOUSTIC TILE, 2X4 GRID', 'area'],
      ['GWB-1 PAINTED GYPSUM BOARD', 'area'],
      ['DOWNLIGHT', 'count'],
    ]);
    expect(legend[2].found?.length).toBe(22);
    // The GWB swatch is a stipple dense enough to sample: it finds the lobby and storage.
    findLegendAreas(legend, segs, [725, 195, 905, 340], vp.width, vp.height, mpp);
    expect((legend[1].areas ?? []).map((a) => +(a.area * mpp * mpp).toFixed(1)).sort()).toEqual([30.7, 62.9]);
    // The ACT swatch shows only two grid lines each way, enough for a swatch.
    expect((legend[0].areas ?? []).map((a) => +(a.area * mpp * mpp).toFixed(1)).sort()).toEqual([30.7, 30.7, 30.7]);

    const model = buildWallModel(segs, mpp);
    const rooms = fillRooms(model, findRoomLabels(texts, segs), vp.width, vp.height);
    const office = rooms.find((r) => r.labels[0].number === '102')!;
    const act = findSimilar(segs, model, office.points!, vp.width, vp.height);
    const m2 = act.areas.map((a) => +(a.area * mpp * mpp).toFixed(1)).sort();
    // The other office and the meeting room (the sample's own room is already taken off).
    expect(m2).toEqual([30.7, 30.7]);
    const lobby = rooms.find((r) => r.labels[0].number === '101')!;
    const gwb = findSimilar(segs, model, lobby.points!, vp.width, vp.height);
    expect(gwb.areas.map((a) => +(a.area * mpp * mpp).toFixed(1))).toEqual([30.7]);
  }, 60000);

  it('fills rooms and takes off walls drawn as solid poché, with no outlines', async () => {
    const doc = await getDocument({ data: await samplePlanPdf('metric', { walls: 'poche' }) }).promise;
    const page = (await doc.getPage(1)) as unknown as PDFPageProxy;
    const mpp = parseScale('1:100')!;
    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const segs = extractSegments(ops.fnArray, ops.argsArray, vp.transform as never);
    const texts = await pageTexts(page);
    const model = buildWallModel(segs, mpp);
    expect(model.pens).toEqual(['fill']);
    const rooms = fillRooms(model, findRoomLabels(texts, segs), vp.width, vp.height);
    const areas = Object.fromEntries(rooms.map((r) => [r.labels[0].number, +(ringArea(r.points ?? []) * mpp * mpp).toFixed(1)]));
    expect(areas).toEqual({ '101': 62.9, '102': 30.7, '103': 30.7, '104': 30.7, '105': 30.7 });
    const sheet = { id: 's', docId: 'd', page: 1, name: 'A1.01', width: vp.width, height: vp.height, metersPerPoint: mpp, scaleLabel: '1:100', scaleSource: 'preset', scaleHints: [] } as Sheet;
    const walls = lengthsByType((await sheetWallTakeoff(page, sheet, 3, true)).runs, mpp);
    expect(Math.round(walls.get('EW1')?.length ?? 0)).toBe(58);
    expect(Math.round(walls.get('W1')?.length ?? 0)).toBe(34);
  }, 60000);

  it('takes off every floor finish from the finish plan legend', async () => {
    const doc = await getDocument({ data: await samplePlanPdf() }).promise;
    const page = (await doc.getPage(3)) as unknown as PDFPageProxy;
    expect((await inspectPage(page)).name).toBe('A1.02');
    const mpp = parseScale('1:100')!;
    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const segs = extractSegments(ops.fnArray, ops.argsArray, vp.transform as never);
    const texts = await pageTexts(page);
    const box: [number, number, number, number] = [725, 195, 1000, 430];
    const legend = readLegend(texts, segs, box);
    expect(legend.map((r) => [r.label, r.kind])).toEqual([
      ['POR-1 PORCELAIN TILE 300X300', 'area'],
      ['CPT-1 CARPET TILE', 'area'],
      ['SC-1 SEALED CONCRETE', 'area'],
    ]);
    findLegendAreas(legend, segs, box, vp.width, vp.height, mpp);
    const m2 = (r: (typeof legend)[number]) => (r.areas ?? []).map((a) => +(a.area * mpp * mpp).toFixed(1)).sort();
    expect(m2(legend[0])).toEqual([62.9]);
    expect(m2(legend[1])).toEqual([30.7, 30.7, 30.7]);
    expect(m2(legend[2])).toEqual([30.7]);
    // Rooms found by their hatch keep their doorways, as Fill and Rooms do.
    const lobby = legend[0].areas![0];
    expect(Math.abs((lobby.openings ?? 0) * mpp - 5.4)).toBeLessThan(0.15);
  }, 60000);

  // Two export styles seen in the wild: sheets saved turned (/Rotate) and drawings printed
  // without lineweights (every line one pen, so room and door tags sit in the wall pen).
  for (const [style, options, tolerance] of [
    ['a sheet saved turned a quarter', { rotate: 90 }, 0],
    ['a drawing printed without lineweights', { onePen: true }, 0.02],
    ['walls exploded into short pieces', { pieces: 0.5 }, 0],
    ['text written one character at a time', { charByChar: true }, 0],
    ['room numbers printed without a box', { bareRoomNumbers: true }, 0],
  ] as const) {
    it(`reads ${style}`, async () => {
      const doc = await getDocument({ data: await samplePlanPdf('metric', options) }).promise;
      const page = (await doc.getPage(1)) as unknown as PDFPageProxy;
      const mpp = parseScale('1:100')!;
      const vp = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList();
      const segs = extractSegments(ops.fnArray, ops.argsArray, vp.transform as never);
      const texts = await pageTexts(page);
      expect(checkScale(texts, segs, 'metric')!.agree).toBe(11);
      const rooms = fillRooms(buildWallModel(segs, mpp), findRoomLabels(texts, segs), vp.width, vp.height);
      const want: Record<string, number> = { '101': 62.89, '102': 30.74, '103': 30.74, '104': 30.74, '105': 30.74 };
      expect(rooms.map((r) => r.labels[0].number).sort()).toEqual(Object.keys(want));
      for (const r of rooms) {
        const area = ringArea(r.points ?? []) * mpp * mpp;
        // Door swings in the wall pen no longer come off the room (the lobby, with four, is exact);
        // a wall tag drawn in the wall pen still takes a little off its room (102, 105).
        expect(Math.abs(area / want[r.labels[0].number] - 1)).toBeLessThanOrEqual(tolerance + 0.002);
        // The lobby has four doors swinging into it: their swings and leaves stay in the room.
        if (r.labels[0].number === '101') expect(area).toBeCloseTo(62.89, 1);
      }
      expect(findDoorTags(texts, segs)).toHaveLength(5);
      const sheet = { id: 's', docId: 'd', page: 1, name: 'A1.01', width: vp.width, height: vp.height, metersPerPoint: mpp, scaleLabel: '1:100', scaleSource: 'preset', scaleHints: [] } as Sheet;
      const walls = lengthsByType((await sheetWallTakeoff(page, sheet, 3, true)).runs, mpp);
      expect(Math.round(walls.get('EW1')!.length)).toBe(58);
      expect(Math.round(walls.get('W1')!.length)).toBe(34);
    }, 60000);
  }
});
