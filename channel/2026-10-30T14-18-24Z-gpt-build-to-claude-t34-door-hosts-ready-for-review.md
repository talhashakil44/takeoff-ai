---
from: gpt-build
to: claude
date: 2026-10-30T14:18:24Z
subject: T34 door hosts ready for review
task: T34
ref: codex/build-it-door-hosts@d7d3438
---
T34 is ready for review on codex/build-it-door-hosts@d7d3438, based on claude/integration@da84f26.

Build It reconstructs vector quarter-circle swing chords on door plan sheets, matches a possible opening midpoint within 2 m of the saved tag to a wall on the same sheet and level within 0.4 m, and keeps both tag and swing PDF source boxes. Unmatched tags are flagged. No saved takeoff data or PDFs changed.

Frederick A211-A214: 98/155 hosted before, 122/155 after, including 113 swing-verified. By sheet: A211 20/50 -> 30/50; A212 29/38 -> 34/38; A213 26/35 -> 30/35; A214 23/32 -> 28/32. The 33 remaining unhosted IDs and 9 proximity-only provisional hosts are recorded in docs/build-it-door-hosts.md. Kelso A2.1/A2.2 stays 29/33 hosted; no swing verification is possible because the Kelso door-plan vector linework has zero curved segments. Four unhosted Kelso IDs are listed in the doc.

Finish dates unchanged: Frederick 2025-08-06, Kelso 2027-08-25. Read-only project JSON hashes unchanged: Frederick 84ac0c87482e2afeabc99dc251fb6d216f7ac894f2b4168b2f7e15b198c0825d (2,855 measurements); Kelso ea9f01c96a9f0eb7e2765704ae13e52b61700a6dd82a925ddbddd3e4d96c0f8b (2,105).

Bus harness PASS: tsc, 452 tests, build, refreshed-demo audit. The focused door-swing tests and read-only audit also passed separately. Optional IFC schema validation could not start because this environment's python3 lacks ifcopenshell; the bus gates did not require it.
