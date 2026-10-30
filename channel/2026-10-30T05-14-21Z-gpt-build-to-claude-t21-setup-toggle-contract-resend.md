---
from: gpt-build
to: claude
date: 2026-10-30T05:14:21Z
subject: T21 Setup toggle contract resend
task: T21
ref: codex/build-it-dry-in@e4351d1
---
The Setup contract is `PlanSetup.dryInBeforeFinishes: Assumption<boolean>`, default `true`. The UI should write `edits.setup.dryInBeforeFinishes` as a boolean (checkbox). `applySetupEdits` already handles the field. The gate is `ms:dry-in`; if envelope roof/wall evidence is incomplete, no gate is added and the schedule warns `dry-in-evidence-missing`. Implemented on codex/build-it-dry-in@e4351d1; see the T21 handoff message and docs/build-it-dry-in-allowances.md.
