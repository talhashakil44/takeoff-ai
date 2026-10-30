# Build It review fixes — Claude's part (findings 1, 4-header, 6)

Branch `claude/build-it-perf`, rebased on Codex's `5b0d336` (`codex/build-it-rework`), so it fast-forwards that branch.
Separate from Codex's branch so the two can be merged without push races. Not merged, not released.

## Ownership (as agreed)

| Who | Owns |
|---|---|
| Claude | Finding 1 (load time, linework copies, foreground stale hash), finding 6 (dates), **all `BuildView.tsx` edits** incl. the finding-4 header |
| Codex | Findings 2–5 data side: `scope.ts`, `replanTarget.ts`, `building.ts` and their tests; the header **data** (baseline finish, changes); historical-start warning in the plan's issues |

Files outside `BuildView.tsx`/`facts.ts` that this branch touches, so concurrent edits can be planned:

| File | Change | Size |
|---|---|---|
| `src/build/extract.ts` | `sourceHashOf`: the drawing texts/lines go in by `drawingFingerprint()` instead of `JSON.stringify` | 2 lines + 1 import |
| `src/build/client.ts`, `src/build/build.worker.ts` | Drawing evidence sent to the worker once per fingerprint, kept there between builds | small |
| `src/App.tsx` | The drawings' graph is read only for the Specs and Map tabs, no longer when Build opens (Build doesn't use it) | 3 lines |
| `src/components/BuildView.css` | `.bld-feas.stretched`, `.bld-feas.past` | appended |
| new `src/build/sources.ts` | Which sheets Build reads, the on-computer cache, slim lines, fingerprint | new |

## What changed

**Finding 1: opening Build was slow and edits froze the window.**
- Only the sheets the model reads are read: plans, elevations, sections, schedules, untitled sheets and every sheet with a takeoff (Kelso 106 of 122, Frederick 53 of 66). Four at a time, with progress in the header ("Reading the drawings… 23 of 106 sheets").
- Text runs and linework are kept on this computer (IndexedDB, by document and page; linework packed as `Float64Array`). Reopening reads nothing from the PDFs.
- Lines keep only what Build reads (`x1,y1,x2,y2,width,filled,curve,dashed`); colour, layer and subpath are dropped.
- The stale check fingerprints the drawing evidence (per sheet: count + sampled positions). Kelso: about 900 ms down to about 7 ms per recompute.
- The worker gets the drawing evidence once per fingerprint and keeps it. If it restarts or loses it, the build runs here and the next one resends.
- Opening Build no longer starts reading the whole drawing set into the links graph.

**Finding 6: dates a day early east of Greenwich.** `writtenDate()` in `facts.ts` reads "February 24, 2025" / "Oct. 31 2025" from its words. Impossible dates ("February 30") are refused instead of throwing inside `toISOString()`, which used to drop every fact. Used for substantial performance, start, phase and occupancy dates. `today()` in BuildView now uses the local calendar day (in Toronto after 8 pm UTC was already tomorrow).

**Finding 4 header (view side).** `FeasibilityBadge` in BuildView:
- no target: `Earliest finish …· no target set`
- fits with no recovery: `Fits the target · <finish>` (green)
- fits only with recovery: `Fits only with N recovery changes · <finish>` (amber), plus `· without: <baseline finish>` once the baseline is provided; the tooltip lists every change
- late: `X working days late even with N recovery changes · earliest <finish>`
- a start date before today: a second chip `Starts <date> · in the past` (from `setup.start`; tooltip gives where it came from)

**Finding 8 (BuildView part).** The side panel's tabs are now `Elements` / `Setup` with tab roles, so there is one control called "Model" (the Model/Construction switch).

## Header data contract

Uses Codex's contract from `docs/build-it-review-fixes.md`: `feasibility.baselineFinish` (before recovery),
`feasibility.earliestFinish` (after), `feasibility.overBy`, `feasibility.changes`. Fits with changes: "Fits only
with N recovery changes · <finish> · without: <baselineFinish>", the tooltip listing every change. Late: "X working
days late even with N recovery changes". No changes: no acceleration implied. Codex's `historical-start` issue
stays in the issues list; the start chip reads `setup.start` directly.

`MODEL_VERSION` bumped 9 → 10: the stale fingerprint changed, so saved builds are rebuilt once instead of
showing a false "Documents changed".

## Verification (rebased on `5b0d336`, Linux container)

- `npx tsc --noEmit`: clean. `npx vitest run`: 56 files, 397 tests (4 new in `test/buildSources.test.ts`, also
  passing with `TZ` = UTC, Asia/Karachi, America/Toronto, Pacific/Auckland). `npm run build`: passes, same chunk warning.
- Real projects, read-only, from the original demo exports (Kelso source SHA `addb1245…`, Frederick `620cc8d3…`,
  unchanged after the run):
  - `bench/buildModel.test.ts` (Codex's audit) passes with Codex's numbers: Kelso baseline 2027-04-30, Jul 1 target
    2027-04-30, 0 changes; Frederick baseline 2025-08-07, Oct 31 2025 target 2025-08-07, 0 changes.
  - New `bench/buildSources.test.ts`: the reduced, slim evidence builds an identical model, schedule times and
    feasibility to reading every sheet whole (level sheet lists may lose unmeasured notes sheets, which nothing
    reads); stale hash under 150 ms.
  - IFC: `scripts/validate-build-ifc.py`: Kelso 319 / Frederick 2658 shapes, 0 schema and 0 geometry errors.
- Time until the model shows, production build (`vite preview`), headless Chromium with software WebGL, same script
  for both, from opening the project file to the canvas:

| | Checkpoint `e5ecd0d` | This branch |
|---|---:|---:|
| Kelso, first open | 31.1 s | 17.4 s |
| Kelso, reopen (saved build dropped, rebuilt) | 14.6 s | 2.5 s |
| Frederick, first open | 29.1 s | 14.9 s |
| Frederick, reopen (rebuilt) | 7.3 s | 2.3 s |

  The 46 s / 44 s figures in the review were from the Vite dev server; these are production numbers. Not measured on the Mac.

## Not done here / pending

- Codex: finding 7 (weather in the backward pass).
- Finding 8 data side (Codex): every door's "opening host inferred" issue, raw scope names ("mech rough — Level 1"), wall-corner notches in `sceneGeometry.ts`.
- First open is still mostly PDF text extraction (~10–15 s here on a big set); it is cached afterwards.
- `cpm.ts`/`plan.ts` date helpers use local noon (`T12:00`) and are safe in every zone within ±12 h; not changed.
