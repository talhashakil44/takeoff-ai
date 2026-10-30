# Explore Drawing — measured coordination workspace

Branch: `codex/explore-drawing`, based on Build It checkpoint `e5ecd0d`.
Work is isolated from Claude's review fixes. Facts, scope, extractModel, the shared viewer and project storage writers are unchanged.
BuildView has a source-reader addition outside the separately owned header edits.
The launcher is an additive `ExploreHost` in `src/App.tsx`. Structural recovery also
runs in `buildAll`; the Build It source reader loads measured structural plans.

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
separately; the structural source-reader addition is isolated from its header and scheduling edits.


## Structural takeoff connections

Explore now resolves existing structural count records through drawing evidence,
without adding to or replacing accepted takeoff quantities. The Structure tab
lists the current floor's structural takeoffs; selecting one enables its source
layer. Isolate structural members removes other trades from the spatial view.

The lintel resolver joins strong plan linework between drawn jamb supports,
including strokes interrupted by text. Schedule extraction uses the SIZE column,
not the adjacent POSTS column. Architectural elevation grid rows locate matching
window tags; calibrated window details provide the opening head datum. The model
records the resulting span, section, datum, source sheets and issued rough-carpentry
specification link. All such placement remains inferred and reviewable.

Kelso validation resolves all 14 existing L1/L2 tags on S2.0. Both schedule sizes
are two 38 x 184 members (combined width 76 mm). The existing takeoff labels copied
supporting-post descriptions instead; some also carry a Metals classification.
Explore flags these conflicts and preserves the accepted labels, quantities and
classification. This is not a silent estimate rewrite.

The source-derived span is the drawn opening/member stroke, not a fabrication cut
length. Bearing extensions, rough-opening allowances and final structural approval
are not asserted. Addendum 2 Section 06 10 00 provides material/workmanship clauses;
it does not resolve a numeric lintel bearing allowance. Opening heights derived
from calibrated details remain inferred, with original evidence links.

Review / connect geometry opens the original plan and a selectable reference
sheet side by side. Users can define a member run, simple panel boundary or square
post, supply section and datum, record their source explanation, then explicitly
save a reviewed placement. Missing dimensions, missing sources, invalid polygons
and unconfirmed reviews cannot be saved. Existing reviews reopen with their values.
Reviews persist locally per project/model, invalidate when the source measurement,
type or sheet changes, and can be reset. Manual reviews currently apply locally to Explore. Automatically recovered members
also run through the shared Build It worker pipeline and native IFC export after
a rebuild. IFC classifies lintels as beams, not walls. Original quantities stay intact.

Unresolved steel profiles, panel extents and wall assemblies remain review items;
no generic count cubes are rendered for them. A counted F1 span annotation is not
silently converted into a measured CLT area. Source reading covers structural
plans with existing takeoffs, structural schedules and window elevations locally.

Validation adds schedule-column/conflict tests, supported-span tests, invalid-shape
rejection, quantity/identity immutability and stale-review tests. The ignored real
Kelso audit asserts 14 connected lintels with section and elevation references.
Private PDFs and project fixtures are excluded from Git.


Structural integration verification: 409 tests across 57 files pass; TypeScript and
production build pass (baseline chunk-size warning remains). The local Kelso audit
also executes the complete build pipeline with the same level hints and source
linework as the app, verifies the 14 resolved records, writes IFC, and uses
IfcOpenShell to instantiate all 14 IfcBeam/LINTEL meshes. This checks model/export
geometry independently of the Three.js renderer. Reviewer-created placements are
still local to Explore; they are not automatically promoted into the shared build.
