# Build It rework brief (for GPT-6 Astra / Codex)

Repo: talhashakil44/takeoff-ai (Electron + React + TypeScript, Vite, Vitest). Build It lives in:

- `src/build/extract.ts`: takeoff to `BuildModel` (levels, trades, element shapes)
- `src/build/plan.ts`: activities and dependencies; `src/build/cpm.ts`: CPM, calendar, driving chain, target check
- `src/build/ifc.ts`, `src/build/ifcClass.ts`: IFC 4 export (validated with ifcopenshell, keep it working)
- `src/components/BuildScene.tsx` (Three.js), `BuildView.tsx`, `BuildPanels.tsx`: the UI
- Tests: `test/build.test.ts`. Real sets to check against: Kelso (new 2-storey lodge, slab on grade) and 84 Frederick (4-storey renovation).

Takeoff data is sacred: never change or drop a measurement. Build It only reads the project.

## What is wrong now (owner's verdict: "makes no sense, nothing like a BIM")

1. **The 3D is not a building.** Each takeoff mark is extruded on its own: wall polylines become boxes, ceiling and floor areas become flat plates, counts become small cubes. There are no floor slabs, no roof, no exterior envelope, no structure and no grids. Floors are stacked by where the plan sits on the sheet, not by grid lines, so levels do not line up. Doors and windows are not openings in walls. The result reads as a cloud of coloured marks, not the building on the drawings.
2. **The schedule durations are wrong.** Only trades that have takeoffs get work activities. Work duration = takeoff quantity / a default crew rate, per trade per level. So a new building with little taken off for site, foundations, structure, envelope and roofing comes out at about 6 months. The owner says Kelso is about 2 years; 84 Frederick is also badly off.
3. **Changing the target does nothing.** The target date is only compared against the finish and flagged as late. Nothing re-plans: crews, overlaps and sequence stay the same, so the plan never adjusts.

## What to build

### A. A real building model
- Register every level by its grid lines (find the grid bubbles and lines on each plan; fall back to the title-block/sheet position only when there are none), so the floors stack correctly.
- Per level: the outline of the exterior walls gives a floor slab and the envelope. Add a roof on the top level (from the roof plan when there is one). Use storey heights from sections, elevations or the level datums (e.g. "T/O SLAB 3600"); fall back to the setup value.
- Walls: real thickness from the wall type, full storey height (or to the ceiling height when the type says so), with door and window openings cut where the door and window tags sit.
- Ceilings at the ceiling height from the RCP/finish schedule; MEP runs in the ceiling space; fixtures and devices at their mounting heights.
- Existing vs new vs demolished, so a renovation (84 Frederick) shows the existing building greyed with the new work in colour.
- It must look like the building on the plans when you orbit it. Check it against the plans and elevations of Kelso and 84 Frederick.

### B. A schedule a superintendent would believe
- A full work breakdown for the project type, whether or not every trade was taken off: mobilization, site and excavation, foundations, underground services, structure (per level), envelope and roofing (weather-tight milestone), MEP rough-in, inspections, partitions, finishes, MEP trim, commissioning, deficiencies and closeout. Renovations add phasing, abatement and occupied-building constraints.
- Durations from production rates applied to the quantities where there is a takeoff, and from the building's size (gross floor area, storeys) where there is none. Mark each duration as documented, inferred or assumed, as today.
- Lead times for long-lead items (steel, switchgear, AHUs, curtain wall, elevators) driving their install.
- Winter and weather windows for site, structure and roofing (Ontario).
- Sanity check: Kelso should come out around 2 years. Investigate 84 Frederick against its spec's contract time (Division 01) and say what drives the result.

### C. The target date must drive the plan
- When the target moves earlier, re-plan: add crews where the rates allow, overlap levels/trades where the logic allows, and show each change with its cost or risk. If it still can't fit, say what's fixed (documented reviews, lead times) and by how much it misses.
- When the target moves later, relax back to the leanest crews.
- Every edit (dates, durations, crews, links) recomputes at once in the Gantt, the 3D playback and the IFC export.

## Done means
- Orbiting the Kelso and 84 Frederick models looks like those buildings.
- Kelso's plan is about 2 years with a believable driving chain; 84 Frederick's is explained against its spec.
- Moving the target visibly changes the plan.
- `npx tsc --noEmit`, `npx vitest run` and the IFC validation stay green; no takeoff data is touched.
