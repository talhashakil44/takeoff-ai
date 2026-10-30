# T11 drawing geometry — active source reconciliation, 2026-10-30

Work continues continuously during the active chat. The 30-minute heartbeat is
recovery/follow-up, not a delay between repair iterations. Coordinate through
`gpt-explore` on the existing agents/bus. T11 remains **doing**. No main release
or deployment is authorized by this checkpoint.

## Current source and integration

Claude's source loader and extraction fixes are merged through `cc35e6f`, with per-view scale `f42d95c`, schedule-row material classification `d874e4e`, and MF3 schedule-mark recovery `823b1d7`.
Addendum 5 reissues structural drawings on PDF pages 19–34, dated September 16,
including the new S0.3 schedule. These supersede the corresponding July sheets.
The shared loader reads drawing-sized addendum pages, including added sheets,
keeps coordinate-bearing text and vectors, and fingerprints them for stale Build
results. Build and Explore both use it. Original takeoff records are retained. Cache v4 preserves vector subpath IDs in both
cold and packed/warm paths; losing those IDs had prevented foundation recovery
in the actual app despite raw-vector diagnostic success.

Physical resolvers substitute revised evidence only after the named drawing grids
agree. Multi-view roof/canopy plans still have separate viewport scales and
registration. Derived references identify the actual addendum PDF page. Original
measurement references remain the quantity source. Explore uses registered revised
PDFs for structural overlays and exposes revision/type conflicts prominently.
Manual structural reviews invalidate when the document issue set changes.

Current private source: 2,108 measurements / 2,112 model elements. Geometry recovery
does not rewrite source project files, measurement IDs, types or accepted quantities.
Uncalibrated linear quantities are labelled as unresolved rather than displayed as
credible zero lengths. Source-derived spans remain separate.

## Recovered geometry at this checkpoint

- 25 floor beams: drawn support-to-support spans, top 3.775 m and bottom 3.167 m,
  corroborated by revised plan, 608 mm schedule sections and section linework.
  Independent raw-PDF checks match all 50 endpoints to drawn C1 outlines. The
  largest corrected interruption was 1.3335 m; quantities remain unchanged.
- 28 high-roof support spans and 15 low-roof runs, with distinct viewport frames,
  source-bearing/bay checks and structural beam datums. Four grid-A bays formerly
  designated B1 now use revised B3 physical sections (265 × 608 mm), with the old
  takeoff designation explicitly retained and flagged for reconciliation.
- Eight roof columns and eight floor columns have source section base/head
  associations. Floor columns at grids 2/5 × A–D use revised S4.0 sections 2/4:
  timber base +0.152 m, head +3.775 m. Column recovery receives the original
  registered frames before beam-end correction; snapped count locators are not
  treated as source-point correspondences. One coincident record is suppressed
  without dropping its accepted quantity.
- Four canopy B7 beams have centred plan ink, traced dogleg grid leaders and a
  drawn 20-vertex I-profile. Revised S5.0 corroborates the 6.623 m datum through
  the web; inferred steel bottom/top are 6.562675 / 6.769050 m.
- Twenty-eight foundations: thirteen source-qualified pads, nine exterior piers,
  two east MF2 mass footings, and four source-bounded SF1/SF2 spans. Revised
  pier tops are -0.250 m. Mass-footing depth is 400 mm and is not confused with
  adjacent 300 mm strip-footing notes. Pad/pier centres follow actual eccentric
  outlines. The north strip centre moved 48.7 mm onto its drawn boundary pair;
  its top -1.200 m is explicitly inferred from the connected dimensioned pad.
  Gaps require a matched scheduled pad or perpendicular strip junction; unsupported
  gaps stop recovery. A southern 3.7973 m SF1 span uses a direct -0.250/-0.550 m
  leader; a middle-west 1.9219 m SF2 span uses a direct -1.200/-1.500 m leader.
  Revised pier geometry height 0.950 m explicitly conflicts
  with accepted H=1.200 m formulas; accepted quantities remain unchanged.
- Six earlier pier solids were withdrawn after connected-footing review: their full
  footprints did not have a recovered local pad or bounded strip support at the
  required datum. A typical section alone does not establish each pier base. Two were subsequently recovered with their F2 pads through locally drawn SF2 bands and direct elevation leaders; the step must lie beyond the connection. Matching boundary stroke weights prevent wall faces from masquerading as narrow footing edges.
- Six northern F1 pads inherit top -1.200 m through closed, equal-depth junctions
  on the recovered no-step SF1 strip; both approach boundaries require matching
  source line weight. Nearby -0.250/-0.550 and -1.500/-1.800 leaders target
  separate interior pads, not these six. Continuity remains explicitly inferred.
