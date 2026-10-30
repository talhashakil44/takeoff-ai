import { describe, it, expect } from "vitest";
import {
  clearance,
  moveInside,
  sheetFrame,
  worldPoint,
  sheetPoint,
  roomStops,
} from "../src/explore/spatial";
import { lensDistance, logMix } from "../src/explore/camera";
import type { Project, Sheet } from "../src/model";
import type { BuildModel, BuildElement } from "../src/build/types";
const sheet = { id: "s", metersPerPoint: 0.1 } as Sheet;
const measurement = {
  id: "r",
  sheetId: "s",
  source: "rooms",
  points: [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ],
  holes: [],
  label: "Measured room",
};
const element = {
  id: "r",
  measurementId: "r",
  sheetId: "s",
  level: "L1",
  shape: {
    type: "surface",
    ring: [
      [5, 7],
      [15, 7],
      [15, 17],
      [5, 17],
    ],
    holes: [],
    z: 0,
    thickness: 0.1,
  },
  quantity: 100,
  unit: "m²",
};
const project = {
  sheets: [sheet],
  measurements: [measurement],
  units: "metric",
} as unknown as Project;
const model = {
  elements: [element],
  levels: [{ id: "L1", elevation: 0 }],
} as unknown as BuildModel;
describe("Explore Drawing alignment and navigation", () => {
  it("uses the existing model transform and round-trips to the original PDF", () => {
    const frame = sheetFrame(project, model, sheet)!;
    expect(frame).not.toBeNull();
    expect(worldPoint([50, 50], frame)).toEqual([10, 12]);
    for (const value of sheetPoint([10, 12], frame))
      expect(value).toBeCloseTo(50, 8);
  });
  it("rejects inconsistent geometry instead of misaligning the PDF", () => {
    const changed = structuredClone(model);
    if (changed.elements[0].shape?.type === "surface")
      changed.elements[0].shape.ring[2][0] += 1;
    expect(sheetFrame(project, changed, sheet)).toBeNull();
  });
  it("preserves measurement identity, quantity and source coordinates", () => {
    const before = JSON.stringify({ project, model });
    const stops = roomStops(
      project,
      model,
      sheet,
      sheetFrame(project, model, sheet)!,
    );
    expect(stops[0].id).toBe("r");
    expect(stops[0].element.quantity).toBe(100);
    expect(stops[0].heightBasis).toBe("Assumed 2.7 m");
    expect(JSON.stringify({ project, model })).toBe(before);
  });
  it("cannot tunnel out of a room or through a cutout", () => {
    const room = roomStops(
      project,
      model,
      sheet,
      sheetFrame(project, model, sheet)!,
    )[0];
    expect(moveInside([10, 12], [30, 12], room, [])[0]).toBeLessThan(15);
    room.holes = [
      [
        [11, 10],
        [13, 10],
        [13, 14],
        [11, 14],
      ],
    ];
    expect(moveInside([10, 12], [14, 12], room, [])[0]).toBeLessThan(11);
  });
  it("blocks modelled internal walls even when the room polygon crosses them", () => {
    const room = roomStops(
      project,
      model,
      sheet,
      sheetFrame(project, model, sheet)!,
    )[0];
    const wall = {
      level: "L1",
      trade: "partitions",
      shape: {
        type: "run",
        points: [
          [12, 7],
          [12, 17],
        ],
        z0: 0,
        height: 3,
        thickness: 0.2,
      },
    } as BuildElement;
    expect(moveInside([10, 12], [14, 12], room, [wall])[0]).toBeLessThan(11.7);
  });
  it("finds a room stop inside a concave footprint, never the outside centroid", () => {
    const ring: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 2],
      [2, 2],
      [2, 10],
      [0, 10],
    ];
    expect(clearance([5, 5], ring, [])).toBe(-1);
  });
  it("keeps the same frame height as the lens opens", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const fov = logMix(1.5, 54, t),
        distance = lensDistance(30, fov);
      expect(2 * distance * Math.tan((fov * Math.PI) / 360)).toBeCloseTo(30);
    }
  });
});

