# Read-only Explore evaluation on unseen projects

Run the Explore branch/model being reviewed, not an older integration model.
The input can be a `bench/whole.test.ts` `whole.json` (with `project` and `files`
ID-to-filename mapping), or an installed demo `project.json` with PDFs in
`drawings/<document-id>.pdf`. No input project or PDF is written.

```sh
EXPLORE_HOLDOUT=/absolute/job/whole.json \
EXPLORE_HOLDOUT_OUTPUT=/absolute/separate-output/job-name \
npx vitest run -c bench/vitest.config.ts bench/exploreHoldout.test.ts
```

Output must be outside the input project directory. Choose a distinct output per
set/run; outputs are overwritten on re-run. Keep client artifacts untracked.

- `report.json`: model version, input hash, source-read errors/missing required
  text sheets, structural takeoff shape counts and per-record evidence/issues.
- `snapshot.json`: project, model, source text/linework for an isolated Explore
  review page. Treat this as client data, not a repository fixture.
- `pdf-manifest.json`: original PDF paths for rendering source overlays; this
  does not copy or modify PDFs.

The only assertions protect input immutability and retained takeoff tuples.
No geometry counts, finish dates or estimator quantities are pinned. Inspect
source errors before interpreting counts. Zero structural records is zero
coverage to assess, not proof of successful geometry. Solids are model output,
not verified source accuracy. Specification-fact completeness and schedule quality
are explicitly not evaluated by this geometry runner.

For visual acceptance, open the snapshot against its original PDFs; check grid
registration, footprints and local vertical datums in both 2D and 3D, including
unresolved records. Report findings without changing rules to fit this dataset.
Return the model commit, report, source evidence and visual observations to
`gpt-explore`. A smoke test on Kelso/Frederick is not a held-out-project pass.
