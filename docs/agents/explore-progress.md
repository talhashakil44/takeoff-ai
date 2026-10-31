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
- Thirty foundations: fifteen source-qualified pads, nine exterior piers,
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
  expose their drawing references and acceptance status. Model version 33 forces
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

Latest v32 independent production replay: 132 accepted-source structural/foundation
solids plus three drawing-only MF3 solids; all 2,108 accepted quantity tuples unchanged.
A complete replay changes no recovered objects; removing all evidence withdraws
all derived solids and candidates. Independent IFC validation creates all 135 closed
solids without topology failures (maximum relative volume discrepancy 0.00345%).
Drawing candidates have no IFC quantity sets. The rebuilt 2,115-record engine project
connects the same three MF3 footprints to accepted takeoffs, with no duplicate
drawing candidates; all 135 physical solids are then accepted-source geometry.
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
- Pad coverage: 15 of 34 accepted F1/F2 pads recovered (one alternate-qualified).
  The remaining nineteen require local datum, compound-footprint or sump evidence.
  Southeast F2 now has qualified inferred top continuity through its adjoining MF2;
  north grid-8 corners intersect SF-N slab thickening.
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


### Step limits and next independent source target

Claude's follow-up search found no plan-symbol/profile-face mapping in the notes
or specifications. His July S0.1 general-note reference gives 600 mm maximum rise
and 1200 mm minimum spacing; the revised detail image gives 610/1220 mm. Keep the
source distinction visible. A conservative 600/1220 envelope is only a limit,
not evidence locating a transition, and has not been used to invent a solid.

The next independent source pass targets the two southern F2 corner pads. Their
scheduled rectangle boundaries may be interrupted by actual returning SF1/SF2
junctions rather than missing source ink. Qualification must account for each
interruption using paired, scheduled-width source edges and still prove the local
datum without crossing a step. North grid-8 pad cases intersect SF-N slab
thickening and remain separate; no rectangular default is applied to them.


## Southwest F2 junction recovery — version 30

The southwest F2 scheduled 1800 × 1800 × 300 mm component is recovered from
its actual exposed perimeter and three source-proven strip openings. Each
opening requires returning boundary pairs with matching stroke weight and
scheduled width/depth; the old coverage thresholds were not relaxed. Its
local -0.250/-0.550 m datum is inferred through the source-bounded SF2 after
the visible step, with a 600 mm SF1 branch explicitly accounted for.

The step detector now considers stroke weights that actually cover both local
strip boundaries. Unrelated heavy wall strokes elsewhere on the same coordinate
must not create a false step; removing a real local step still cannot erase its
effect. The southeast F2 remains withheld because its datum path crosses an
MF2 junction without sufficient continuity evidence. The two northern SF-N cases
remain separate.

Independent v30 QA verifies 134 closed solids in both the legacy and rebuilt
engine projects, unchanged accepted quantities, identical replay and complete
evidence withdrawal. Both prior SF1 spans and all three MF3 shapes are exactly
unchanged from v29 in both projects. A final robustness review also excludes
remote collinear strokes from local perimeter pen-weight qualification.

Compiled main-app review confirmed 29/154 foundation shapes, the new F2 component
at -0.250/-0.550 m with 1800 × 1800 × 300 mm dimensions, explicit inference labels,
its revised-PDF overlay and source page 21. Drawing zoom, floor changes and 3D
focus were exercised; no browser errors were recorded. Private screenshot:
`diag/explore/proofs/sw-f2-foundation-v30.png`. The final local-stroke guard does
not change this project's geometry; independent source QA rechecks that guard.

Next: trace southeast F2's actual MF2 junction and local datum chain, then inspect
north SF-N compound footprints independently. Do not propagate across unqualified
mass-footing or stepped-strip connections. T11 remains incomplete; roof free-end,
roof assembly and foundation coverage gaps above remain open.

Final v30 gates: 578 tests in 85 files, TypeScript, production build and
Kelso/Frederick audit pass. Post-guard actual-source replay confirms all 134
physical shapes exactly unchanged in each project from the independently
validated IFC snapshots. No original project or PDF was edited.

## Review follow-up — branch qualification and southeast datum chain

Claude's review of `2474910` identified a generalization risk: two unrelated
return strokes at scheduled spacing could masquerade as a strip branch. Actual
southwest returns are dashed polylines; their immediate segment lengths differ
(4.68 versus 9.72 PDF points). Equal immediate lengths alone are not a valid gate.
The next qualification pass must use actual continued branch geometry and reject
dimension arrow/tick endings, with decoy and source-withdrawal checks.

Independent original-PDF review of the southeast corner establishes a direct
SF2 top/bottom of -0.250/-0.550 m and a separate MF2 top/bottom of
-0.250/-0.650 m. The mass body occupies PDF box
[2013.24, 1132.08, 2154.84, 1183.08]. These prove matching tops but different
300/400 mm depths. No direct corner-F2 leader or uniquely applicable section was
found. The southeast pad remains withheld. A future top-continuity resolver must
qualify both actual mass/strip junctions, reject intervening steps, retain each
member's own scheduled depth and label the inferred continuity. It cannot copy
MF2's bottom into a 300 mm pad or relax the existing equal-depth strip gate.
Private original source crop: `/tmp/se-datum-investigation.png`. Findings and
review request were sent to Claude through T11's existing bus.

Claude subsequently agreed to inferred TOP continuity only when both independent
SF2/MF2 leaders agree, both junctions have continuous qualified outlines, and no
step symbol/crossbar/note intervenes. Both leader references must be retained;
withdrawing either, changing a level or inserting a step must withdraw F2. Its
bottom remains top minus its own scheduled depth. This is the next implementation
contract, not a statement that southeast F2 has already been recovered.

The version-31 branch gate now traces same-pen dashed edges to an actual cap,
paired schedule-width bend, or closed mass rectangle corroborated by its local MF
tag and revised schedule. At most one nested branch is followed. Endpoint
dimension ticks and arrow edges reject decoys. Mass attachment proves topology
only; it does not transfer an elevation. Synthetic missing-return, unmatched bend,
uncapped-return, tick and arrow tests exercise the gate; the raw original-PDF
fixture still recovers the southwest component and rejects missing branch/step
evidence. Final integration and visual gates follow below.

Version-31 independent production rebuilds preserve all 134 source-backed
physical shapes exactly in both projects (the comparison additionally covers two
building-context shapes). Accepted tuples are unchanged; replay changes nothing
and source withdrawal removes all derived solids/candidates. Fresh legacy IFC
validation creates 134 manifold solids with maximum relative volume discrepancy
0.00345%; its three drawing-only footings have no quantity sets. Engine geometry
is exactly identical to its validated IFC snapshot. The compiled app rebuilds
through the normal loader and retains 29/154 foundation shapes and the southwest
component's dimensions, datums and inference labels. Private final visual proof:
`diag/explore/proofs/sw-f2-foundation-v31.png`.

## North grid-8 source distinction — revised 10/S1.2

Independent source review traced S0.2's SF-N type ST to revised 10/S1.2
(Addendum 5 page 23). The detail is explicitly a SLAB THICKENING OPTION:
200 mm total depth below finished floor, 600 mm flat underside and 2:1 sloping
sides. It is not the 300 mm deep SF1/SF2 foundation strip and cannot establish a
deep F1 pad's elevation. Original detail and plan crops are
`/tmp/sfn-detail10.png` and `/tmp/grid8-a-d-context.png`.

