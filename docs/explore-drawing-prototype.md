# Explore Drawing — measured coordination workspace

Branch: `codex/explore-drawing`, based on Build It checkpoint `e5ecd0d`.
Work is isolated from Claude's review fixes. No changes to BuildView, facts,
scope, extractModel, the shared viewer, or project storage writers are included.
The only application integration is an additive `ExploreHost` in `src/App.tsx`.

## Open it

Run `npm run dev`, open the app, open a project and generate its model in Build It.
Use **Explore drawing** at the bottom left. The tool reads the current project's
saved model and original PDFs from local storage. Missing/stale supported records
produce a rebuild instruction. The snapshot timestamp is shown; this prototype
is not a live model-regeneration pipeline.

Choose an architectural floor plan and a measured room. **Drawing** shows the actual PDF;
**Lift into 3D** raises the measured geometry while changing the lens;
**Assembly** separates schematic layers; **Enter room** jumps to a valid interior
point. The original quantities, perimeter, assembly formulas, room finishes and
spec links appear in the inspector. Selecting a model element updates the source
crop. **Locate on original drawing** returns to that source region and highlights
its bounds. Clicking a room on the PDF selects its existing takeoff.

Inside a room: WASD/arrows move, Q/E or pointer drag look, Escape returns to the
sheet. Movement is limited to the measured room and constrained against cutouts
and modelled walls. Room entry is a deliberate jump, not an invented path through
unverified doors. Reduced-motion mode switches views without the camera animation.

## Visual direction and attribution

The drafting-board, rising geometry, long-lens-to-perspective camera, exploded
layers and mini-map follow the experience requested by the owner. See
`src/explore/THIRD_PARTY.md` for the reference and retained MIT notice. No fictional
house, fabricated furniture, marketing content or unlicensed Lintel code is
embedded. Colours are schematic; they are not asserted to be specified finishes.

## Evidence and boundaries

- Reuses `geometryOf` and model element/measurement IDs; it does not calculate a
  replacement set of takeoff quantities or write project files.
- Matches existing model coordinates to sheet points and rejects inconsistent
  transforms. Source quantity/perimeter come from existing takeoff data/functions.
- Room heights without a recorded ceiling height are labelled assumptions.
- Reads a saved model. Record identity, quantity, type and source-box checks catch
  common stale snapshots; these are not a complete project revision fingerprint.
  Rebuild in Build It after changing model settings, specifications or geometry.
- Registered discipline drawings contribute toggleable source overlays and existing
  model geometry to the selected floor. Unplaced counts remain source pins, never
  fabricated physical members. It is not a fully furnished whole-building walkthrough.
- Missing curtain walls, structural members and other baseline geometry remain
  missing. Invalid/too-small room regions cannot be entered.
- A room list total is a sum of selected-sheet room takeoffs, not certified gross
  floor area. It inherits overlapping/merged takeoff semantics from the project.
- Existing linked specification pages and original drawings open in a zoomable
  source viewer. Extract in takeoff returns to the exact drawing in the main app.
  New spec links and schedule joins are not invented.
- No drawing is uploaded to a third party. Local diagnostic fixtures and PDFs
  under ignored `diag/` are not included in Git.

## Validation

`npx tsc --noEmit`, `npx vitest run`, `npm run build`.

The suite includes `test/explore.test.ts`: source-coordinate round-trip,
inconsistent-transform rejection, preserved identity/quantity, room/cutout/wall
collision limits and constant-frame lens math. Full suite: 402 tests / 56 files.
Production build retains the baseline large-chunk warning.

Browser inspection used a read-only copy of the real Kelso project/model plus its
architectural PDF. A2.1 reports 17 room takeoffs totalling 547.96 m². Staff Office
116 is 10.57 m² / 13.36 m perimeter; Staff Room 109 is 56.72 m² / 30.48 m perimeter.
These are takeoff-derived values, not manually entered UI examples.

The local preview is `http://127.0.0.1:5188/diag/explore/index.html` while its dev
server is running. This private fixture is not shipped. A clean checkout uses the
normal launcher and requires the user's saved project and Build It model.

## Drawing coordination

Ground/second-floor architectural plans anchor the view. Ceilings are a discipline
layer rather than a walkable floor. Structure, mechanical, electrical and fire
protection sources are grouped per floor; the searchable library includes all
project drawings (122 in the Kelso review fixture).

Calibrated vector grid labels support reviewed overlay registration, including
quarter-turn rotations. Ambiguous repeated viewports are rejected. Three matching
control points can align a source manually; scale must agree within 2% and maximum
residual must stay below 150 mm. Choose widely separated intersections in the same
plan viewport. These are review thresholds, not a claim of construction accuracy.
Alignments persist locally per project/model/floor and can be reset. They do not
change original measurement coordinates or accepted quantities.

Up to four raster overlays are active together, limited to 2048 pixels per source
for memory control. Original source viewing renders separately at higher resolution.
Grid guides are inferred from drawing labels and must be checked. Layer counts show
existing model coverage; empty M&E geometry stays empty rather than invented.

2D navigation uses bounded long-lens zoom, camera-relative clipping and Fit drawing.
The main application's shortcuts and focus targets are isolated while Explore is
open. Source/alignment dialogs support Escape, trapped Tab focus and focus restore.
The narrow layout stacks the controls, canvas and evidence inspector.

## Browser validation

Checked repeated 2D zoom in/out and reset, original PDF rendering, structural
layer/grid toggles, measured-count selection, original S2.0 source viewing and
exact-sheet Extract in takeoff handoff. Checked alignment dialog's disabled save
before valid point pairs, cancel and original source images. Mathematical alignment
fit, bad-scale and mismatched-point rejection are covered by unit tests. Checked
480-pixel layout and restored desktop viewport. Runtime error/warning log was empty
on the integrated review tab after fixes.

Main-app testing used a separately named local QA copy of Kelso, with a real Build
worker output, existing PDFs and drawing text. Original project files were not
modified. Diagnostic screenshots and copied PDFs remain ignored under diag/.

## Remaining release gates

This is not a claim of complete automatic PDF/spec-to-BIM extraction. Missing
physical structural and M&E geometry still requires extraction and reviewed source
placement. A drawing overlay is evidence, not a measured 3D duct or structural member.
The saved-model stale guard is partial; a full revision fingerprint is still needed.
Room movement remains within one measured room, without invented door connectivity.
Review registration accuracy, long-session GPU/memory use and source coverage across
more projects before production release. Integrate Claude's reviewed baseline fixes
separately; this branch does not edit BuildView, shared Viewer or storage writers.