- Grid 3/C F1 has an actual 4/S1.1 cut crossing only that pad. The local section
  specifies ground zero and a 250 mm drop; its ALTERNATE DETAIL qualification
  remains visible. The local BP3 schedule minimum embedment (150 mm) plus section cover (75 mm)
  must fit within the scheduled 300 mm depth. Missing or incompatible evidence
  withdraws this pad; increased actual embedment requires rechecking.
- Three MF3 foundations are recovered from closed revised plan outlines and the
  6200 × 1500 × 400 mm schedule. They have no accepted takeoff records and live
  separately in `model.drawingGeometry`: no quantities, materials or schedule
  assignments. The first and southeast top -0.250 m are direct; the middle top -0.250 m is inferred through
  the adjoining unstepped strip. All bottoms are -0.650 m. Explore and Build
  expose their drawing references and acceptance status. Model version 29 forces
  older geometry to rebuild; imported accepted takeoffs remain unchanged.
- Three WT-1 wall defaults are axes, not unsupported four-metre-high solids.
  Their complete footprints, opening cuts and vertical sections are unresolved.

The physical lifecycle restores source seeds before every pass and requires fresh
qualification. Missing or revised evidence cannot leave stale physical solids.
Exact coincident lintels retain both records and an unreconciled quantity warning.
Scene and IFC share solids, including parallel sloping beam faces and steel web
voids. Indexed tessellation and collinear trace joins are corrected to avoid
missing faces and coincident internal caps.

## Evidence and gates

Latest v29 independent production replay: 130 accepted-source structural/foundation
solids plus three drawing-only MF3 solids; all 2,108 accepted quantity tuples unchanged.
A complete replay changes no recovered objects; removing all evidence withdraws
all derived solids and candidates. Independent IFC validation creates all 133 closed
solids without topology failures (maximum relative volume discrepancy 0.00345%).
Drawing candidates have no IFC quantity sets. The rebuilt 2,115-record engine project
connects the same three MF3 footprints to accepted takeoffs, with no duplicate
drawing candidates; all 133 physical solids are then accepted-source geometry.
Physical pads/mass footings and strip footings export as IfcFooting; recovered
columns and piers export as IfcColumn. Inspector dimensions preserve millimetres.
Obsolete locator warnings are hidden only while fresh physical evidence qualifies;
withdrawing that evidence restores the baseline warning. This verifies geometry integrity,
not completeness against the drawings; the remaining source gaps below stay open.


Private evidence remains under ignored `diag/explore` and `/tmp`; do not commit
project PDFs or the test archive. Production audit uses `loadDrawingSources` and
`buildAll`, not a diagnostic-only bypass. The fixture now includes revised-page
coordinates. Independent checks cover source alignment, complete replay, removal
of all evidence, unchanged accepted quantities, IFC geometry and welded topology.
Floor overlays and metrics are under `diag/explore/proofs`.

A separate local project, “Kelso geometry integration review”, was imported through
the normal application UI. The user's original project/PDFs were not changed by
that import. The final compiled v29 main app was reviewed with the normal imported project.
HMR reloads during development are not treated as final visual acceptance.

## Remaining — do not mark T11 complete

All seven MF3 tags remain on both July and revised S1.0. Three recovered physical
MF3 solids are a geometry coverage count, not evidence of a seven-to-three revision.
Mechanical M1-05 gives curb heights but no horizontal purlin-to-curb offsets.
The experimental dashed-boundary graph finds competing source edges about 174 mm apart
and a small curb detour; graph connectivity does not establish the R2 zone. The
experiment is withheld from production, not presented as recovered roof geometry.
A2.3 roof lines repeat at 600 mm, not the R2 1200 mm spacing; alternating those
lines would invent the purlin phase. A3.3 section cuts lie between grid rows and
do not uniquely establish left-B/right-E B2 free-end elevations.


- Eight roof cantilevers now reach drawn free ends. Three left C/D/E placements
  use plan 6/S3.0 and a grid-1 girt note despite a contradictory elevation title;
  those remain inferred with explicit discrepancy notes. Left B and right E
  extensions remain unresolved and their support spans are labelled incomplete. Distinguish
  B2/B3 frames from separate R2 purlins. Do not assign an upper purlin level to a
  lower frame beam or apply purlin notch notes indiscriminately to B2/B3.
- Pad coverage: 13 of 34 accepted F1/F2 pads recovered (one alternate-qualified);
  16 have closed footprints but unresolved local datums, four lack unambiguous
  closed footprints, and one remains sump-dependent.
- Resolve additional footing leaders, west mass-footing datums, stepped strip
  intervals and foundation wall heights. Do not flatten stepped runs to one datum.
- The saved 702.065 m² slab outline follows exterior buttress projections and lacks
  an elevator-pit hole. Revised notes specify 150 mm slab; the exact slab boundary
  and pit junction require further source association. The solid stays withheld;
  accepted takeoff quantity stays intact. This is an extraction gap, not proof
  that the drawings are absent.