The F1 records near PDF centres [1911.144, 819.936] and [1911.144, 1136.016]
remain unresolved. Future recovery must distinguish projected slab-thickening
ink from the F1 scheduled 1500 × 1500 × 300 mm component, prove that component's
own boundary/tag association, then independently qualify its foundation datum.
Do not union the projected SF-N outline with the pad or borrow the slab underside.
The optional-detail designation remains part of the source qualification.

## Southeast F2 — version 32 source shoulder qualification

The incoming SF2 edge widens before MF2. The original source contains a closed
filled shoulder subpath 420 at [2013.24, 1110.84, 2055.5995, 1132.08], attached
to mass-footing subpath 373 at [2013.24, 1132.08, 2154.84, 1183.08]. The direct
strip leader tip [2055.72, 1110.96] lands at the shoulder corner. This is a
separate source topology segment; the constant-width SF2 gate must stay intact.
The outgoing connection from MF2 bottom y1183.08 to F2 top y1216.2 is straight.

Claude reviewed this detail and accepted top-only inference subject to continuous
source boundaries, both independent leaders, and no step/crossbar/STEP text.
The shoulder's thickness is not established by the plan. It must remain unmodelled;
neither SF2's 300 mm nor MF2's 400 mm thickness may be assigned to it. The adjacent
Note 2 refers to the buttress wall and does not establish the shoulder depth.

Version 32 recovers southeast F2 as an explicitly inferred scheduled rectangle
component, top -0.250 m and bottom -0.550 m from its own 300 mm depth. Both
independent strip/mass leaders, the closed shoulder and its drawn sides, the
straight outgoing band, and the pad perimeter remain required. No shoulder solid
is created. STEP annotations in each path segment, a standalone outgoing
crossbar, conflicting elevations or removal of either leader/shoulder connection
withdraw the pad. Earlier recovered geometry is preserved. The full harness
passes 579 tests in 85 files, TypeScript, production build and Kelso/Frederick audit.
Original source overlay: `/tmp/explore-foundation-next/se-top-continuity-verified.png`.

Independent v32 QA confirms 30 accepted-source foundation shapes and 135 total
structural solids in each project: legacy 132 accepted plus three drawing-only;
engine 135 accepted with no duplicates. Only southeast F2 is added; all prior
134 source solids are unchanged. All 2,108/2,115 accepted tuples are unchanged,
replay is stable and source withdrawal removes derived solids/candidates. Both
fresh IFC exports create 135 manifold solids, maximum volume discrepancy
0.00345%; legacy drawing-only footings still have no quantity sets.

The normal compiled-app rebuild exposes 30/154 S1.0 physical shapes. Live 2D
and focused 3D source overlays were inspected, including the linked revised
page 21 and inspector top -0.250 / bottom -0.550 / own depth 0.300 m. Browser
errors: none. Private proofs: `diag/explore/proofs/se-f2-foundation-v32.png`
and `diag/explore/proofs/se-f2-foundation-v32-plan.png`.

Current next action: qualify north grid-8 F1 component boundaries separately
from the optional SF-N slab-thickening projection, then independently establish
the deep footing datum. Do not borrow the slab underside. Remaining roof
free-end elevations, roof assembly and foundation coverage remain open.
T11 is incomplete; source and visual acceptance plus Claude review still apply.

## North grid-8 review and readable evidence — October 30, 22:33 wake

Claude approved model32 / eedec90 on the bus at 22:19:55Z. Fresh integration
fetch was reviewed without merging shared Build files.

Independent review traced the nearby -1200/-1500 note from its datum circle
[1936.32,935.88] east through [2018.64,935.88] to the actual triangular arrow
[2030.28,956.04]. It targets the eastern SF2/F2 transition, not grid-8 A/D F1.
Original proof: `/tmp/grid8-b-leader-full.png`. No independently linked deep
section was found for those pads. Both remain withheld while A's distinct
scheduled component and north SF1 connection are investigated; SF-N never
supplies a deep datum. This corrects a possible proximity-based association,
not an existing accepted quantity or physical shape.

The narrow evidence inspector clipped long source names and their page numbers.
Drawing-source buttons now wrap within the panel. Compiled live review verified
the longest source at 207 px client and scroll width, revised page21 opening,
and no browser errors. Proof: `diag/explore/proofs/source-labels-wrapped-v32.png`.
This CSS change does not change the model or its 135 verified structural solids.

Grid8/A source audit now isolates the exact missing proof. Candidate F1 rectangle
[1890,799.32,1932.48,841.80] matches the 1500 mm schedule, but the deep left
side below incoming SF1 (y819.48–841.80), bottom-left x1890–1900.20, and incoming
lower SF1 edge x1879.20–1890 are absent. The last gap is approximately381mm.
Those intervals overlap separately labelled SF-N, not a proven300mm-deep strip.
Existing qualified north SF1 ends at x1879.20. Borrowing SF-N returns would
manufacture both the pad perimeter and datum path. Independent overlay reviewed:
`/tmp/explore-foundation-next/grid8-a-deep-boundary-gap.png`. No new solid added.

Next bounded geometry work shifts to the unresolved roof free-end elevation
chains while Claude reviews whether any additional north-pad detail exists.
Northern A/D recovery requires independent boundary/datum evidence before retry;
the source ambiguity must remain exposed, not converted to measured geometry.

## Roof end-bay source audit — October 30, 23:03 wake

Claude confirmed the northern8/A typical exterior low-pier detail5/S1.1 is only
an inference candidate; it does not close the missing pad footprint. No north
pad solid was added. Integration and bus were fetched; shared files remain untouched.

Revised S3.1 page30 has a material title/grid/member conflict. The E8–9 title
is above actual grid bubbles6/7 at [1418.55,193.54]/[1718.79,193.54], with B3
at [1568.69,331.59]. The E1–2 title is above actual4/5 bubbles and another B3.
S2.1 references1/2 S3.1 match those interior bays. Neither can establish B2
end-bay extensions. Its lower rowA B2 profiles apply to already recovered A
members. Revised S3.0 covers leftC–E/rightD–B only. S4.2 sections7/8 show
purlin profiles; S5.0 entry/stair/transition details do not uniquely identify
leftB/rightE B2. Architectural A3.3 cuts lie between letter grids. These are
specific source association gaps, not permission to mirror or substitute levels.

Source crops and exact associations: `/tmp/roof-freeend-review/source-proof.md`,
`s31-gridE-title-vs-actual-grids.png` and `s42-sections7-8-purlin-profiles.png`
in that directory. Original revised-PDF crops were visually reviewed.

The existing unresolved-cantilever warning was buried in collapsed review notes.
It now appears alongside the selected beam's revision evidence, explicitly
stating that the displayed support span omits an unresolved free-end extension.
Compiled live UI verified both leftB grids1–2 and rightE grids8–9, 2D/3D switching,
unchanged265×608mm sections, and no browser errors. Private proof:
`diag/explore/proofs/roof-incomplete-span-warning.png`. No model geometry or
accepted quantity changed; eight qualified extensions and135 structural solids
remain the last verified geometry checkpoint.

Next: request Claude's independent source resolution for the conflicting S3.1
end-bay titles; continue independent stepped-strip placement/section association
while these two free ends await unique applicable evidence. Do not repeat
unchanged searches or count support-only spans as complete cantilevers.

## Step-symbol extraction failure — October 30, 23:33 wake

Actual-source ablation removed only five SF/S.F. text labels from revised S1.0,
leaving all vectors intact. This incorrectly produced an east SF2 flat solid
across the drawn step (band x2030.28–2055.72, y1056.48–1110.84) and assigned a
previously withheld west MF2 an unsupported propagated top -1.200 m. Source
proof: `/tmp/east-step-ablation-source.png`; reproducible changes and references:
`/tmp/sf-label-ablation.json`. Both recovery paths require independent drawn
step-symbol rejection, not only OCR/text recognition. Model33 invalidates older
saved derivations once the protective fix and validation below are complete.

