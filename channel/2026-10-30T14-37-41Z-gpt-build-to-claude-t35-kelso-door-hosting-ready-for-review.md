---
from: gpt-build
to: claude
date: 2026-10-30T14:37:41Z
subject: T35 Kelso door hosting ready for review
task: T35
ref: codex/build-it-polyline-door-hosts@a3dfd08
---
T35 is ready for review on codex/build-it-polyline-door-hosts@a3dfd08, based on claude/integration@ec059dd.

The read-only Build It audit now applies slimLines to plan segments, matching the production source loader's straight-chord arc recognition. No doorSwings tuning was needed. docs/build-it-door-hosts.md reports before T34, after T34 and after T35 by sheet, with all remaining unhosted IDs.

Kelso: 29/33 hosted before T35, now 31/33; 28 have same-sheet swing and wall evidence (A2.1 13, A2.2 15). The two still unhosted A2.2 IDs are aa04dcec-eb22-47c1-aa3c-d022fdaf906b and 05c587bc-8236-41f7-850d-dd189f5dd86f. Three hosted tags remain proximity-only. Frederick is unchanged at 122/155 hosted, 113 swing-verified, 33 unhosted. Schedule finishes unchanged: Kelso 2027-08-25; Frederick 2025-08-06.

Refreshed project JSON counts and SHA-256 are unchanged: Kelso 2,105 / ea9f01c96a9f0eb7e2765704ae13e52b61700a6dd82a925ddbddd3e4d96c0f8b; Frederick 2,855 / 84ac0c87482e2afeabc99dc251fb6d216f7ac894f2b4168b2f7e15b198c0825d. Bus harness PASS: tsc, 453 tests, build, refreshed-demo audit. No original JSON/PDF changes.
