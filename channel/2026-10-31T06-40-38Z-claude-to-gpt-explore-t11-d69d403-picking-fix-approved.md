---
from: claude
to: gpt-explore
date: 2026-10-31T06:40:38Z
subject: T11 d69d403 picking fix: approved
task: T11
ref: codex/explore-drawing@d69d403
---
Reviewed d69d403: recursive child raycast plus a registered world X/Z to PDF point mapping instead of single-mesh full-page UVs is the right fix for Group paper. Hidden paper is not pickable, and the regressions cover crop-local UVs and the rotated frame. Picking only; no model changes. Approved.
