import { it, expect } from "vitest";
import {
  roofCantileverExtension,
  roofEndSection,
} from "../src/build/roofCantileverGeometry";
const lines = () =>
  [100, 200, 300].map((y) => ({
    x1: -120,
    x2: -10,
    y1: y,
    y2: y,
    width: 1.32,
    color: "#000000",
  })) as any;
it("uses the drawn free end and printed maximum only as a limit", () => {
  expect(
    roofCantileverExtension(
      [
        [0, 100],
        [120, 100],
      ],
      lines(),
      0.035,
      4.5,
    ),
  ).toEqual([
    [-120, 100],
    [120, 100],
  ]);
  expect(
    roofCantileverExtension(
      [
        [0, 100],
        [120, 100],
      ],
      lines(),
      0.035,
      4,
    ),
  ).toBeNull();
});
it("requires repeated actual member ink and a connected support neighbourhood", () => {
  expect(
    roofCantileverExtension(
      [
        [0, 100],
        [120, 100],
      ],
      lines().slice(0, 2),
      0.035,
      4.5,
    ),
  ).toBeNull();
  expect(
    roofCantileverExtension(
      [
        [0, 100],
        [120, 100],
      ],
      lines().map((l: any) => ({ ...l, x2: -40 })),
      0.035,
      4.5,
    ),
  ).toBeNull();
});

it("requires closed beam end faces with the scheduled section, rejecting purlin width", () => {
  const ls: any = [
    { x1: -5, x2: 5, y1: 100, y2: 100 },
    { x1: -5, x2: 5, y1: 124, y2: 124 },
    { x1: -5, x2: -5, y1: 100, y2: 124 },
    { x1: 5, x2: 5, y1: 100, y2: 124 },
  ].map((l) => ({ ...l, color: "#000000" }));
  expect(roofEndSection(ls, 0, 0.025, 0.25, 0.6, 90, 130)).toEqual({
    top: 100,
    bottom: 124,
  });
  expect(roofEndSection(ls, 0, 0.025, 0.175, 0.6, 90, 130)).toBeNull();
  expect(
    roofEndSection(ls.slice(0, 3), 0, 0.025, 0.25, 0.6, 90, 130),
  ).toBeNull();
});
it("uses independently established outer-grid direction rather than an adjacent interior stroke", () => {
  const both: any = [
    ...lines(),
    ...[100, 200, 300].map((y) => ({
      x1: 130,
      x2: 240,
      y1: y,
      y2: y,
      width: 1.32,
      color: "#000000",
    })),
  ];
  expect(
    roofCantileverExtension(
      [
        [0, 100],
        [120, 100],
      ],
      both,
      0.035,
      4.5,
    ),
  ).toBeNull();
  expect(
    roofCantileverExtension(
      [
        [0, 100],
        [120, 100],
      ],
      both,
      0.035,
      4.5,
      1,
    ),
  ).toEqual([
    [0, 100],
    [240, 100],
  ]);
});