import {
  matchGridFrame,
  floorPlans,
  layerElement,
} from "../src/explore/layers";
describe("coordinated drawing layers", () => {
  const base = {
    id: "base",
    width: 1000,
    height: 1000,
    metersPerPoint: 0.1,
    title: "GROUND FLOOR PLAN",
    name: "A1",
  } as Sheet;
  const overlay = { ...base, id: "overlay", name: "E1" };
  const text = (str: string, cx: number, cy: number) => ({ str, cx, cy });
  const reference = [
    ...["A", "B", "C"].flatMap((k, i) => [
      text(k, 200 + i * 100, 50),
      text(k, 200 + i * 100, 950),
    ]),
    ...["1", "2", "3"].flatMap((k, i) => [
      text(k, 50, 200 + i * 100),
      text(k, 800, 200 + i * 100),
    ]),
  ];
  const f = { a: 0.1, b: 0, tx: 5, ty: 7, residual: 0 };
  it("aligns a single-ended grid from translated and rotated drawings", () => {
    for (const rot of [0, Math.PI / 2]) {
      const c = Math.cos(rot),
        s = Math.sin(rot);
      const target = [
        ...["A", "B", "C"].map((k, i) =>
          text(
            k,
            c * (200 + i * 100) - s * 50 + 100,
            s * (200 + i * 100) + c * 50 + 200,
          ),
        ),
        ...["1", "2", "3"].map((k, i) =>
          text(
            k,
            c * 50 - s * (200 + i * 100) + 100,
            s * 50 + c * (200 + i * 100) + 200,
          ),
        ),
      ];
      const frame = matchGridFrame(base, f, overlay, {
        base: reference,
        overlay: target,
      })!;
      expect(frame).not.toBeNull();
      const point: [number, number] = [
        c * 300 - s * 300 + 100,
        s * 300 + c * 300 + 200,
      ];
      const world = worldPoint(point, frame);
      expect(world[0]).toBeCloseTo(35);
      expect(world[1]).toBeCloseTo(37);
    }
  });
  it("rejects ambiguous repeated plans and uncalibrated drawings", () => {
    const duplicate = [
      ...reference,
      ...reference.map((t) => ({ ...t, cx: t.cx + 500 })),
    ];
    expect(
      matchGridFrame(base, f, overlay, { base: reference, overlay: duplicate }),
    ).toBeNull();
    expect(
      matchGridFrame(
        base,
        f,
        { ...overlay, metersPerPoint: null },
        { base: reference, overlay: reference },
      ),
    ).toBeNull();
  });
  it("reprojects geometry without altering quantities or the source model", () => {
    const before = JSON.stringify(element),
      e = layerElement(element as unknown as BuildElement, f, {
        ...f,
        tx: 15,
      })!;
    expect(e.quantity).toBe(element.quantity);
    expect(e.shape?.type === "surface" && e.shape.ring[0][0]).toBeCloseTo(15);
    expect(JSON.stringify(element)).toBe(before);
    expect(
      layerElement({ ...element, shape: null } as BuildElement, f, f),
    ).toBeNull();
  });
  it("uses floor plans as primary views and excludes reflected ceilings", () => {
    const p = {
      ...project,
      sheets: [
        { ...sheet, name: "A1", title: "GROUND FLOOR PLAN" },
        { ...sheet, id: "rcp", name: "A6", title: "REFLECTED CEILING PLAN" },
      ],
    } as Project;
    expect(floorPlans(p, model).map((s) => s.id)).toEqual(["s"]);
  });
});

import { alignControlPoints } from "../src/explore/layers";
describe("reviewed control-point alignment", () => {
  it("fits three corresponding points and preserves calibrated scale", () => {
    const f = alignControlPoints(
      [
        [0, 0],
        [100, 0],
        [0, 100],
      ],
      [
        [4, 7],
        [4, 17],
        [-6, 7],
      ],
      0.1,
    )!;
    expect(f).not.toBeNull();
    expect(worldPoint([50, 50], f)[0]).toBeCloseTo(-1);
    expect(worldPoint([50, 50], f)[1]).toBeCloseTo(12);
  });
  it("rejects mismatched points, wrong scales and controls too close together", () => {
    expect(
      alignControlPoints(
        [
          [0, 0],
          [100, 0],
          [0, 100],
        ],
        [
          [0, 0],
          [10, 0],
          [2, 10],
        ],
        0.1,
      ),
    ).toBeNull();
    expect(
      alignControlPoints(
        [
          [0, 0],
          [100, 0],
          [0, 100],
        ],
        [
          [0, 0],
          [20, 0],
          [0, 20],
        ],
        0.1,
      ),
    ).toBeNull();
    expect(
      alignControlPoints(
        [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        [
          [0, 0],
          [0.1, 0],
          [0, 0.1],
        ],
        0.1,
      ),
    ).toBeNull();
  });
});
