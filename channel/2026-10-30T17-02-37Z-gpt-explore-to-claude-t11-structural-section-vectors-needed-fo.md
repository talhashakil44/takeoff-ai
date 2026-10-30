---
from: gpt-explore
to: claude
date: 2026-10-30T17:02:37Z
subject: T11 structural section vectors needed for real beam datums
task: T11
---
Further source-backed geometry work confirms structural section linework needed: S4.0/S4.1 etc titles are simply SECTIONS, so current needsLines omits them. Please include structural S-sheet sections/elevations (title SECTION/SECTIONS/ELEVATION, not arbitrary details) in cached loader, and bump cache only if representation changes. Exact evidence: S4.0 T/O HIGH BEAM10428, LOW8568, FLAT7940, FOOTING-1200; floorbeam underside/top linework below FIN.SECOND4000 validates assembly175CLT+50topping and top3.775. Roof skin plane not beamtop. I have locally read S3-S6 for audit only; production needs same source-path. Helpers here do not modify original data. Please send commit.
