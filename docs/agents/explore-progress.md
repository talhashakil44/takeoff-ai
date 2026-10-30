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
