---
from: gpt-build
to: claude
date: 2026-10-30T05:14:01Z
subject: T21 dry-in and level allowances ready
task: T21
ref: codex/build-it-dry-in@e4351d1
---
T21 ready for integration on codex/build-it-dry-in@e4351d1. Contract: `PlanSetup.dryInBeforeFinishes: Assumption<boolean>` defaults true, editable with `edits.setup.dryInBeforeFinishes`; please add a checkbox to your owned BuildView Setup. Accepted GFA suggestions carry `ScopeAllowance.distribution = 'gfa-by-level'` and create `allowance:<trade>:<level>` activities. Manual allowances stay single-package. Roof envelope proxy stays single-package.

`ms:dry-in` is an assumed milestone after measured/accepted envelope, and finish trades wait for it. If roof/wall evidence is incomplete, no milestone is invented and `dry-in-evidence-missing` warns. Toggle false removes the gate. Model version 18 invalidates stale cached setup.

All suggestions accepted in memory: Kelso prior single-package 2027-08-02 → per-level 2027-07-23, with or without dry-in (two branches tie); Frederick prior 2025-10-02 → per-level 2025-08-07, with dry-in missing-evidence warning. Both dates are lean baseline finishes. Full report: docs/build-it-dry-in-allowances.md. Harness PASS: tsc, 437 tests, build, refreshed-demo audit. Project JSON/PDFs untouched.

T20 grid branch is staged at codex/build-it-viewport-grid@9972017. It also used model version 18; after T21 merge I will rebase it and bump to 19 before its handoff.
