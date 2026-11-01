# Build It rework validation — 2026-10-29

**Historical first-pass report:** the counts, schedule dates and remaining-work
list below describe the earlier pass. Use [current handoff](build-it-handoff.md)
and [quality report](build-it-quality-pass.md) for the checkpoint state; rerun the
audit for current schedule results.

Status: **geometry and workspace quality pass implemented; architectural coordination remains incomplete**. The owner accepted the approximately 13-month Kelso duration on 2026-10-29; two years is no longer an acceptance target. See `docs/build-it-quality-pass.md` for the subsequent improvements.
Branch: `codex/build-it-rework`. No source takeoff files were edited.

## Implemented

- Shared building representation for playback and IFC, grid-bubble translation registration, metric elevation datums, derived slabs/envelope/roof, wall thickness and hosted rectangular openings. Derived building allowances remain separate from measured quantities.
- Existing/new/demolished status; ceiling-height placement and ceiling-space services. All measurements remain in the model, including unplaceable and invalid outlines, which are flagged rather than silently deleted.
- Full-scope planning allowances for omitted trades, long-lead procurement, weather assumptions, inspections and renovation phasing. Each allowance exposes its basis. These are planning assumptions requiring superintendent/vendor review.
- Earlier targets add crews and remove eligible same-crew level sequencing; physical, procurement, documented and manually edited constraints remain. Changes explain resource/congestion risk without inventing prices. Later targets rebuild from the lean baseline.
- Model cache invalidation covers all measurement vertices and placement inputs. Schedule, scene and IFC use the shared result.

## Verification

- `npx tsc --noEmit`: passed.
- `npx vitest run`: 55 files, 385 tests passed.
- Real-project read-only integration: passed, including before/after project-file byte equality, all measurement IDs retained, target recovery and baseline restoration.
- IFC4 EXPRESS/schema and geometry: both exports passed with zero errors (306 Kelso and 2,662 Frederick represented products).
- `npm run build`: passed; Vite reports its large-bundle warning.

Reproduce the real-project audit with:

```sh
BUILD_PROJECTS_ROOT="/path/to/Takeoff AI" npx vitest run -c bench/vitest.config.ts bench/buildModel.test.ts
python scripts/validate-build-ifc.py diag/build-acceptance/kelso.ifc diag/build-acceptance/frederick.ifc
```

The Python validator requires `ifcopenshell` and `pytest`. Local outputs under ignored `diag/build-acceptance/` include source hashes, full issues, driving chains, model snapshots and IFC exports. The audit reads existing project folders and writes only to that diagnostics directory.

## Real-project results

The audit fixes Kelso's assumed start at 2026-11-02 for reproducibility. Frederick uses its documented 2025-02-24 start. Frederick's target is substantial performance; Kelso's is project completion.

| Project | Source measurements retained | Baseline target-milestone date | Earlier target | Replanned date | Miss (working days) | Recovery changes |
|---|---:|---|---|---|---:|---:|
| Kelso | 390/390 | 2027-12-10 | 2027-07-01 | 2027-09-23 | 60 | 7 |
| 84 Frederick | 2803/2803 | 2027-07-16 | 2025-10-31 | 2026-01-13 | 52 | 38 |

Moving either target to 2035-01-01 restores the baseline durations, crews and links exactly.

Kelso's baseline is about 13 months, **accepted by the owner**. Its driving chain is frame fabrication → structures → envelope/weather-tight → mechanical rough-in → inspection → ceilings/trim → commissioning/closeout. After recovery, assumed switchgear procurement drives the finish. There is no verified two-year contract duration in the extracted facts. Site takeoff polygons include questionable extents; they were not used to inflate the duration. Reliable excavation/underground quantities, vendor lead times, production rates and construction sequencing still need substantiation.

Frederick specification Section 01 30 20, PDF page 44, states start February 24, 2025; phase-one occupancy July 28, 2025; substantial performance October 31, 2025; completion within 30 calendar days after substantial performance. The planner reads all four constraints. Its conservative top-down whole-floor phase assumptions drive a substantial overrun: each floor's access release, rough-in, inspection and finishes gates the next. Actual phase one covers third/second floors and ground-floor entrance/dining areas; treating the entire ground floor as phase-one scope is explicitly conservative and requires zone-level reconstruction. These results demonstrate a conflict with the contract, not a validated contractual schedule.

## Remaining architectural coordination

1. Kelso now has an elevation-derived sloping roof and matching exterior wall heads. Its roof outline/overhang, actual framing, façade glazing and opening dimensions remain incomplete. The shell is still inferred planning geometry, not a coordinated architectural model.
2. Registration resolves duplicate grid copies and quarter-turn structural plans. It supports single-ended grid families with cross-sheet spacing verification. Arbitrary-angle registration and vector validation of every grid remain outstanding.
3. Incomplete exterior runs still use a convex outline, which can bridge recesses. Source-backed closed boundaries and roof-plan outlines are still needed.
4. Frederick's imperial wing datums are parsed, with source evidence and explicit split-level warnings. The dominant documented wing supplies the storey reference; separate wing boundaries are not yet mapped.
5. Unsupported roof parapet/screen marks and structural span tags retain their quantities without invented full-storey walls or placeholder physical members. They can be found through the Needs placement filter.
6. Valid schema, geometry and automated tests do not establish complete architectural fidelity. The user accepted the approximate 13-month Kelso duration; the remaining work concerns model quality and product usability.

## Source project SHA-256 (unchanged after audit)

- Kelso: `3c2562933d1a76a42a0b58b2c8ddf3f584247a4710e43740c7dfb798df9c933e`
- 84 Frederick: `620cc8d3e7b9bc4c3ab650ef4279df24e58cb311a27db8704b9a9082efe471e4`
