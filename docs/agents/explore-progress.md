# T11 drawing geometry — active source reconciliation, 2026-10-30

Work continues continuously during the active chat. The 30-minute heartbeat is
recovery/follow-up, not a delay between repair iterations. Coordinate through
`gpt-explore` on the existing agents/bus. T11 remains **doing**. No main release
or deployment is authorized by this checkpoint.

## Current source and integration

Claude's source loader and extraction fixes are merged through `cc35e6f`.
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
- Twenty-three foundations: four locally dimensioned pads, thirteen exterior piers,
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
- Three WT-1 wall defaults are axes, not unsupported four-metre-high solids.
  Their complete footprints, opening cuts and vertical sections are unresolved.

The physical lifecycle restores source seeds before every pass and requires fresh
qualification. Missing or revised evidence cannot leave stale physical solids.
Exact coincident lintels retain both records and an unreconciled quantity warning.
Scene and IFC share solids, including parallel sloping beam faces and steel web
voids. Indexed tessellation and collinear trace joins are corrected to avoid
missing faces and coincident internal caps.

## Evidence and gates

Private evidence remains under ignored `diag/explore` and `/tmp`; do not commit
project PDFs or the test archive. Production audit uses `loadDrawingSources` and
`buildAll`, not a diagnostic-only bypass. The fixture now includes revised-page
coordinates. Independent checks cover source alignment, complete replay, removal
of all evidence, unchanged accepted quantities, IFC geometry and welded topology.
Floor overlays and metrics are under `diag/explore/proofs`.

A separate local project, “Kelso geometry integration review”, was imported through
the normal application UI. The user's original project/PDFs were not changed by
that import. Complete main-app visual checks again after the checkpoint; HMR
reloads during development are not final visual acceptance.

## Remaining — do not mark T11 complete

- Eight roof cantilevers now reach drawn free ends. Three left C/D/E placements
  use plan 6/S3.0 and a grid-1 girt note despite a contradictory elevation title;
  those remain inferred with explicit discrepancy notes. Left B and right E
  extensions remain unresolved and their support spans are labelled incomplete. Distinguish
  B2/B3 frames from separate R2 purlins. Do not assign an upper purlin level to a
  lower frame beam or apply purlin notch notes indiscriminately to B2/B3.
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
- Finish main-app both-floor, source-link, layer and zoom checks. Share the actual
  checkpoint and evidence with Claude. Automated PASS alone is never acceptance.

## Latest independent audit

All 125 current structural/foundation solids (111 lifecycle-qualified plus 14
canonical opening/lintel solids) load through IFC and have manifold welded
topology. Maximum independent volume difference is 0.00345%. All 2,108 takeoff
records retain quantities, units and identities. Complete geometry replay is
stable. Removing the grid-1 note withdraws exactly three cantilever extensions;
removing S3.0 profile vectors leaves only the two independently supported
longitudinal extensions. These checks establish consistency, not full coverage.

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

Latest checks: 561 tests passed including the optional private-fixture check with its
required environment; TypeScript and production build passed. Full source
withdrawal removes all structural/foundation solids, full replay changes no
elements, and all 2,108 takeoff quantity/unit/type/measurement/sheet tuples remain
unchanged. Initial loading and unresolved coverage remain open work.