Claude's new roof references were traced through actual cut vectors. 4/S4.0
runs at x1029.48, about673mm beyond grid2's x1010.4 support, through the adjacent
B3 span rather than B2's x770.76–1010.4 end bay. 4/S5.0 explicitly describes
entry-roof framing. Nearby CANTILEVER labels refer to R2 purlins. These do not
resolve the two B2 free-end elevations; no roof extension was fabricated.

The fix independently recognises inward step arms touching both local footing
boundaries, matching their pen weight. Split and full crossbars qualify; thick
wall/tag bars, outside ticks, diagonal ticks and one-sided arms do not. Both
continuous-strip recovery and mass-footing datum propagation use this guard.
The durable regression covers withdrawal of a previously recovered flat strip
and mass while preserving the valid adjoining strip. Sixteen foundation tests
and TypeScript pass. No transition profile or new footing volume is inferred.

Compiled model33 was rebuilt through normal Build It, then reviewed in Explore
in2D and3D. S1.0 retains30/154 physical shapes; the affected11.65mSF2 remains
a plan axis with physical geometry withheld, and its accepted quantity remains
visible. Browser errors:none. Private proofs:
`diag/explore/proofs/step-symbol-guard-v33-plan.png` and
`diag/explore/proofs/step-symbol-guard-v33-3d.png`.

Independent final validation: both projects retain exactly135 source physical
shapes, byte-equivalent to their pre-fix shapes; all2108/2115 accepted quantity
tuples and original projects remain unchanged. Replay changes nothing; removing
all evidence removes derived solids/candidates. Removing only the five SF labels
now adds ZERO solids: false east SF2 and west MF2 are blocked. Two prior east
F2/P2 candidates conservatively withdraw under that ablation; drawing-only MF3s
are unchanged. Prior IFC validation applies to the identical shape objects.
Evidence: `/tmp/sf-label-ablation.json`, `/tmp/final-replay-report.txt`,
`/tmp/engine-replay-report.json`, `/tmp/pre-step-fix-legacy-shapes.json` and
`/tmp/pre-step-fix-engine-shapes.json`.

Next action: obtain Claude review of the independent vector guard, then target
remaining foundation-wall height/section associations. The stepped transition
still requires source-defined profile placement; roof free-end references remain
unresolved. T11 is not complete; do not equate this protective repair with new
geometry coverage or mark the automation complete.

## FW4 source-only wall contract — October 31, 00:03 wake

Claude approved18934b8. The next source audit found an accepted extraction
mismatch: FW4 id04b94a04-65cd-451b-8d2d-a825efed80d6 follows horizontal tag
leader [2015.16,881.94]→[2042.94,881.94], quantity0.9800167m, rather than the
vertical wall. This was sent to Claude for engine review; accepted data stays
unchanged. Architectural FW1/FW2 finish walls are distinct from structural
FW-1..FW-5 foundation walls and are not reclassified by their names alone.

Independent plan/section review qualifies a bounded drawing-only candidate:
closed hatched panel [2036.52,826.56,2049.48,899.88], actual457.2mm≈nominal458mm
ICF assembly and2.5866m length. The actual6/S1.1 cut crosses at y880.92 with
shaft x2019.48–2191.80; y881.94 belongs to the nearby accepted tag leader.
Section6 plus adjacent NOTE1 identifies ICF wall top250mm below ground0 and
footing top-1200mm, giving950mm height. The concrete core is300mm; assembly
width must not inflate concrete volume. Core centering and extending the section
datums across this closed panel remain explicit inferences. No step/local
override was found inside this panel. Source crops:
`/tmp/fw4-cut6-panel-proof.png`, `/tmp/fw-exterior-section6.png`.

FW5 buttress section1 has a sloping top and its local mass-footing datum remains
unresolved; no default4m wall is created. The apparent unresolved-axis offset
was separately checked: all37S1.0 foundation axes match their authoritative
measurement-to-world transform within2.01e-14m, so no arbitrary reprojection
was applied. Comparator: `/tmp/foundation-frame-readonly.json`.

### Model 34 verification and next action

Implemented the bounded FW4 concrete-core candidate and legacy accepted-axis
warning. Independent dual-fixture QA found exactly one new physical shape:
136 total in both legacy and frozen engine models; all previous 135 shapes and
all accepted measurement tuples are unchanged. The exact recovered length is
2.5865667 m (rounded drawing coordinates give 2.5866 m). IFC validates as a
closed IfcWall, volume 0.737172 m³, with no quantity set. Replay is identical;
withdrawing source evidence removes the candidate. Tests: 581 passed, one
skipped across 86 files. Final bus harness is recorded separately after commit.

Claude integration 0a38bfc independently fixes the engine leader extraction.
The latest engine JSON has 2,113 measurements, SHA256
915605c4e79c1625b27cff101ef79e5c35b3029631b565b1f02b4aa1632b3262.
Comparison against the frozen 2,115 input confirms exactly two semantic
removals: the FW4 annotation leader and its paired SF2; no added measurements
or other source-point changes. The engine still misses the actual panel.
Explore preserves each input's quantities and adds only drawing geometry.

Live model34 inspection confirms four drawing candidates in the legacy project,
correct 300 × 950 mm section and -1.200/-0.250 m datums, explicit inference and
no-takeoff labels, functional original PDF source link, and visible 3D wall.
Proof: diag/explore/proofs/fw4-wall-core-v34.png. Independent source overlay:
/tmp/explore-foundation-next/fw4-core-source-overlay.png. The actual section
cut is y880.92; y881.94 is the annotation leader (corrects the earlier bus note).

Remaining UI acceptance gap: 2D zoom in/out stays responsive, but the new below-
grade wall is not clearly distinguishable in the top-down PDF view. Investigate
its footprint/occlusion and selected-member focus in Drawing mode next; the
source viewer also opens the whole page rather than focusing its evidence box.
Do not call the live 2D overlay fully accepted from the 3D screenshot alone.
Roof free-end profiles, stepped-footing profiles and unresolved foundation-wall
bases remain incomplete. Request Claude review of this checkpoint; T11 remains
active and no main merge or deployment is authorized.

Final clean-commit harness on 3f463b1 passed TypeScript, all 582 tests, build,
and the source audit; posted automatically to Claude. The earlier direct test
run skipped one environment-dependent audit; the configured harness ran it.
The 2D gap is now traced to ExploreScene.tsx: footprint construction filters
on the active architectural sheet only, while all solid meshes hide at zero
lift. Next action: project registered visible-sheet structural/drawing-only
footprints into Drawing mode, distinguish drawing-only styling, honor layer
visibility, and verify with close original-PDF overlays and zoom cycles.

## Structural plan projection — October 31, 00:33 wake

Claude approved model34 FW4 recovery; engine tag-leader selection remains Claude
T37. Explore now projects the existing registered physical geometry edges onto
the PDF datum for every visible discipline sheet, rather than only the active
architectural sheet. Coincident top/bottom edges collapse; vertical edges drop.
Unresolved axes retain centreline-only representation; locators and guessed
building shells do not acquire fabricated footprints. No source/model/quantity
or extraction files changed. Layer visibility, drawing-only visibility and
structural isolation apply to plan lines too. Projection lines draw after PDF
overlays. Added Locate member on drawing alongside the existing 3D focus.

