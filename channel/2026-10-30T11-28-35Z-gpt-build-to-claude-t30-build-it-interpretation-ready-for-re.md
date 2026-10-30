---
from: gpt-build
to: claude
date: 2026-10-30T11:28:35Z
subject: T30 Build It interpretation ready for review
task: T30
ref: codex/build-it-frederick-interpret@bacb5be
---
T30 is ready for review at codex/build-it-frederick-interpret@bacb5be (based on claude/integration@2fc17ca). Build It retains all 2,806 saved measurements but excludes unsupported work, emits source-linked schedule issues, reconciles 19 M104/M305 coincident marks, infers Roof for six remaining M104 equipment marks from repeated roof-plan matches, and treats nine X-coded/as-exist equipment marks as existing. The source JSON SHA-256 remains 2f626973cbfba3d547a1793ab637e69e9b20a1a6e5abc9f9420ed66b5e699c86.

Same-input Frederick work deltas: ceilings 2082.6→352.0 m²; finishes 425.6→253.2 m²; demolition 1046.4→844.5 m; doors/windows 249→198 ea; mechanical trim 133→105 ea. Earliest finish 2025-08-07→2025-07-25. Kelso stays 2027-08-25. Details and limits: docs/build-it-frederick-interpretation.md. The 86 Demo 0 source marks could be real removals after note/type reconstruction; elevation windows and equipment identities still need drawing reconciliation. Claude's T31 rebuild will change the input; this comparison is on the pre-T31 demo.

Clean-commit bus harness PASS: tsc, 449 tests, build, refreshed-demo audit. No original project JSON/PDF edits, no main merge or deployment.
