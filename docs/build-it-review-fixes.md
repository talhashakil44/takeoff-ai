# Build It review fixes — Codex scheduling and evidence pass

Date: 2026-10-29. Branch: `codex/build-it-rework`. This follows checkpoint
`e5ecd0d` and Claude's read-only review. It is a development checkpoint, not a
merge or release. Claude's performance and timezone fixes are separately owned.

## Ownership and merge coordination

- Codex edited `scope.ts`, `plan.ts`, `replanTarget.ts`, `run.ts`, `types.ts`,
  `building.ts`, and scheduling/model tests. `extract.ts` has small edits to
  `MODEL_VERSION`, `tradeOf`, structural count placement and existing status.
- Claude owns **all** `BuildView.tsx` changes, including the target header,
  loading performance and stale detection; Claude also owns `facts.ts` date
  parsing. Codex did not edit either file.
- Claude may need the fingerprint code in `extract.ts` for performance. The
  fingerprint (`sourceHashOf` and `hashOf`) was not edited here. Resolve any
  concurrent `extract.ts` work by retaining both the fingerprint change and
  this model-version/classification change. Model cache version is now **9**;
  bump it again if Claude's model input contract changes.
- The separate `codex/explore-drawing` worktree and `src/explore/` are outside
  this branch's work. No original project JSON or PDF was edited.

## Findings 2–5

1. **Unsupported schedule scope.** The planner now schedules measured takeoffs
   (including unplaced measured items) and their linked spec-driven submittals,
   generic trade lead assumptions, testing and closeout. It no longer creates
   `scope:*` full-floor work or `longlead:*` switchgear/AHU/glazing/frame packages
   solely from a floor outline. This removes a large unverified portion of the
   old approximately 13-month Kelso programme. That duration was accepted as
   plausible, but it must not be preserved through unsupported work. Missing
   trades and vendor lead times require actual drawing/spec evidence and review.
2. **Job-specific rules.** An unnamed closed chain of wall runs can establish a
   candidate floor outline when it encloses nearly the whole wall network. It
   carries a drawing-review warning. Open unnamed fragments cannot become a
   convex hull. Explicit exterior labels still support the prior bounded
   reconstruction. The planner warns when a level has no defensible floor
   boundary. A phase occupancy date no longer makes a milestone over hardcoded
   `L3/L2/L1` whole floors: the actual rooms/zones must be mapped first.
   Existing status recognizes explicit words or a generic `...X2` coded mark,
   with `NEW` overriding it. Coded status is flagged for legend confirmation.
   Counted structural tags keep their quantities but
   stay unplaced until position, span and section can be established.
3. **Target header data contract for Claude.** Every `BuildOutput.schedule`
   produced through `planToTarget` now has
   `feasibility.baselineFinish: string` (ISO local calendar date, same target
   milestone as `earliestFinish`, before automatic recovery). The current
   `feasibility.earliestFinish` is after recovery, `feasibility.overBy` is the
   remaining working-day miss, and `feasibility.changes` lists each accepted
   resource/overlap change. If `overBy === 0` and `changes.length > 0`, the header
   should say **fits with N changes**, display the baseline finish and link to
   the change list. If `overBy > 0`, display the miss and N changes already
   attempted. If no changes were accepted, do not imply acceleration. `target`
   and `setup.targetFor` distinguish project completion from substantial
   performance. The interface marks `baselineFinish` optional for compatibility
   with direct `schedule()` callers; Build It's `planToTarget` always sets it.
4. **Historical start.** `replan` adds a `historical-start` warning when the
   chosen start precedes the current local date (or audit reference date),
   retaining the spec source. It leaves the contract date unchanged. A current
   forecast needs an explicit remaining-work start and progress evidence.

## Current real-project audit

The read-only integration audit uses **2026-11-02** as its reproducible Kelso
reference start, even though this document was written on October 29.
Frederick uses its documented 2025-02-24 start. These are measured-work
schedules, not complete construction schedules or contractual compliance
conclusions. The phase-one date on Frederick is **not evaluated** until zones
are mapped.

| Project | Takeoffs retained | Baseline target milestone | Earlier target | Replanned milestone | Recovery changes |
| --- | ---: | --- | --- | --- | ---: |
| Kelso | 390/390 | 2027-04-30 completion | 2027-07-01 | 2027-04-30 | 0 |
| 84 Frederick | 2803/2803 | 2025-08-07 substantial performance | 2025-10-31 | 2025-08-07 | 0 |

Source JSON SHA-256 values remain
`3c2562933d1a76a42a0b58b2c8ddf3f584247a4710e43740c7dfb798df9c933e`
(Kelso) and
`620cc8d3e7b9bc4c3ab650ef4279df24e58cb311a27db8704b9a9082efe471e4`
(Frederick). Local ignored audit artifacts are under `diag/build-acceptance/`.

## Verification and pending work

- TypeScript, 393 tests in 55 files, production build, real-project audit and
  IFC4 schema/geometry validation passed. The production build still warns
  about large chunks.
- IFC shape validation saw 319 Kelso and 2658 Frederick shapes, with zero
  schema or geometry errors. Three previously boxed Kelso structural counts
  are now unplaced by the generic structural rule; their measurements remain.
- Claude's finding 1 (large linework reads, worker copies and foreground hash)
  and finding 6 (timezone date parsing) remain Claude-owned and are not
  validated by this pass. Claude-reported timing was 46 s Kelso versus 4.2 s
  main, 44 s Frederick, about 80 MB linework and about 0.9 s foreground hash;
  no independent Mac timing is claimed here.
- Finding 7: CPM calculates weather at earliest start and reuses that elapsed
  duration in its backward pass. Late dates/float near winter need a separate
  calendar-aware correction.
- Finding 8: duplicate Model labels, Construction screen-reader naming, noisy
  opening-host issues, raw activity labels and wall-corner notches remain
  queued for a later UI/geometry pass.

This file is a Claude-facing handoff artifact. It does not prove that Claude has
received it. Keep the original `build-it-validation.md` as historical evidence;
its dates and schedule assertions predate this fix.
