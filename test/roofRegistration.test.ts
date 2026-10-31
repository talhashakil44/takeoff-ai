import { expect, it } from 'vitest';
import { roofViewportRegistrations } from '../src/build/roofRegistration';
import type { Project } from '../src/model';
import type { BuildModel } from '../src/build/types';

const scale = (0.0254 / 72) * 100;
function fixture() {
  const letters = ['A', 'B', 'C'],
    nums = ['1', '2', '3'];
  const reference = [
    ...letters.map((str, i) => ({ str, cx: 200 + i * 200, cy: 100 })),
    ...nums.map((str, i) => ({ str, cx: 100, cy: 200 + i * 200 })),
  ];
  const roof = [
    ...letters.map((str, i) => ({ str, cx: 100, cy: 700 - i * 200 })),
    ...nums.map((str, i) => ({ str, cx: 300 + i * 200, cy: 100 })),
    { str: 'HIGH ROOF FRAMING PLAN', cx: 300, cy: 900 },
    { str: '1 : 100', cx: 300, cy: 920 },
  ];
  const project = {
    sheets: [
      {
        id: 'a',
        name: 'A1',
        title: 'FLOOR PLAN',
        width: 1000,
        height: 1000,
        metersPerPoint: scale,
      },
      {
        id: 's',
        name: 'S1',
        title: 'PLAN',
        width: 1000,
        height: 1000,
        metersPerPoint: null,
        page: 1,
      },
    ],
    measurements: [
      {
        id: 'anchor',
        sheetId: 'a',
        points: [
          [200, 200],
          [600, 200],
          [600, 600],
          [200, 600],
        ],
      },
      { id: 'roof-member', sheetId: 's', points: [[500, 500]] },
      { id: 'detail', sheetId: 's', points: [[50, 950]] },
    ],
  } as unknown as Project;
  const model = {
    elements: [
      {
        measurementId: 'anchor',
        shape: {
          type: 'surface',
          ring: [
            [200, 200],
            [600, 200],
            [600, 600],
            [200, 600],
          ].map(([x, y]) => [x * scale - 10, y * scale - 20]),
        },
      },
    ],
  } as unknown as BuildModel;
  return { project, model, texts: { a: reference, s: roof } };
}
it('registers a named roof viewport using printed scale and rotated grids without calibrating the sheet', () => {
  const f = fixture(),
    before = JSON.stringify(f.project),
    r = roofViewportRegistrations(f.project, f.model, f.texts);
  expect(r['roof-member']).toBeTruthy();
  expect(r.detail).toBeUndefined();
  const { frame } = r['roof-member'];
  // Source 500,500 is intersection B/2; reference intersection B/2 = 400,400.
  expect(frame.a * 500 - frame.b * 500 + frame.tx).toBeCloseTo(
    400 * scale - 10,
  );
  expect(frame.b * 500 + frame.a * 500 + frame.ty).toBeCloseTo(
    400 * scale - 20,
  );
  expect(JSON.stringify(f.project)).toBe(before);
  expect(r['roof-member'].source.quote).toContain('1:100');
});
it('rejects ambiguous printed scales and nonmatching grid spacing', () => {
  const f = fixture();
  f.texts.s.push({ str: '1 : 50', cx: 330, cy: 920 });
  expect(roofViewportRegistrations(f.project, f.model, f.texts)).toEqual({});
  const g = fixture();
  g.texts.s.find((t) => t.str === '2')!.cx += 50;
  expect(roofViewportRegistrations(g.project, g.model, g.texts)).toEqual({});
});
it('does not borrow calibration across another named roof viewport', () => {
  const f = fixture();
  f.texts.s.push(
    { str: 'LOW ROOF FRAMING PLAN', cx: 300, cy: 650 },
    { str: '1 : 50', cx: 300, cy: 670 },
  );
  expect(roofViewportRegistrations(f.project, f.model, f.texts)).toEqual({});
});
it('registers a compact low-roof viewport despite a nearby numbered section callout', () => {
  const f = fixture();
  f.project.sheets[1].width = 2600;
  f.project.sheets[1].height = 1728;
  f.texts.a = [
    ...['A', 'B', 'C'].map((str, i) => ({ str, cx: 200 + i * 105, cy: 100 })),
    ...['3', '4', '5', '6', '7'].map((str, i) => ({
      str,
      cx: 100,
      cy: 800 - i * 150,
    })),
  ];
  f.texts.s = [
    ...['A', 'B', 'C'].map((str, i) => ({ str, cx: 1000, cy: 200 + i * 105 })),
    ...['3', '4', '5', '6', '7'].map((str, i) => ({
      str,
      cx: 1100 + i * 150,
      cy: 82,
    })),
    { str: '3', cx: 1690, cy: 79.3 },
    { str: 'LOW ROOF FRAMING PLAN', cx: 1200, cy: 520 },
    { str: '1 : 100', cx: 1200, cy: 540 },
  ];
  f.project.measurements[1].points = [[1400, 305]];
  const r = roofViewportRegistrations(f.project, f.model, f.texts)[
    'roof-member'
  ];
  expect(r).toBeTruthy();
  expect(r.title).toBe('LOW ROOF FRAMING PLAN');
  expect(r.grids).toContain('3');
  expect(r.frame.a * 1400 - r.frame.b * 305 + r.frame.tx).toBeCloseTo(
    305 * scale - 10,
  );
  expect(r.frame.b * 1400 + r.frame.a * 305 + r.frame.ty).toBeCloseTo(
    500 * scale - 20,
  );
});
it('does not register canopy tags from only a single letter and number grid', () => {
  const f = fixture();
  f.texts.s = [
    { str: 'E', cx: 100, cy: 300 },
    { str: '3', cx: 400, cy: 100 },
    { str: 'CANOPY FRAMING PLAN', cx: 300, cy: 900 },
    { str: '1 : 50', cx: 300, cy: 920 },
  ];
  expect(roofViewportRegistrations(f.project, f.model, f.texts)).toEqual({});
});
it('registers a locally CANT-noted free end without expanding other viewport bounds',()=>{
 const f=fixture(),m=f.project.measurements[1];m.points=[[0,500],[500,500]];m.label='B2';
 f.texts.s.push({str:'B2',cx:400,cy:490},{str:'(CANT.)',cx:400,cy:510});
 expect(roofViewportRegistrations(f.project,f.model,f.texts)[m.id]).toBeTruthy();
 f.texts.s.pop();expect(roofViewportRegistrations(f.project,f.model,f.texts)[m.id]).toBeUndefined();
 f.texts.s.push({str:'(CANT.)',cx:400,cy:510});m.points=[[-200,500],[0,500]];
 expect(roofViewportRegistrations(f.project,f.model,f.texts)[m.id]).toBeUndefined();
});
