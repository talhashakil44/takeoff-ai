import { ifcClassOf } from "../src/build/ifcClass";
import { describe, it, expect } from "vitest";
import {
  structuralSections,
  structuralEvidence,
  lintelSpan,
  reviewedShape,
  connectStructuralModel,
  structuralFingerprint,
  type StructuralPlacement,
  type StructuralEvidence,
} from "../src/build/structural";
import type { Project, Sheet } from "../src/model";
import type { BuildElement, BuildModel, SourceRef } from "../src/build/types";
import type { Segment } from "../src/fill/vectors";
const sheet = {
  id: "s",
  name: "S1",
  page: 1,
  metersPerPoint: 0.01,
  width: 1000,
  height: 1000,
} as Sheet;
const project = {
  sheets: [sheet],
  measurements: [{ id: "m", points: [[50, 20]], sheetId: "s", typeId: "t" }],
  types: [{ id: "t", kind: "count" }],
} as unknown as Project;
const ref: SourceRef = { kind: "sheet", id: "s", page: 1, label: "S1" };
const frame = { a: 0.01, b: 0, tx: 2, ty: 3, residual: 0 };
const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width = 1,
): Segment => ({ x1, y1, x2, y2, width, filled: false, color: "#000000" });
const member = {
  id: "m",
  measurementId: "m",
  typeId: "t",
  typeName: "L1",
  name: "L1",
  origin: "takeoff",
  trade: "structure",
  level: "L1",
  division: "06",
  sheetId: "s",
  shape: null,
  quantity: 1,
  unit: "ea",
  specs: [],
  sources: [ref],
  issues: [],
  placement: "unknown",
} as BuildElement;
const model = { elements: [member], levels: [] } as unknown as BuildModel;
const placement: StructuralPlacement = {
  sheetId: "s",
  points: [
    [0, 0],
    [100, 0],
  ],
  kind: "run",
  width: 0.076,
  depth: 0.184,
  bottom: 2.74,
  evidence: [ref],
  note: "Reviewed plan and elevation",
  fingerprint: structuralFingerprint(member, project),
};
describe("source-backed structure", () => {
  it("exports connected lintels as beams without changing foundation wall classes", () => {
    const shape = reviewedShape(placement, frame)!;
    expect(ifcClassOf({ ...member, shape })).toEqual({
      cls: "IFCBEAM",
      tail: ",.LINTEL.",
    });
    expect(ifcClassOf({ ...member, typeName: "FW1", shape }).cls).toBe(
      "IFCWALL",
    );
  });
  it("reads SIZE without confusing POSTS and ignores superseded schedules", () => {
    const texts = [
      ["WOOD LINTEL SCHEDULE", 150, 10],
      ["MARK", 100, 30],
      ["SIZE", 150, 30],
      ["POSTS", 210, 30],
      ["L1", 100, 45],
      ["2 - 38x184 (2x8)", 155, 45],
      ["3 PLY 38x140 (2x6)", 235, 45],
    ].map(([str, cx, cy]) => ({ str, cx, cy })) as any;
    const s = structuralSections(project, { s: texts }).L1;
    expect(s.width).toBe(0.076);
    expect(s.depth).toBe(0.184);
    expect(s.posts).toContain("3 PLY");
    expect(s.source.quote).toContain("SIZE 2 - 38x184");
    expect(
      structuralSections(
        { ...project, sheets: [{ ...sheet, superseded: true } as any] },
        { s: texts },
      ),
    ).toEqual({});
  });
  it("rejects conflicting schedule sections", () => {
    const ts = (width: string) =>
      [
        ["WOOD LINTEL SCHEDULE", 150, 10],
        ["MARK", 100, 30],
        ["SIZE", 150, 30],
        ["POSTS", 210, 30],
        ["L1", 100, 45],
        [width, 155, 45],
      ].map(([str, cx, cy]) => ({ str, cx, cy })) as any;
    const result = structuralSections(
      { ...project, sheets: [sheet, { ...sheet, id: "s2" }] },
      { s: ts("2 - 38x184"), s2: ts("3 - 38x184") },
    );
    expect(result.L1.conflict).toBeTruthy();
  });
  it("joins interrupted member ink only between supporting jambs", () => {
    const ink = [
      line(0, 50, 40, 50),
      line(60, 50, 100, 50),
      line(0, 44, 0, 56, 0.3),
      line(100, 44, 100, 56, 0.3),
    ];
    expect(lintelSpan([50, 20], ink, 0.01)).toEqual([
      [0, 50],
      [100, 50],
    ]);
    expect(lintelSpan([50, 20], ink.slice(0, 2), 0.01)).toBeNull();
    expect(
      lintelSpan(
        [50, 20],
        ink.map((l) => ({ ...l, color: "#dddddd" })),
        0.01,
      ),
    ).toBeNull();
  });
  it("requires sourced, finite, reviewed geometry and rejects crossed panels", () => {
    expect(reviewedShape(placement, frame)).toEqual({
      type: "run",
      points: [
        [2, 3],
        [3, 3],
      ],
      z0: 2.74,
      height: 0.184,
      thickness: 0.076,
    });
    for (const bad of [
      { ...placement, evidence: [] },
      { ...placement, note: "" },
      { ...placement, bottom: NaN },
      { ...placement, depth: -1 },
      { ...placement, points: [] },
    ])
      expect(reviewedShape(bad, frame)).toBeNull();
    expect(
      reviewedShape(
        {
          ...placement,
          kind: "surface",
          points: [
            [0, 0],
            [100, 100],
            [0, 100],
            [100, 0],
          ],
        },
        frame,
      ),
    ).toBeNull();
    expect(
      reviewedShape(
        {
          ...placement,
          kind: "surface",
          points: [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
          ],
        },
        frame,
      )?.type,
    ).toBe("surface");
  });
  it("preserves accepted totals and identity, and invalidates reviews when source measurements change", () => {
    const snapshot = JSON.stringify({ project, model });
    const ev: Record<string, StructuralEvidence> = {
      m: { sources: [ref], issues: [], shape: null },
    };
    const result = connectStructuralModel(
      project,
      model,
      ev,
      { m: placement },
      { s: frame },
    );
    expect(result.elements[0].shape?.type).toBe("run");
    expect(result.elements[0].id).toBe("m");
    expect(result.elements[0].quantity).toBe(1);
    expect(result.elements[0].unit).toBe("ea");
    expect(JSON.stringify({ project, model })).toBe(snapshot);
    const changed = {
      ...project,
      measurements: [
        {
          ...project.measurements[0],
          points: [[51, 20]] as [number, number][],
        },
      ],
    };
    expect(
      connectStructuralModel(changed, model, ev, { m: placement }, { s: frame })
        .elements[0].shape,
    ).toBeNull();
  });
  it("does not render arbitrary cubes for unresolved structural counts", () => {
    const cube = {
      ...member,
      shape: {
        type: "point" as const,
        at: [0, 0] as [number, number],
        z: 0,
        size: [0.4, 0.4, 0.4] as [number, number, number],
      },
    };
    const result = connectStructuralModel(
      project,
      { ...model, elements: [cube] },
      { m: { sources: [], issues: ["Unresolved"], shape: null } },
      {},
      { s: frame },
    );
    expect(result.elements[0].shape).toBeNull();
    expect(result.elements[0].quantity).toBe(1);
  });
  it("retains registered count locators and their qualification until a physical section is resolved", () => {
    const locator: BuildElement = {
      ...member,
      typeName: "C1 column",
      placement: "inferred",
      shape: { type: "locator", at: [5, 8], z: 4 },
      issues: ["Symbolic location at structural grid A/3; section and height unverified."],
    };
    const unresolved = { m: { sources: [], issues: ["Member dimensions need review."], shape: null } };
    const result = connectStructuralModel(project, { ...model, elements: [locator] }, unresolved, {}, { s: frame });
    expect(result.elements[0].shape).toEqual(locator.shape);
    expect(result.elements[0].placement).toBe("inferred");
    expect(result.elements[0].issues).toContain(locator.issues[0]);
    expect(result.elements[0].quantity).toBe(1);
    // Running the connector again must not duplicate warnings or the located member.
    const repeated = connectStructuralModel(project, result, unresolved, {}, { s: frame });
    expect(repeated.elements).toEqual(result.elements);
    const reviewed = connectStructuralModel(project, result, unresolved, {
      m: { ...placement, fingerprint: structuralFingerprint(locator, project) },
    }, { s: frame });
    expect(reviewed.elements).toHaveLength(1);
    expect(reviewed.elements[0].shape?.type).toBe("run");
    expect(reviewed.elements[0].quantity).toBe(1);
  });

  it.each([
    { plan: "a1", datum: 4000, accepted: false, why: "another floor's coincident plan tag" },
    { plan: "a2", datum: 0, accepted: false, why: "another floor's opening detail datum" },
    { plan: "a2", datum: 4000, accepted: true, why: "matching second-floor plan and detail" },
  ])("checks the opening floor before recovering lintel height: $why", ({ plan, datum, accepted }) => {
    const arch1 = { ...sheet, id: "a1", name: "A2.1", title: "GROUND FLOOR PLAN" };
    const arch2 = { ...sheet, id: "a2", name: "A2.2", title: "SECOND FLOOR PLAN" };
    const detail = { ...sheet, id: "detail", name: "A8.3", title: "WINDOW ELEVATIONS" };
    const p = { ...project, sheets: [sheet, arch1, arch2, detail] };
    const m = { ...model, elements: [{ ...member, level: "L2" }], levels: [
      { id: "L1", elevation: 0, sheets: ["a1"] },
      { id: "L2", elevation: 4, sheets: ["a2", "s"] },
    ] } as BuildModel;
    const words = (items: [string, number, number][]) => items.map(([str, cx, cy]) => ({ str, cx, cy })) as any;
    const texts = {
      s: words([["WOOD LINTEL SCHEDULE", 150, 10], ["MARK", 100, 30], ["SIZE", 150, 30],
        ["POSTS", 210, 30], ["L1", 100, 45], ["2 - 38x184", 155, 45]]),
      [plan]: words([["W1", 50, 50]]),
      detail: words([["W1", 150, 300], [datum ? "FIN. SECOND FLOOR" : "FIN. GROUND FLOOR", 400, 250], [String(datum), 450, 250]]),
    };
    const lines = {
      s: [line(0, 50, 40, 50), line(60, 50, 100, 50), line(0, 44, 0, 56, 0.3), line(100, 44, 100, 56, 0.3)],
      detail: [line(100, 100, 200, 100), line(100, 200, 200, 200), line(100, 100, 100, 200), line(200, 100, 200, 200)],
    };
    const evidence = structuralEvidence(p, m, texts, lines, { s: frame, a1: frame, a2: frame }).m;
    expect(evidence.span).toEqual([[0, 50], [100, 50]]);
    if (accepted) {
      expect(evidence.shape).toMatchObject({ type: "run", z0: 5.5, height: 0.184, thickness: 0.076 });
      expect(evidence.sources.some(s => s.id === "a2" && s.quote?.includes("W1"))).toBe(true);
    } else {
      expect(evidence.shape).toBeNull();
      expect(evidence.head).toBeUndefined();
      expect(evidence.issues).toContain("Opening head elevation is unresolved; match the elevation/detail before placing vertically.");
    }
  });

});