- Recover remaining column base/head and wall-opening associations, connection
  details and roof assembly coverage. Scaled drawing inferences are not fabrication
  dimensions. Show source-specific uncertainty rather than a plausible default.
- Finish final compiled main-app review after the latest source gates and camera fixes. Share the actual
  checkpoint and evidence with Claude. Automated PASS alone is never acceptance.

## Renderer and cantilever verification

The earlier 026d9d0 checkpoint established manifold topology, unchanged quantities
and replay stability before the later pier-datum review. Current counts are above.
Removing the grid-1 note withdraws exactly three cantilever extensions; removing
S3.0 profile vectors leaves only the two independently supported longitudinal
extensions. These checks establish consistency, not full coverage.

Main-app QA exposed costly synchronous reconstruction on a floor change. The
fix separates canonical source geometry from floor presentation. Actual-snapshot
floor presentation is about 1.1 ms and preserves all structural world coordinates.
The compiled main app now switches floors, retains zoomed drawings, displays
revised overlays and opens source-linked beam elevations. The graphics-context churn found during layer/focus changes is fixed: empty
pin arrays no longer recreate renderers, scene rebuilds reuse one context,
and final unmount releases it. The compiled main app survived over 50 mode,
layer, floor and focus changes with no context-loss fallback or browser errors.
A private lifecycle check also covers actual lost/restored events and 12 scene
rebuilds. Real initial source loading still takes several seconds; coverage
remains incomplete even though these interaction checks pass.

Version 29 checks: 576 tests passed including the optional private-fixture check with its
required environment; TypeScript and production build passed. Full source
withdrawal removes all structural/foundation solids, full replay changes no
elements, and all 2,108 takeoff quantity/unit/type/measurement/sheet tuples remain
unchanged. Initial loading and unresolved coverage remain open work.

Current v29 review: main Build isolated-footing framing now fits beside the inspector
at 1075px viewport width. Live wheel zoom in/out on both floors retained drawing/
footprint alignment. Explore 3D Fit now accounts for camera-space perspective depth and canvas aspect,
including selected members and assembly offsets. Whole-view framing prioritizes
visible physical solids; distant unresolved symbols no longer shrink the building.
Symbolic-only views retain their own fit fallback. Drawing-only visibility changes
without reconstructing the model or scene. Four projected-corner tests and the
private renderer lifecycle check pass. Final compiled v29 review confirms complete selected-MF3 framing, whole-model
framing without cropping, and immediate drawing-only toggles without camera jumps.
The MF3 solid was compared directly against the revised foundation overlay; source
page 21 opens in the evidence viewer. Both-floor wheel zoom round trips retained
alignment. Independent replay and IFC checks pass for both project versions.
Private proof: `diag/explore/proofs/mf3-foundation-overlay-v29.png`; camera proof
`main-build-mf3-camera-v28.png`; second-floor zoom proof `second-floor-zoom-v28.png`.


## Follow-up source review — 2026-10-30 16:40 EDT

Claude reviewed `dc2ffa0` and approved compatibility of the narrow shared UI changes.
His revised S1.0 datum inventory was independently checked against the original
Addendum 5 PDF. The east 400 mm mass-footing notes already belong to the two
recovered MF2 bodies; they are not additional geometry.

Two remaining SF2 strip datums are now tied to actual filled arrowheads:

- East: top -0.725 / underside -1.025 m; arrow subpath 23173 at
  (2055.72, 974.64), parallel boundaries x2030.28/2055.72. Step crossbar
  y959.52, next mass perimeter y1005.48: a 1.621367 m plan interval.
- West: same local strip levels; arrow subpath 23199 at (865.92, 1085.52),
  boundaries x865.92/891.48. Step crossbar y1059.72, next mass perimeter
  y1110.84: a 1.8034 m plan interval.

These are not yet constant-depth solids. Revised detail 5/S1.2 (Add5 page 23)
shows a stepped top and sloping underside: 7 vertical to 10 horizontal, maximum
610 mm rise and minimum 1220 mm between steps. The plan S.F. symbol does not
explicitly locate the transition face, ramp endpoints or axis. East's known
475 mm level change establishes a step but not both transition endpoints;
west also lacks the upstream mass-footing datum. A 300 mm box across either
whole interval would misrepresent the drawn concrete profile.

Next bounded implementation: associate the plan step with the section profile's
reference face and direction, then support multiple top elevations and a sloping
underside while retaining the one accepted measurement and quantity. Require
both local levels and profile placement evidence; do not assign a nearby strip
level to a 400 mm mass footing. Counts remain 28 physical foundations plus three
drawing-derived MF3s. Private evidence and original crops are recorded in
`/tmp/explore-foundation-next/stepped-strip-next-contract.md`.