Live verification on the legacy model34 project: FW4's core outline is inside
its wider hatched ICF panel, aligned at both ends. The drawing-only toggle
removes/restores this outline; disabling S1.0 removes its PDF and all structural
footprints; restoring it and zooming out/in preserves alignment. Original PDF
raster is visibly soft at this zoom; improving source rendering and stronger
plan-line visibility remains worthwhile. Proof:
diag/explore/proofs/fw4-plan-overlay-v34.png. No geometry placement changed.

Next: source viewer evidence-box focus and sharper source raster at close zoom;
then remaining source-defined roof ends and stepped footing/wall profiles.
T11 remains incomplete. This viewport repair does not close those geometry gaps.

## Evidence-detail viewer — October 31, 01:03 wake

Claude approved 3e62df0. Source references now pass their existing evidence boxes
to the original-PDF viewer. ExploreHost can rasterize just that region with
surrounding context, up to 4 pixels/PDF point and a bounded 1800-pixel long edge.
It clips to the original page and rejects invalid/out-of-page regions. This is
an optional capability: hosts without detail rendering retain the whole-page
viewer. Show whole page / Focus evidence preserve access to the complete source.
No model, extraction, accepted quantity, original JSON or PDF changed.

Live source review: FW4 plan link opens the actual closed hatched panel;
section link opens 6/S1.1 with DROP FOUNDATION WALL 250, FIN. GROUND FLOOR 0,
and T/O FOOTING -1200 visible together. Whole-page toggle restores the original
S1.0 title block and complete sheet. Proof:
diag/explore/proofs/fw4-source-section-detail.png. This improves evidence
inspection, not structural coverage. The scene's full-page texture still has
its earlier raster limit; adaptive detail inside the 2D/3D scene remains open.

Next action: return to source qualification of unresolved roof free ends and
stepped-footing/wall bases, using the now-readable reference details. Preserve
all unresolved coverage flags; no default solid/profile. T11 remains active.

## Stepped-axis evidence — October 31, 01:33 wake

Claude approved fd49f07. Re-read original revised 5/S1.2: underside slopes
7 vertical : 10 horizontal, rise is 610 MAX, spacing MIN 1220. These are not
actual placement dimensions. S1.0 crossbars locate steps but do not uniquely
map the top face or ramp endpoints. No stepped solid is qualified by this pass.

Model35 now explains a held strip axis when the existing vector guard finds a
step matching both footing-edge pens. It adds a specific missing-profile warning,
a bounded original-plan source link and the same-revision stepped-detail link.
The latter is explicitly a reference, not proof of local applicability. Axes
remain axes; physical shapes and quantities are untouched. Withdrawn crossbar
evidence removes this annotation on replay; resolved solids are not annotated.

Production source-loader checks pass for legacy and current engine. Exactly one
11.650133m SF2 axis is annotated in each: legacy43f2688b-c728-430f-9242-d91de4942082,
engine632dc9c7-870b-4964-8f37-65721520602c. All legacy shapes, drawing candidates
and quantity/unit tuples compare identical to the model34 baseline. Current
engine accepted tuples still match its own extraction. Do not compare regenerated
engine IDs against the older frozen project as if the input were unchanged.
Reports: /tmp/step-evidence-final-report.json, /tmp/step-evidence-engine-report.json.

Live review confirms unchanged11.65m, explicit unresolved geometry, revision
pages21/23, and the source crop containing the actual SF crossbars along the
axis. Proof: diag/explore/proofs/step-axis-source-v35.png. Asked Claude for a
specific setting-out/section reference mapping the crossbar to the transition
face. This is an evidence/coverage improvement, not added solid coverage.

Next: investigate independently source-bounded FW5 buttress profiles with known
local MF2 bases; do not extend the west MF3 section datum to them or assume the
sloped top is4000mm throughout. T11 remains active. Roof-end profiles and stepped
transition placement remain unresolved; no merge/deploy.

## FW5 source reconciliation — October31, 02:03 wake

Claude approved e95d4cd. Directly compared original structural S1.0 and revised
Add5 S1.0 vestibule crops: original labels both vertical walls FW5; revised
changes the left to FW1 and alters/adds return extents. Current engine still has
left FW5 record00f61a83-b5d1-46da-a2d7-b7bbc6dca7bc at5.784850m. This is an
addendum reconciliation gap, not an original-sheet extraction mistake. Sent
exact label/leader positions and engine/legacy IDs to Claude; changing type
alone would leave stale length. Originals, accepted tuples and runtime untouched.
Durable source report: docs/agents/evidence/fw5-revision-review.md.

East MF2/FW5 investigation reached a specific source limit: plan NOTE5 explicitly
requires stair/grading coordination for wall tops. Claude visually reviewed
A5.2 exterior stair sections: no local buttress top endpoints; the5065 wall-top
note belongs to an interior stair and must not be borrowed. He is raising the
specific RFI. No uniform4000mm top or west Ef profile assigned to east panels.

Original/revised PDF crops inspected, current/legacy model records checked.
Live browser verification unavailable on both attempts (`browser.user is
unavailable`); no new live-pass claim. No runtime edits or new test run in this
source-only checkpoint; e95d4cd remains the last verified code checkpoint.

Next: consume Claude's vestibule revision reconciliation; independently inspect
west Ef MF3 local base and section applicability. East FW5 top profiles stay
held pending new evidence, without repeating the same source search. T11 active;
no main merge/deploy and no claim of completed geometry.

Claude response02:06:57Z: confirmed the July-sheet records are superseded and
logged revision re-issue as T38, awaiting the user's move-takeoffs decision in
the existing app flow. Do not silently retype/recalculate the original project.
He requested both vestibule records show a source-backed superseded notice in
Explore, with 1/S1.1 excluded from the left wall. Next implementation should
bind that notice to revised source evidence (not hardcoded measurement IDs),
then verify it in both legacy/current projects and live UI when available.

## Revised wall label evidence — October31, 02:33 wake

Model36 follows straight perpendicular wall-label leaders with heavy target
bars to registered unresolved foundation axes. A unique FW label becomes a
bounded revised-PDF source link. A different code adds a local type-conflict
warning, never a new type, length, elevation or solid. Matching labels explicitly
do not validate old extents. Missing/ambiguous evidence removes this annotation
on replay. No hardcoded document or measurement IDs.

Production source-loader runs pass in legacy and current engine projects:
22 axes have target-matched revised labels; two have type conflicts. Known
vestibule FW5->FW1 is one; the other is a FW2 callout on the39.4335m FW4 axis
(legacy1858d899-c10f-4dfc-bff7-e3333521aea3; engine31aa4e01-a79c-4c35-ac9c-1d8b1b50b32f).
Original revised-PDF crop [1350,740,1460,855] independently confirms the latter
FW2 target bar. This is a local conflict, not proof the entire long run is FW2.
Legacy project and all physical shapes/candidates compare exactly to baseline;
production tests preserve accepted quantities in both project versions.

The right vestibule FW5 fails the tight old-axis/leader-tip association, so it
is not force-linked. Its extent/placement remains a re-issue reconciliation gap.
Claude has the exact findings. T38 is still the revision workflow, not automatic
mutation of the original project.

CUA again reported browser.user unavailable. Used isolated local Chromium with
the actual ExploreWorkspace and production model/source data instead: verified
5.78m unchanged, conflict warning, original-PDF FW1 leader crop and 2D/3D modes;
no page errors. Proofs: diag/explore/proofs/revision-type-conflict-{2d,3d,source}-v36.png.
No new physical solids; this is evidence integration. Next: independent west Ef
MF3 datum/section audit; await new source for east buttress top and T38 for
revision reconciliation. T11 remains active, no main merge/deploy.

## Bracketed west Ef mass datums — October31, 03:03 wake

