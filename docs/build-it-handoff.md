# Build It checkpoint — handoff for Claude and Codex

**Update (2026-10-29):** [Review fixes and current verification](build-it-review-fixes.md)
supersede the scheduling claims and dates below. This file describes the
original `e5ecd0d` checkpoint for comparison.

Date: 2026-10-29. Branch: `codex/build-it-rework`.

This is a development checkpoint, not a production release or a claim of complete
architectural fidelity. The owner requested a Git checkpoint and transparent
handoff before pursuing the interactive PDF/3D direction.

## Read first

- [Quality report](build-it-quality-pass.md): implemented geometry/UI improvements
  and current limitations.
- [Original rework brief](build-it-rework-brief.md): historical scope. The owner
  subsequently accepted Kelso's approximately 13-month schedule; do not force a
  two-year duration to satisfy the earlier discussion.
- [Initial validation](build-it-validation.md): historical results and audit commands.
- [Explore Drawing proposal](explore-drawing-concept.md): new direction only;
  walkthrough navigation and PDF-to-3D transitions are not implemented.

## What changed

- A shared model now links source takeoffs, derived building context, construction
  activities and IFC geometry. Measured quantities remain separate from derived
  allowances; unplaced measurements remain in the data.
- Grid registration handles duplicate grids and quarter-turn sheets. Roof and
  datum recovery use drawing evidence; fractional imperial datums are supported
  independently of project quantity units.
- Wall-following footprint recovery preserves concavities across bounded gaps.
  Window-detail recovery places 22 Kelso windows and cuts host openings. Unsupported
  curtain-wall assemblies remain unplaced instead of becoming arbitrary boxes.
- Planning includes omitted-scope allowances, procurement, weather, inspections,
  renovation sequencing and explainable target recovery. Later targets restore
  the lean baseline rather than retaining accelerated crews.
- The UI separates Model and Construction views, groups exports, makes side panels
  optional, exposes source evidence and placement filters, and shows quality bases.
  Worker replanning rejects stale results; model cache version is 8.
- Wall-origin rendering arithmetic, material colours and graphics disposal were
  corrected. IFC and viewer use shared geometry for slopes and openings.

## Code map

| Area | Main files |
|---|---|
| Extraction and provenance | `src/build/extract.ts`, `types.ts`, `run.ts` |
| Grid/level/shell recovery | `building.ts`, `datumEvidence.ts`, `footprint.ts`, `roof.ts` |
| Windows and unsupported placements | `openingDetails.ts`, `facades.ts`, `placementQuality.ts` |
| Shared geometry/export | `sceneGeometry.ts`, `solids.ts`, `surface.ts`, `ifc.ts` |
| Planning and target recovery | `scope.ts`, `facts.ts`, `plan.ts`, `cpm.ts`, `replanTarget.ts` |
| Worker/cache | `client.ts`, `build.worker.ts` |
| UI | `src/components/BuildView.tsx`, `BuildView.css`, `BuildScene.tsx`, `BuildPanels.tsx` |
| App integration | `src/App.tsx`: passes existing PDF vector extraction to Build It |
| Regression checks | `test/buildGeometry.test.ts`, `test/buildRework.test.ts`, `bench/buildModel.test.ts` |

Build files in this table without a directory prefix are under `src/build/`.
`Viewer.tsx` and the shared room-fill/wall-detection implementations were not edited.

## Verification and reproduction

Checkpoint checks: TypeScript; 389 tests across 55 files; read-only real-project
audit; IFC4 schema/EXPRESS and geometry validation; production build. The build
retains Vite's large-chunk warning. Passing these checks does not verify every
architectural dimension or schedule assumption.

```sh
npm ci
npx tsc --noEmit
npm test
npm run build

# Requires the owner's local demo project folders and drawing PDFs.
BUILD_PROJECTS_ROOT="/path/to/Takeoff AI" \
  npx vitest run -c bench/vitest.config.ts bench/buildModel.test.ts

# In a Python environment with ifcopenshell and pytest installed:
python scripts/validate-build-ifc.py \
  diag/build-acceptance/kelso.ifc diag/build-acceptance/frederick.ifc
```

The real-project test skips if `BUILD_PROJECTS_ROOT` is absent. A skip is not a
successful project audit. It finds folders beginning `Kelso demo` and
`84 Frederick demo`, each containing `project.json` and `drawings/<docId>.pdf`.
The audit asserts source JSON byte equality and retains all 390 Kelso and 2803
Frederick takeoff records. Represented IFC products: 322 and 2658 respectively,
including derived building context; these are not measurement counts.

Diagnostic reports, screenshots, model snapshots and IFC files live under ignored
`diag/`. They are local evidence, not files delivered by cloning this branch.
Source drawings and project datasets are not included in the checkpoint.

## Remaining work — do not mark these complete

1. Full curtain-wall profiles, stepped sills and mullions; actual structural
   members; roof overhangs and slab openings.
2. Frederick's spatial wing boundaries and differing elevations; occupied floor
   versus lower-roof regions; unsupported/detached service positions and heights.
3. Validate inferred footprints and paper-position fallback against the actual
   drawings. Convex fallback still exists where bounded wall recovery fails.
4. Replace conservative whole-floor renovation phasing with documented zones.
   Vendor durations, rates and resource assumptions still require validation.
5. Broader visual/accessibility/performance review and bundle-size improvement.
   The model is not yet a construction-ready digital twin.

## Recommended next collaboration

Claude can review this checkpoint without recommitting the same work. Read the
diff and the open gaps, reproduce the available checks, and report evidence-backed
findings before editing shared files. Preserve current source measurements and
the accepted schedule direction. Do not conflate a valid IFC file with an
accurate, fully coordinated building.

Explore Drawing should begin as a bounded prototype on one calibrated floor and
one reviewed room, using this model and source IDs. The desired journey is original
PDF → spatial model → room → selected element → exact source drawing. Keep this
new work in a subsequent commit so the current checkpoint remains reviewable.

This file is the handoff artifact; it does not imply that Claude has received,
reviewed or approved the work. Git publication is likewise separate from merging
to the default branch or deploying an app release.
