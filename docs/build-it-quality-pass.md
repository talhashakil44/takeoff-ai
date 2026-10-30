# Build It — geometry and workspace quality pass

Implemented on `codex/build-it-rework`, 2026-10-29. The owner accepted Kelso's approximately 13-month schedule and redirected work toward geometry, overall product quality and UI.

## Geometry and reliability

- Fixed a rendering arithmetic error that halved each wall segment's origin. Viewer walls now share the same coordinates as the IFC solids.
- Duplicate grid copies are resolved near the measured plan. Quarter-turn structural sheets are registered from corresponding grid labels and verified spacing. Kelso's second-floor and ground-floor footprint centres now agree within one metre in the real-project regression.
- Roof recovery requires agreeing opposing elevations, high/low beam datums, drawn roof lines and plan grid positions. Kelso's sloping roof and exterior wall heads use the same tessellated geometry in the viewer and IFC4.
- Frederick's fractional-foot elevation datums are read independently of the project's quantity unit. Different wing elevations are preserved as evidence rather than averaged; the dominant documented wing is the current reference, with conflicts flagged.
- Unsupported roof-screen/parapet heights and counted structural member spans no longer become arbitrary physical boxes. All original measurement records and quantities remain available.
- Invalid/stale model-cache versions are rejected. Target recovery runs in a worker; superseded UI responses cannot overwrite newer edits. Exports wait until the current result is available.

## Workspace

- Model mode opens on the building; Construction mode provides the schedule and playback.
- The model receives the main canvas area. Browser and inspector are optional, advanced view controls are expandable, and exports share one menu.
- A neutral material palette, quieter ground grid, building-centred camera and corrected scene lighting improve readability.
- Search and placement filters distinguish all elements, modelled elements and items needing placement. Keyboard activation and visible focus states were added to model-browser rows.
- Issues can be filtered by severity and their drawing/specification evidence opened directly.
- Responsive side panels avoid permanently squeezing the viewport. Reduced-motion styling and explicit update/error statuses are included.

## Validation

TypeScript, 389 tests across 55 files, the read-only Kelso/Frederick integration audit, IFC4 schema/EXPRESS plus every represented geometry, and production build passed. Vite retains its large-chunk warning. The integration audit checks source-file byte equality, retained takeoff count, target recovery, baseline restoration, footprint alignment and recovered roof heights.

Browser review exercised Model/Construction modes and earlier-target replanning. In the local test fixture, changing the target from unset to July 1, 2027 moved Kelso's computed finish from December 8 to September 21, 2027 and displayed the remaining 58-working-day miss. Those dates use the fixture's October 29 start; the reproducible integration audit uses November 2.

| Project | Measurements retained | Represented products | Registered sheets |
|---|---:|---:|---|
| Kelso | 390/390 | 322 | A2.0, A2.1, A2.2, A2.3, S1.0, S2.0, S2.2, S2.3, S2.4, M1-01 |
| 84 Frederick | 2803/2803 | 2658 | A201 |

## Not yet accepted as coordinated BIM

Full curtain-wall profiles, structural members, roof overhangs, occupied-floor versus lower-roof zones, and Frederick's spatial wing datums still need work. Window details and concave footprints now have bounded recovery, but are inferred until reviewed against the drawings. The current model must not be called architecturally complete or “world-class” solely on these checks. This pass fixes substantial correctness and interaction issues; it does not substitute inferred geometry for verified construction details.

## Follow-up geometry and product corrections

- Recovered 22 Kelso window dimensions, sill elevations and floor assignments from A8.3. Building-elevation grid labels locate their façade positions; openings cut both the host wall and any coincident inferred envelope. The source detail is retained on every recovered window. Dimensions obtained from drawn geometry remain inferred.
- Curtain-wall counts no longer produce arbitrary small window boxes. Four Kelso assembly references remain in quantities and the review queue until their complete sloping/stepped profiles can be recovered.
- Frederick's floor and roof boundaries now follow wall evidence around wing recesses. A bounded raster closure bridges gaps up to 3 m at 100 mm resolution; this is explicitly recorded as reconstruction, not surveyed geometry. Wide open boundaries fail recovery rather than silently closing. Closed-chain selection uses the largest candidate.
- Regression tests catch wing recess filling, open-boundary invention, unsupported window frames and invented curtain-wall dimensions. The real-project audit requires all 22 recovered window references and a concave upper Frederick footprint.
- Fixed material colours in Model mode for existing buildings. Construction mode retains existing/demolition states. Quality colours distinguish documented, inferred, assumed and review-needed geometry. The canvas card reports represented and unplaced counts separately.
- The orientation control now says sheet top rather than incorrectly claiming true north. Scene teardown disposes geometry, materials, background texture and shadow resources; unused selection materials are disposed as well.
- Source JSON files remained byte-identical in the final integration audit; all 390 and 2803 takeoff records remain represented in the data, whether or not they have displayable geometry.

Visual evidence: `diag/build-acceptance/frederick-workspace-v8.png`. This image still exposes floating services and unresolved placement/height assumptions; it is a diagnostic result, not a claim of coordinated BIM readiness.