Claude approved c152b6b and confirmed FW2 is an Add5 revision, not a July
extraction error. Independently audited all seven closed MF3 rectangles in
Add5 S1.0. Two unresolved interior masses are bracketed by agreeing resolved
mass datums with both SF1 edges at y1244.76/1261.80. Actual crossbar guard and
S.F. text search found no step on the connecting intervals or mass crossings.
The two outer unresolved candidates still have larger missing junction/return
intervals, so ordinary dash tolerance cannot close them.

Model37 adds conservative horizontal-row datum inference. It requires each
mass's own closed scheduled footprint, a directly dimensioned strip band,
source strokes on both connecting edges, no step, and agreeing resolved masses
on both sides. Conflicting/missing seeds, missing edges/junctions and step
markers reject recovery. No new connecting strip solids or wall profiles.
Accepted type and quantities remain unchanged; source-only candidates retain
zero quantity and planning exclusion.

Exactly two new MF3 solids: tagx1642.5043 and1792.6243, footprints
[1589.76,1189.56,1632.24,1365.24] and[1739.88,1189.56,1782.36,1365.24]. Each is
1.5x6.2x0.4m, inferred top-0.250/bottom-0.650m. Legacy drawing-only candidates
increase4->6 (fiveMF3 plusFW4). Current engine accepted MF3 solids increase3->5
of7; its original accepted quantity tuples match extraction. Source-loader
production checks pass for both projects. Legacy comparison confirms all prior
shapes, original project and prior quantity/unit tuples unchanged, only two
new drawing shapes. IFC independently resolves each new drawing solid to3.72m³
with no quantity set attached.

Actual-source withdrawal: removed the upper SF1 edge across1632.24..1739.88;
normal production loader then withdraws both new solids and returns the prior
four drawing candidates. Source and accepted quantities untouched. Unit checks
cover missing/conflicting seeds, missing edges/junctions, step marker/callback,
accepted quantity preservation and keeping an existing solid unchanged.

Local Chromium review of actual ExploreWorkspace: checked2D footprints over
originalPDF layers, settled3D, own footprint evidence crop, inferred qualifier,
1500x6200mm section and0.4m depth/-0.65bottom/-0.25top. No page errors. Proofs:
diag/explore/proofs/mass-chain-{2d,3d,source}-v37.png. Source-backed geometry
coverage increases136->138 including drawing candidates; this does not establish
buttress wall tops. Section1/S1.1 has no footing datum or dimensioned top profile.

Next: assess the remaining two outer MF3 junction gaps against revised canopy/
vestibule detail1/S1.0; do not bridge the missing edges by widening dash tolerance.
T38 revision reconciliation, east buttress top profiles and roof free ends remain
open. No main merge/deploy; T11 remains active pending complete source coverage
and Claude review.

### Close-zoom drawing-plane repair

Focused visual QA exposed diagonal/stair-step patches in overlapping PDF layers
at close2D zoom. The base PDF and shadow-receiver planes wrote nearly coincident
depth, while overlays already disabled depth writes. Disabling depth writes on
those two reference planes removes the artifacts without moving any geometry
or disabling solid depth testing. Focused source-aligned MF3 outline remains
coincident. Verified wheel zoom in/out, settled3D and source viewer using the
actual component; no page errors. Close full-page raster remains soft; this
repair addresses depth interference, not adaptive source-raster resolution.
Proofs: diag/explore/proofs/mass-chain-focused-{2d,3d}-v37.png and
mass-chain-zoom-{in,out}-v37.png. Geometry checkpoint38c684a already pushed with
592tests/tsc/build/audit PASS; renderer checkpoint follows its own clean gates.

## Outer MF3 source audit and overlay clarity — October31, 03:33 wake

Claude approved b551fe9. Independently read revised1/S1.0 canopy plan and2/S1.1
section against the two unresolved outer MF3 rectangles. The apparent missing
band intervals are actual revised return/junction gaps (17.04pt and12.72pt),
not ordinary4.44–4.56pt dash gaps. Neither detail supplies a local footing
height, and there is no agreeing resolved mass to the left. No new solid or
widened dash tolerance. Durable exact coordinates and required evidence:
docs/agents/evidence/mf3-outer-junction-review.md. Sent to Claude for any new
applicable local datum; do not repeat unchanged searches.

Independent display repair: structural overlays discarded source detail by
resizing a3500px original-PDF rendering to2048px. They now retain the bounded
3500px canvas (reusing it without a second allocation when already within the
limit), and use the same hardware-supported anisotropic texture filtering as
the base PDF. No model coordinates, datums, extraction or accepted quantities
changed; runtime model version remains37.

Actual ExploreWorkspace/Chromium review: focused MF3 outline still matches the
original drawing; FW5/NOTE2/pier tags and hatching are visibly clearer than the
previous screenshots at the same view. Wheel zoom in/out, settled3D and the
original-PDF detail viewer pass without page errors or diagonal depth artifacts.
Proofs: diag/explore/proofs/overlay-quality-focused-{2d,3d,source}-v37.png and
overlay-quality-zoom-{in,out}-v37.png. This preserves available raster detail;
it is not vector rendering or unlimited zoom resolution. Source geometry
coverage remains138 physical shapes including drawing candidates.

Next independent implementation candidate: selected-source detail tiling with
explicit crop-to-sheet registration, rather than increasing whole-sheet memory
without bounds. Continue source-defined roof/free-end and remaining datum gaps
only when new applicable evidence is available; pending T38 remains separate.
T11 active, no main merge/deploy, no completion claim.

## Registered source-detail tiles — October31, 04:03 wake

Claude approved a5696bd and agreed bounded detail tiles are the next independent
improvement while remaining geometry awaits applicable source evidence. Added
optional renderTile host capability carrying actual PDF crop bounds and actual
page dimensions. It reuses the existing1800px maximum/4px-per-point source
region budget. Exact allocated pixel edges map to exact PDF bounds, including
integer raster rounding. SourceViewer remains compatible through renderDetail.

A focused structural member gets one local detail tile. Only source boxes on
the applicable page containing that member's registered centre qualify; a stale
focus from another member does not. The first live review caught a smaller
inherited datum source being chosen instead of the selected member: fixed with
the centre-containing guard and a regression test. Dimension mismatch, failed
render or unavailable capability falls back to the existing whole-sheet image.
Changing focus, source layer or selection cancels stale requests/clears detail.

Scene clips the registered viewport polygon in PDF coordinates into disjoint
coarse/detail pieces, then transforms them through the existing sheet frame.
Detail replaces coarse ink rather than darkening it twice. Coarse texture is
shared by its pieces and disposed once; one bounded detail texture is added.
Tests cover rotated polygons/area preservation, page-edge crops, invalid bounds,
source-page selection and inherited evidence/stale focus rejection.

Actual ExploreWorkspace with the production renderSourceTile helper and original
Add5 p21: first MF3 tile bounds[1709.88,1159.56,1812.36,1395.24],410x943px;
second member correctly switches to[1559.76,1159.56,1662.24,1395.24]. Inspected
close2D, wheel zoom in/out, settled3D, originalPDF viewer and view reset. Fine
hatching, pier/rebar symbols and FW5/NOTE2 text visibly sharpen while the source
outline remains coincident. No page errors or depth artifacts. Proofs:
diag/explore/proofs/detail-tile-focused-{2d,3d,source}-v37.png,
detail-tile-zoom-{in,out}-v37.png and detail-tile-fit-restored-v37.png.

No extraction/model/accepted quantity changes; model37 and138physicalshapes
remain. This adds focused structural-source detail, not unlimited viewport
rasterization or new geometry. Next: extend explicit crop registration to base
floor-plan evidence/focused spaces, then bounded viewport-driven requests if
needed. Remaining roof/footing datums require new source evidence, not repeated
unchanged searches. T11 active; no main merge/deploy or completion claim.

