import { it, expect } from 'vitest';
import { flatRoofSectionEvidence } from '../src/build/flatRoofSectionEvidence';
function fixture() {
  const project: any = { sheets: [{ id: 's', name: 'S4.0', page: 4 }] },
    r: any = { bounds: [90, 200, 550, 600] },
    sec: any = { code: 'B1', width: 0.215, depth: 0.608 };
  const texts: any = {
    p: [
      { str: 'B', cx: 50, cy: 300 },
      ...['1', '2', '3'].map((str, i) => ({ str, cx: 100 + i * 200, cy: 50 })),
      { str: 'S4.0', cx: 314, cy: 100 },
      { str: '2', cx: 314, cy: 87 },
    ],
    s: [
      { str: 'BUILDING SECTION - 2', cx: 100, cy: 900 },
      { str: 'SCALE: 1 : 75', cx: 70, cy: 915 },
      { str: 'B', cx: 400, cy: 350 },
    ],
  };
  const lines: any = {
    s: [
      { color: '#000000', x1: 395, x2: 405, y1: 512, y2: 512 },
      {
        color: '#000000',
        x1: 395,
        x2: 405,
        y1: 512 + 0.608 / ((75 * 0.0254) / 72),
        y2: 512 + 0.608 / ((75 * 0.0254) / 72),
      },
    ],
  };
  const datums: any = [{ id: 's', box: [700, 500, 780, 524] }];
  return { project, r, sec, texts, lines, datums };
}
it('matches actual plan cut and section grid, exposing scheduled versus drawn width', () => {
  const f = fixture();
  const result = flatRoofSectionEvidence(
    f.project,
    'p',
    [
      [100, 300],
      [300, 300],
    ],
    f.r,
    f.sec,
    f.texts,
    f.lines,
    f.datums,
  );
  expect(result.sources).toHaveLength(1);
  expect(
    result.issues.some(
      (i) => i.includes('schedule width 215mm') && i.includes('265mm'),
    ),
  ).toBe(true);
});
it('does not claim a section match without drawn beam depth evidence', () => {
  const f = fixture();
  f.lines.s.pop();
  const result = flatRoofSectionEvidence(
    f.project,
    'p',
    [
      [100, 300],
      [300, 300],
    ],
    f.r,
    f.sec,
    f.texts,
    f.lines,
    f.datums,
  );
  expect(result.sources).toHaveLength(0);
  expect(result.issues[0]).toContain('no mechanically matched section cut');
});
