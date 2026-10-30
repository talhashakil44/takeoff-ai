import { it, expect } from 'vitest';
import { recoverRoofBeamSpan } from '../src/build/roofSpanEvidence';
function fixture() {
  const r: any = { metersPerPoint: 0.025, bounds: [0, 0, 500, 500] };
  const sec: any = [{ code: 'C1', width: 0.25, depth: 0.35 }];
  const texts: any = [{ str: 'B1', cx: 200, cy: 90 }];
  const lines: any = [];
  for (const x of [100, 300]) {
    texts.push({ str: 'C1', cx: x + 15, cy: 90 });
    for (const [x1, y1, x2, y2] of [
      [x - 5, 93, x + 5, 93],
      [x + 5, 93, x + 5, 107],
      [x + 5, 107, x - 5, 107],
      [x - 5, 107, x - 5, 93],
    ])
      lines.push({ x1, y1, x2, y2 });
  }
  return { r, sec, texts, lines };
}
it('recovers fragment endpoints at drawn column centres, not count tag locations', () => {
  const f = fixture();
  expect(
    recoverRoofBeamSpan(
      [
        [120, 99],
        [280, 99],
      ],
      'B1',
      f.r,
      f.texts,
      f.lines,
      f.sec,
    ),
  ).toEqual([
    [100, 100],
    [300, 100],
  ]);
});
it('rejects a missing support edge, wrong beam code, or fragment outside bearing range', () => {
  let f = fixture();
  f.lines.pop();
  expect(
    recoverRoofBeamSpan(
      [
        [120, 99],
        [280, 99],
      ],
      'B1',
      f.r,
      f.texts,
      f.lines,
      f.sec,
    ),
  ).toBeNull();
  f = fixture();
  expect(
    recoverRoofBeamSpan(
      [
        [120, 99],
        [280, 99],
      ],
      'B2',
      f.r,
      f.texts,
      f.lines,
      f.sec,
    ),
  ).toBeNull();
  expect(
    recoverRoofBeamSpan(
      [
        [20, 99],
        [280, 99],
      ],
      'B1',
      f.r,
      f.texts,
      f.lines,
      f.sec,
    ),
  ).toBeNull();
});
it('uses contiguous striped support sides and side ink continuing into an adjacent wall', () => {
  const f = fixture();
  f.lines = f.lines.flatMap((l: any) =>
    Math.abs(l.x1 - l.x2) < 0.01
      ? [
          { ...l, y1: 80, y2: 100 },
          { ...l, y1: 100, y2: 120 },
        ]
      : [l],
  );
  expect(
    recoverRoofBeamSpan(
      [
        [120, 99],
        [280, 99],
      ],
      'B1',
      f.r,
      f.texts,
      f.lines,
      f.sec,
    ),
  ).toEqual([
    [100, 100],
    [300, 100],
  ]);
});
it('does not bridge missing ink in a striped column side', () => {
  const f = fixture();
  f.lines = f.lines.flatMap((l: any) =>
    Math.abs(l.x1 - l.x2) < 0.01
      ? [
          { ...l, y1: 93, y2: 99.8 },
          { ...l, y1: 100.2, y2: 107 },
        ]
      : [l],
  );
  expect(
    recoverRoofBeamSpan(
      [
        [120, 99],
        [280, 99],
      ],
      'B1',
      f.r,
      f.texts,
      f.lines,
      f.sec,
    ),
  ).toBeNull();
});
