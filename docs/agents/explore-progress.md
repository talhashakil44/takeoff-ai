# T11 geometry worker checkpoint — 2026-10-30

Active unattended Codex heartbeat: `explore-geometry-and-claude-repair-worker`,
every 30 minutes on the Explore chat. Separate gpt-build heartbeat owns the
Build workstream. Use `gpt-explore` identity on the existing `agents/bus`.
Claude acknowledged T11 and owns bus policy. This is not a main release.

## Current integration

Merged `claude/integration@a3dfd08` into Explore; preserved Claude's cached
BuildView loader. Added support for beam axes and grid locators to sheet-frame
recovery and layer reprojection. Unresolved structural enrichment now preserves
located grid markers rather than deleting them, while legacy invented cubes
remain suppressed. Physical shapes and symbolic axes/locators are distinguished.

Direct lintel head matches now require the correct architectural floor and
matching elevation datum. Regression fixtures reject coincident tags on another
floor and retain valid same-floor recovery. Room navigation now retains original
measured polygons even when Build deliberately excludes rooms from construction
geometry; no ceiling/slab quantities are invented.

## Evidence

- 479 tests across 66 files pass; TypeScript and production build pass.
- Private refreshed Kelso audit uses all 2,105 saved measurements, reads source PDFs,
  asserts source project bytes unchanged, and preserves measurement count.
- A2.1/A2.2 frame residuals 0 and approximately 3.6e-15 m respectively. This proves
  consistency with measured points, not correctness of every source trace.
- Live original-PDF/structural overlay and 3D inspected on A2.1. Selected B3 shows
  original 3.42 m takeoff, S2.0 source and S0.2 section 265 x 608 GLULAM; still an
  axis because framing elevation is unresolved. 128 structural records in view.
- Private evidence: `diag/explore/refreshed-audit.test.ts`, `refreshed-data.json`,
  `refreshed-report.json`, `refreshed-audit.log`, `integration-tests.log`, screenshots.
  These contain private project data and are intentionally not committed.

## Next bounded loop — do not mark complete

1. Claude supplied f43f48e and it is now merged: shared loader includes measured
   structural plans, preserves line colour and bumps cache v3. The real-project
   audit now uses the same linePlans selector. Verify fresh-cache main-app Build
   then Explore on next pass; no separate source-reader shortcut.
2. Establish actual framing elevation for measured B3 and other beam axes from
   S sections/elevation datums, then combine source schedule section and measured
   endpoints into physical geometry. Do not turn the level datum into beam height.
3. Audit roof framing (S2.1 currently unplaced), foundation-to-floor visibility,
   and cross-sheet trace alignment; do not shift levels just to make them visible.
4. Review both floors in live integrated app and refreshed preview, including
   zoom, sources, toggles and unresolved coverage. Inspect all gaps, not just tests.
5. Send source-backed checkpoint to Claude; only set T11 review when acceptance
   criteria are genuinely met. Keep repairing across heartbeat runs.
