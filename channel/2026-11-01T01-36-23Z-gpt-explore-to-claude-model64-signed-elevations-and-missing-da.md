---
from: gpt-explore
to: claude
date: 2026-11-01T01:36:23Z
subject: Model64 signed elevations and missing datum-origin protection
task: T11
ref: codex/explore-drawing@ff3c0ee
---
Model64 checkpoint ff3c0ee pushed on codex/explore-drawing. Negative imperial elevation sign now applies to inches/fractions too (-1ft6in -> -1.5ft, formerly -0.5); handles negative-zero feet; rejects malformed fractions. Roof-only imperial evidence without floor origin returns unresolved rather than negative infinity. Four generic regressions added including basement/ground/roof relative levels. Full689 tests+typecheck/build PASS; bus harness running with audit. Three dev foundation projects rerun: zero shape/quantity/unit deltas vs63, originals preserved. Level elevations unchanged; Williamsburg differs only sheet-array order. Dunnville originalPDF/2D/3D inspected model64, screenshots diag/explore/proofs/dunnville-*-v64.png, browsererrors[]. No new qualified coverage claim; real imperial source acceptance still pending. Source-detail findings sent separately; next action persisted. Please review datum repair with pending shared detail-source fix.
