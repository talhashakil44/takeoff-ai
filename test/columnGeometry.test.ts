import { it, expect } from 'vitest';
import { traceSectionPost } from '../src/build/columnGeometry';
const rectangle = (color = '#000000') =>
  [
    { x1: -5, x2: -5, y1: 100, y2: 240, color },
    { x1: 5, x2: 5, y1: 100, y2: 240, color },
    { x1: -5, x2: 5, y1: 100, y2: 100, color },
    { x1: -5, x2: 5, y1: 240, y2: 240, color },
  ] as any;
it('traces an actual raised base rather than extending to the floor datum', () => {
  const p = traceSectionPost(rectangle(), 0, 300, 0.025, 0.25)!;
  expect(p).toEqual({ top: 100, bottom: 240 });
  expect(4 + (300 - p.bottom) * 0.025).toBe(5.5);
});
it('requires black faces, scheduled width, and closed ends', () => {
  expect(
    traceSectionPost(rectangle().slice(0, 3), 0, 300, 0.025, 0.25),
  ).toBeNull();
  expect(
    traceSectionPost(rectangle('#cccccc'), 0, 300, 0.025, 0.25),
  ).toBeNull();
  expect(traceSectionPost(rectangle(), 0, 300, 0.025, 0.4)).toBeNull();
});
it('allows a bounded crossing-beam interruption on one face only', () => {
  const ls = rectangle();
  ls.splice(
    1,
    1,
    { x1: 5, x2: 5, y1: 100, y2: 160, color: '#000000' },
    { x1: 5, x2: 5, y1: 180, y2: 240, color: '#000000' },
  );
  expect(traceSectionPost(ls, 0, 300, 0.025, 0.25)).toEqual({
    top: 100,
    bottom: 240,
  });
  ls[2].y1 = 200;
  expect(traceSectionPost(ls, 0, 300, 0.025, 0.25)).toBeNull();
});
it('rejects two complete stacked viewports when not scoped to a section', () => {
  const ls = [
    ...rectangle(),
    ...rectangle().map((l: any) => ({ ...l, y1: l.y1 + 300, y2: l.y2 + 300 })),
  ];
  expect(traceSectionPost(ls, 0, 600, 0.025, 0.25)).toBeNull();
});
