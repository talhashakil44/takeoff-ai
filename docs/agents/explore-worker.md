# Explore worker — T11

This worker uses the existing `agents/bus` branch in this repository. Do not create
another channel or merge that branch into app code. Standing shared prompts and
the dependency graph live on that branch. This document specializes T11.

## Prompt and agent contract

Implement drawing-backed Explore geometry and UI. Preserve original project
JSON/PDFs and takeoff quantities. Source dimensions, sheet coordinates, grid
registration and level datums must support placement. Missing evidence remains
missing; guessed context is opt-in and visibly distinct. A convincing render is
not acceptance evidence.

This chat owns `src/explore/` on `codex/explore-drawing`. The separate Build It
coordination chat owns T9/T5/build logic. Claude owns the takeoff engine,
BuildView, sources and facts. Request shared-file changes through the bus before
editing. Dispatch bounded sub-agent work with explicit file ownership; review
results before committing. Do not claim another worker's ready GPT task.

## Harness and graph

Use the bus harness for `tsc,test,build`. Real-project audits need an explicit
local `BUILD_PROJECTS_ROOT`; missing fixtures or skipped audits are incomplete,
even if an older bus version prints PASS. Store private screenshots and audit
artifacts under ignored `diag/`, never publish drawings in channel messages.

T11 completion additionally requires:

- Measured footprints checked against original plans on both floors; calibration,
  rotation, crop and level datum covered by regression checks.
- Structural placement/dimensions traceable to drawings/specs; unresolved members
  and assumptions reported separately from resolved geometry.
- Live 2D zoom/pan, 3D, floor switching, layer selection and source navigation review.
- The tested commit and any uncommitted changes recorded. A changing tree invalidates
  the result; automated PASS alone cannot mark T11 done.

## Loop

1. Fetch `origin/agents/bus`; read messages and graph. Take T11 only.
2. Choose the next bounded failure or acceptance gap. Record expected evidence.
3. Implement on the Explore branch; delegate only nonoverlapping work.
4. Run relevant regression checks, then harness. Inspect failures and repair.
5. After three failed repair attempts on the same issue, report the concrete
   blocker/evidence and choose independent work if available; do not spin blindly.
6. Commit/push a verified checkpoint, post results to Claude with `--task T11` and
   exact branch/SHA. Keep overall task doing until all acceptance gates pass.
7. Read Claude's T11 reply, incorporate review, repeat. Only claim acknowledgment
   after a reply exists. No automatic main merge or deployment.

Until bus supports distinct consumer cursors, this worker inspects `channel/`
messages using `git show` without calling `read gpt` or `wait gpt`: those commands
share a common Git-directory cursor with the Build coordination chat. Message
files remain the durable record. Use short bounded polling during active work.

The bus's `wait` command polls; it does not launch an agent or create a persistent
repair daemon. This workflow runs while an agent session is active. Do not describe
it as unattended execution until a durable worker and wake-up mechanism are installed.
