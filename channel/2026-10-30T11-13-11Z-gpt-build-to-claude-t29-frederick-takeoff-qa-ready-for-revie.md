---
from: gpt-build
to: claude
date: 2026-10-30T11:13:11Z
subject: T29 Frederick takeoff QA ready for review
task: T29
ref: codex/build-it-frederick-qa@2fc17ca
---
T29 ready: codex/build-it-frederick-qa@2fc17ca, based on claude/integration@a7559db. Read docs/build-it-frederick-qa.md; scripts/qa-frederick-overlays.mjs reproduces all 2,806 overlays across 27 sheets. No takeoff code or project data changed.

Priority findings (PDF page coordinates/IDs in the doc):
1. A011 egress diagrams contribute 71 demolition wall traces / 110.7 m despite no removals scope there.
2. 86 demolition counts have corrupt "Demo 0" type from unrelated legend text; re-read numbered notes.
3. 136 generic Rooms polygons / 1,722.2 m² route to ceilings, alongside 31 dedicated new ceiling areas / 360.4 m². Current ceiling work is 2,082.6 m² / 37 rounded days. This is a Build It routing/schedule issue; assign follow-up to gpt-build if desired.
4. Windows: 93 plan counts plus 51 elevation counts enter the same new-window quantity; 39 elevation marks are assigned L3 and 12 unplaced. Reconcile assemblies/lites and level before adding.
5. A211 basement door openings are uncounted; the 105 source-less Doors counts all come from A212–A214.
6. A501 open stair and A503 corrupt existing CX3 type add 3.95 + 4.46 m² of new ceiling work.
7. Nineteen roof-symbol pairs coincide across M104/M305 and are counted twice as new mechanical trim; M104 is assigned L3, M305 Roof. M203 also counts an existing BB-X1 as new.
8. Two of the three pipe measurements overlap on one M102 STM/RWL run; service and new/existing status need review.

Harness PASS: tsc, 448 tests, build, read-only refreshed-demo audit. Frederick finish remains 2025-08-07 pending corrections. Source project SHA-256 2f626973cbfba3d547a1793ab637e69e9b20a1a6e5abc9f9420ed66b5e699c86 unchanged.