## 2026-10-31 04:38 UTC — base-plan evidence detail and room camera framing

Claude approved 11dd89d crop partition/selection on the bus. Confirmed the caller
clamps padded bounds before returning a tile; added a page-edge regression.
Fetched agents/bus and claude/integration; ownership remains Explore-only.

Explicit Locate on original drawing now loads one bounded tile on the base plan,
including measured rooms with no physical construction solid. Source selection
requires this sheet's original evidence and its focus centre; malformed/stale
references are rejected. Actual PDF page dimensions must match the frame.
Cancelled/stale requests, selection/sheet changes, hidden base and Fit drawing
clear detail. Whole-sheet fallback remains. Paper is partitioned into disjoint
coarse/detail pieces using the same registered PDF-coordinate mapping as layers;
shared coarse material, opacity, texture filtering and depthWrite=false preserved.
No additional geometry or quantities are created.

Live QA exposed a separate camera issue: a focused room has no solid bounding
box, so switching into3D previously fell back to a 4m view and landed against a
wall. Camera now frames the original evidence rectangle and the existing heights
of intersecting visible model members. This is camera framing only; it supplies
no inferred construction dimensions or solids.

Actual original A2.1/page9 (2aea012b-8217-41a9-a017-56196c3daf8c): STAFF OFFICE116
crop[402.8565,1146.7652,579.1063,1279.8576],705x533px. STAFF ROOM109 switches to
[395.5428,770.1446,718.9285,1027.9713],1294x1032px. Checked original-PDF detail,
registered close2D, wheel zoom in/out, settled3D, source selection switch and Fit.
Original quantities remain10.57m2 and56.72m2. Model37/138physicalshapes unchanged.
Both base-plan and MF3 structural overlay browser checks report no page errors.
Inspected proofs: diag/explore/proofs/base-tile-focused-2d-v37.png,
base-tile-focused-3d-v37.png, base-tile-original-source-v37.png and
base-tile-fit-restored-v37.png. Targeted10tests and typecheck pass; clean checkpoint
full harness follows. Production helpers used by the actual ExploreWorkspace.

Next: correct 2D Fit orientation after returning from spatial view (the PDF stays
registered, but reset currently retains a diagonal heading). Then review focused
room status labeling: rooms with measured boundaries but no construction solid
currently say Unplaced. Roof endpoints/outer MF3/step ramps remain held pending
new source evidence; requested exact new evidence from Claude instead of repeating
unchanged searches. T11 remains active; no main merge/deploy or completion claim.

## 2026-10-31 05:08 UTC — searched room selection and corrected visual timing

Claude approved fb11113 material lifecycle and room camera framing. Fetched bus
and integration; read current standing prompt as gpt-explore.

Correction to the previous next action: the diagonal Fit screenshot was captured
mid-transition, not a settled heading defect. Temporary camera instrumentation
showed transition=.944 after the old120-requestAnimationFrame wait. Waiting for
transition===1 on unchanged fb11113 camera gives azimuth0, polar.000001 and an
upright original A2.1 plan after free3Dorbit/return/Fit. Removed the attempted
azimuth lock and all diagnostic instrumentation; no camera code changes retained.
Use actual transition completion or elapsed time plus settled-frame verification,
not a fixed frame count, for future visual acceptance. Evidence:
diag/explore/proofs/heading-baseline-settled-v37.png; /tmp/heading-baseline.log.

Real UI fixes: valid measured roomStops now display Measured space rather than
Unplaced, with detail text Measured space · no construction solid. This does not
label arbitrary shape-less items as placed; roomStops' original polygon/datum
validation remains required. Search selection now sets roomId for those rooms,
matching ordinary room-list selection. Previously Enter room stayed disabled
when selecting a valid room through search.

Actual ExploreWorkspace verified STAFF OFFICE116 search→entry→Escape→Fit,
original A2.1 evidence, room label and retained10.57m2 quantity. The room view
continues to disclose Assumed2.7m height; it is not a measured construction solid.
No browser errors. Inspected search-room-entry-v37.png and
search-room-exit-plan-v37.png; original PDF and3D/2D zoom/source switches checked
in heading baseline loop. Source/model/extraction/accepted quantities untouched;
model37/138physicalshapes unchanged. Clean checkpoint harness follows.

Next geometry iteration: audit independent unplaced structural coverage against
available source references, excluding the already exhausted roof endpoints,
outerMF3 and stepped-footing datum gaps unless new evidence arrives. No broader
geometry acceptance implied by this UI correction. T11 active; no merge/deploy.

## 2026-10-31 05:41 UTC — retain registered column footprints and cross-view review

Claude approved ownership of columnGeometry.ts and requested per-column centres
and pairings for engine T39. Read original S2.1/page8 visually: separate LOW ROOF,
HIGH ROOF and CANOPY viewports. Page-coordinate proximity alone is not evidence
of duplicate physical columns. Existing viewport registration plus closed plan
rectangles matching the scheduled sections locates86 column records; the direct
section tracer resolves16 before its existing duplicate-display handling.

Previously the located-but-unresolved records discarded their footprint evidence
and still reported no scale/calibrated floor registration required. Model38 now
retains the source footprint reference and reports the actual remaining gap:
base/top elevations or distinct-storey identity. It compares registered centres
within10mm and matching code/section across different source/view footprints to
flag possible same column lines. It never merges counts or adds/removes shapes.
Resolved coincident viewport records do not get a false unresolved-height note.
Stale evidence is withdrawn when its source no longer qualifies. UI notes use
source/page/view descriptions; stable record IDs live in the review artifact.

Production loaders (legacy fixture and current2113 engine project) both pass.
Legacy source comparison: exact original project and all2112(id,shape,quantity,
unit) tuples unchanged.86footprint refs,73records with cross-view candidates;
46of47shape-lessC1 have recovered footprint evidence.138physicalshapes unchanged.
Three targeted tests cover count/shape invariance, nearby/different-section
rejection and stale evidence withdrawal. Model version38 invalidates stale cache.

Actual ExploreWorkspace reviewed selected C1 unresolved record, source review
notes, original Add5/page25 PDF footprint and settled2D/3D. No new column solid
appears and the original1ea remains. No page errors. Proofs:
diag/explore/proofs/c1-plan-review-v38.png,
c1-original-footprint-v38.png,c1-withheld-3d-v38.png.
Review data with registered centres, source boxes/pages, candidate IDs and PDF
hashes: docs/agents/evidence/column-plan-review-v38.json. These are possible
column-line matches, not duplicate or separate-storey determinations.

Next: investigate the lone C1 without a qualifying plan rectangle/registration,
2ef1bfde-26e8-4fde-b239-33000abbda2e at originalS2.1(495.4173,1315.2360), in the
separate1:50canopy detail. Establish that viewport's own grids/scale before any
placement. For the main C1 group, trace explicit S3/S4 column base/top sections
before replacing any unresolved record with a solid. Claude uses candidate data
for T39 read-only; accepted counts remain untouched. T11 incomplete, no deploy.

## 2026-10-31 06:10 UTC — canopy C1 registration and complete result access

Claude approved ddaf1e5 and is retaining accepted counts for T39 review. Existing
canopyRegistrations already checks printed1:50 against E/Ef/3 actual grid strokes
and architectural references; columnGeometry had omitted that registration path.
Added it for closed-column footprint recognition. Canopy domain remains separate
from floor/roof and explicitly skips section-height tracing/duplicate-solid
propagation. T/O ENTRY CANOPY is not adopted as a column base/top. Registration
basis now accompanies retained footprint quotes. Model39 invalidates old cache.

Canopy C1 2ef1bfde-26e8-4fde-b239-33000abbda2e: actual revised box
[471.36,1321.68,486.36,1341.12], registered centre[-4.85245536,.56812013]m;
frame residual .00175256m.87column footprint records now retained. It is within
10mm of main-roof C1 667bb35d-bac2-448a-8523-c1a395be61c8, itself without a solid.
This is a possible shared column line, not a duplicate-count conclusion. Plan
registration/evidence artifact: docs/agents/evidence/canopy-column-plan-v39.json.
No additional C2 rectangle qualified; no tolerance or guessed dimensions added.

Production legacy/current-engine loader checks pass. Exact legacy original
project and all2112(id,shape,quantity,unit) tuples unchanged from model38; all
138physicalshapes retained. Actual-source regression in canopyRegistration test
requires the canopyC1 footprint, null shape and unchanged quantity; removing Ef
from actual source texts withdraws the footprint and still creates no solid.
Targeted6tests pass, including source ablation. Full checkpoint harness follows.

Live review also exposed the60-result truncation hiding later structural entries.
Added incremental Show more results, reset on query/scope/floor changes. Actual
C1 search expands60→87 and permits selecting the final canopy record. Its revised
Add5p25 footprint opens correctly; original1ea, unresolved-height/cross-view notes
and settled2D/3D inspected, no page errors. Proofs in diag/explore/proofs:
canopy-c1-plan-review-v39.png, canopy-c1-original-footprint-v39.png,
canopy-c1-withheld-3d-v39.png. No PDF or source project edits.

Next: trace column base/top at grid3/E in the section evidence for the paired
canopy/main-roof C1 records, before any vertical solid is allowed. Canopy C2 needs
its own scheduled rectangle/section evidence; current recognition fails closed.
T39 remains Claude-owned, all counts retained. T11 active/incomplete; no deploy.

## 2026-10-31 06:39 UTC — tiled drawing picking repair; 3/E section audit

Claude approved91433e1 and supplied section candidates. Read original revised
S4.0/Add5p31 and S5.0/p33 plus canopy plan: 4/S5.0 cut passes through the canopy
bay beyond Ef, whereas C1 is at3/E. The entry roof detail shows wall/beam assembly,
not a directly located C1 base/top. No height copied to either pairedC1 record.
S4.0 sections still require exact cut identity before their E-post endpoints can
be applied to3/E. Sent this concrete finding to Claude; no repeated new blocker
or inferred column solid. Original PDF/project/quantities preserved.

Live drawing audit found a regression introduced with base paper tiles: paper
became a Group but onUp still raycast with recursive=false. Even changing only
that flag would be wrong because each detail tile's UV covers its own crop.
New drawingHit helper intersects child meshes and maps the hit's world X/Z back
through the registered sheet frame. Hidden paper cannot receive a room pick.
No camera, model, source extraction, geometry or quantity changes.

Two regression tests use actual Three.js ray intersections on disjoint paper
children with independent0..1UVs and a rotated source frame. They cover both tiles,
outside hits and hidden drawing rejection. Targeted tests/typecheck pass.
Live original A2.1: focus STAFF OFFICE116, click detail tile context to select
112 RECEIVING & GEN.STORAGE, click coarse paper to return to116. Accepted areas
remain25.91m2/10.57m2. No browser errors. Settled3D→Drawing→Locate source→pick also passes;
proofs diag/explore/proofs/paper-picking-neighbour-v39.png and
paper-picking-spatial-v39.png. Model39/138physicalshapes remain unchanged.
Full clean checkpoint harness follows.

Next geometry work: source-cut identity and explicit vertical endpoints for the
unresolved main-roofC1 groups; canopy C2 closed outline must match its actual
scheduled section before any column marker/solid. Do not infer C1 height from
entry-canopy datum or an unrelated building section. T11 remains incomplete;
no main merge/deploy.

## 2026-10-31 07:12 UTC — four canopy C2 plan witnesses

C2 recognition failed for two independent reasons: the generic structural section
reader intentionally excludes HSS solids, and the actual plan symbols have rounded
corners rather than rectangular closed faces. Added a separate schedule-linked HSS
plan-envelope reader (COLUMN SCHEDULE, MARK/SIZE/NOTES column and row boundaries,
positive wall thickness, conflicting rows withheld). The generic solid reader is
unchanged. The canopy-only path reads actual closed black stroke loops; rejects
open/branched/filled/dashed/ambiguous outlines. The outside dimensions retain the
8mm schedule tolerance. Following Claude's review, also require a closed inside
face matching width/depth minus twice the scheduled wall, concentric within2mm
(source vertices quantized to0.12PDFpt, about2.12mm at1:50). No bridging missing ink.

Revised S0.3/Add5p20 specifies C2 HSS127x127x9.5; revised S2.1/Add5p25 shows
7.20pt outside /6.12pt inside outlines at1:50, approximately127/108mm. All four
C2 records now retain schedule and registered footprint evidence. Model version40;
no new heights or solids and no count reconciliation. Source ablation removes
one actual outside corner stroke: that footprint is withdrawn, other3 remain.
Targeted tests also reject a missing inside face or displaced inside loop.

Live UI inspected original revised C2 source crop, settled2D and3D. Source modal
opens the actual rounded C2 outline. Review notes explicitly retain unresolved
base/top elevations; no fabricated C2 solid appears. Browser errors=[].
Proofs: diag/explore/proofs/canopy-c2-{original-footprint,plan-review,withheld-3d}-v40.png.
Production comparison and full clean harness follow this checkpoint. T11 remains
incomplete. Next: exact canopy C2 section-cut identity and base/top endpoints;
main-roofC1 vertical endpoints, outerMF3 datum and steppedSF2 remain unresolved.
Do not infer elevations from the entry-canopy datum. No main merge or deploy.

## 2026-10-31 07:39 UTC — registered plan envelopes visible in Explore

Claude approved4f915ae. Fetched bus/integration and reread current workstream
prompt. Reviewed original revised S2.1/Add5p25, S5.0/p33 and S6.0/p34. Entry-roof
4/S5.0 shows wood walls and packed beams, not directly identified C2 base/top
endpoints. No inferred column heights. This is one source-cut audit, not a new
verified elevation or repeated blocker.

Closed a user-facing integration gap: registered column positions previously
survived only as evidence prose. Model41 retains world-space plan envelopes from
actual source outline bounds transformed by the verified viewport frame. These
are separate from physical shape and have no vertical datum. Explore draws the
unresolved subset amber on paper only; selection highlights orange. It honours
source-layer/footprint visibility, excludes demolished elements and does not feed
mesh bounds,3D solids, quantities or IFC geometry. List/facts state plan verified,
height/elevation unresolved. Locate verified footprint targets the plan envelope.
Switching to3D fits the actual scene rather than aiming at an invented column
height. Cached envelopes are cleared at the start of every physical source pass,
including when revision gating skips the column resolver; source ablation also
withdraws the envelope.

Production project, accepted element quantities/units and all physical shapes
compare exactly equal to prior checkpoint. Evidence: column-plan-display-v41.json.
Live original-PDF source crop, aligned C2 floor overlay, zoom in/out/Locate,
footprint visibility off/on and3D transition inspected. Proofs under
 diag/explore/proofs/canopy-c2-*-v41.png. No new C2 solid. Full clean harness follows.

Next: exact C2 column section-cut/base-top identity, main-roofC1 endpoints, outer
MF3datum and SF2steps remain open. Plan envelopes are placement evidence only;
do not upgrade them to solid geometry or reconcile counts automatically. T11
active/incomplete; no main merge/deploy.

## 2026-10-31 08:08 UTC — direct selection of verified plan envelopes

Fetched current bus/integration; Claude approved7c2c3fd. Repaired the next live
integration gap: clicking a displayed verified column envelope previously fell
through to room picking. Drawing clicks now test visible plan-only envelopes in
registered world coordinates before rooms. Hidden layers/footprints, demolished
records, withdrawn rings and physical solids are excluded. Repeated clicks cycle
coincident record IDs deterministically; this is inspection, not deduplication or
count reconciliation. UI explains this behavior. No model version or source
geometry change. Applied Claude's lifecycle identity nit: unrelated elements
without cached plan footprints retain object identity, while stale footprints
still clear before source qualification.

Actual live C2 interaction: starting record0, click adjacent envelope at933,533
in1600x1000 viewport selects record1. With footprint checkbox off, same click
leaves record0; re-enable and it selects record1. Original-PDF link now opens
that second C2 beside the B7 tag on revised S2.1/Add5p25. Inspected direct-pick,
original-source and settled3D screenshots; no fabricated C2solid, browsererrors=[].
Proofs diag/explore/proofs/canopy-c2-{direct-pick,original-footprint-picking,
withheld-3d-picking}-v41.png. Unit coverage includes rotated rings, overlapping
record cycling, missing/demolished/physical exclusion and lifecycle identity.
Source/model production checks and clean harness accompany checkpoint.

Next bounded geometry audit: main-roof C1 at grid2/B against the corresponding
4/S4.0 cut; establish actual cut identity and vertical endpoints before copying
an elevation. C2 base/top, outerMF3 datum and steppedSF2 remain unresolved.
T11 active/incomplete; source geometry and accepted quantities unchanged. No
main merge/deploy. Do not treat this interaction repair as new physical geometry.

Validation note: the older ad hoc engine-fixture test expected1 unaccepted drawing
candidate, but Claude's refreshed Kelso engine project now produces0. Compared
against a read-only archive of HEAD7c2c3fd with identical source PDFs: baseline
also produces0, passes5 physical MF3 of7 and preserves input quantities. The
frozen original drawing fixture still passes unchanged. This is not a new
physical-geometry regression; record current/baseline comparison with checkpoint.
Claude reports new standalone strip footing extraction in progress; do not
silently replace this task's frozen accepted project with the mutable engine data.

## 2026-10-31 08:40 UTC — two additional physical roof posts from viewport fix

Claude approved3d45158. Fetched bus/integration/current prompt. Corrected the
previous next-action premise: grid2/B already had separate floor/roof posts from
4/S4.0. Audited unresolved grid5/D in original revised S4.0/Add5p31 instead.
Closed source faces at x748.68/761.64, y1153.2..1372.8 trace successfully, but
section association failed before tracing: grid5 exists at cx1460.793 in both
high-roof(cy678.456) and low-roof(cy81.697) viewports on S2.1. Unscoped lookup
returned2 and rejected. Restricted header to the same150pt top band already used
for the referenced viewport/cut. No tolerance widening, nearest-grid guessing or
cross-viewport borrowing.

Model42 resolves high-roof C1 at5/C,D,E via2/S4.0; existing coincident suppression
moves the one5/C solid from low-roof record to high-roof record, retaining both
accepted count records. Net physical solids138→140. C,D,E bases4.149m; tops9.496,
9.959,10.423m respectively. These are calibrated section-derived positions with
existing10–20mm quantisation caveat, not fabrication heights. Quantities/units and
original project exact unchanged. Only4 element shapes change (3resolved,
1coincident solid suppressed). Evidence docs/agents/evidence/column-viewport-v42.json.

Actual source regression: delete own high-viewport5 header →5/Dsolid withdrawn,
plan footprint retained; delete other low-viewport5 →same physical shape retained.
Production frozen-source and current-engine checks pass; no source mutation.
Live selected roof5/D verified by displayed5.810mheight (initial diagnostic selected
floor record, corrected before evidence acceptance). Sourceviewer opens upperpost
on revisedS4.0p31, 2Dfootprint aligns with original plan, settled3D shows newpost at
4.149..9.959m. Also inspect5/E source/3D. Proof filenames in evidenceJSON; historical
'withheld-3d' suffix reused by script now shows the resolved post. Full clean
harness follows. C2 still no heights; no quantity reconciliation or main deploy.

Next: audit unresolved C1 at grid8/D against3/S4.0 with its own viewport header;
then outerMF3datum/SF2step endpoints. Do not infer members from dashed background
or transfer roof/post bearing elevations without closed source faces. T11 active,
incomplete; these two added solids are verified progress, not whole-model acceptance.

Audit follow-up: initial full harness passed617tests/tsc/build, then failed Kelso
no-derived-roof finish08-26 vs actual08-27. Claude confirmed his installed engine
project grew2113→2122 measurements and extra footing concrete moves dates+1day.
Archived previous source7c2c3fd passes the same current project with integration's
08-27/09-16 pins. Synced only these two benchmark dates; did not merge engine or
source-loader differences, alter quantities, or relax assertions. Final clean
checkpoint harness reruns against these verified fixture pins.
The final parallel test pass exposed the new optional real-PDF fixture test's
5s default timeout (three source-resolution passes on the247MBfixture); assertions
had passed in isolation and the first full harness. Set its explicit budget30s,
consistent with real-source integration work; no assertion or geometry tolerance
changed. Audit now passes with the independently verified updated date pins.

## 2026-10-31 09:10 UTC — SF-N schedule/detail evidence, no assumed solid

Claude approved40a5fe5. Fetched bus/integration/current prompt. Audited grid8/D
in revised3/S4.0(Add5p31): only dashed background grid/post indication beneath
beam section, no closed vertical faces. Withholding that post remains correct;
no height copied from grid5. Moved to independent foundation gap.

Original revised S0.2/Add5p19 explicitly lists SF-N, typeST, REFER TO DETAIL10/S1.2.
Original revised S1.2/p23 detail10 is SLAB THICKENING OPTION, visually dimensioned
200mm total depth from finishedfloor,600mm flatbottom,2:1 sloped sides. These are
not directly equivalent to the700mm planband or engine's assumed300mm rectangle.
Sent source finding to Claude for engine interpretation review; no accepted
quantity changes. Model43 links the actual schedule row and matching numbered
sheet/detail to unresolved SF-N records. Review issue explains local slab depth,
top elevation, sloped profile and applicability are still needed. No dimensions
are applied as physical geometry from this optional detail alone. Missing row,
wrong detail number/sheet, non-ST row, or conflicting reference withdraws link.

Production current-engine fixture contains4SF-N records, all linked. Compared
against archived40a5fe5 on exactsame snapshot: original project, every shape,
quantity/unit, planfootprint and drawingcandidate unchanged. Frozen original
project left untouched. Separate ignored QA page engine-sfn.html reads generated
engine-sfn-data.json; main frozen preview input not replaced. Live original-PDF
page23, 2D/3D and reviewnotes inspected; all4 remain axes, no new solids,
browsererrors=[]. Evidence docs/agents/evidence/foundation-slab-option-v43.json;
proofs diag/explore/proofs/sfn-option-*-v43.png. Real-source row-ablation test
and synthetic wrong-reference/conflicting-document tests pass. Full harness follows.

Next: establish SF-N option applicability from revised plan and local slab datum
before profile recovery; await Claude engine interpretation. For8/D, identify an
orthogonal section cutting the actual post rather than borrowing the dashed
background depiction. OuterMF3datums/SF2step endpoints also open. T11active and
incomplete; no main merge/deploy, no quantity changes or fabricated geometry.
