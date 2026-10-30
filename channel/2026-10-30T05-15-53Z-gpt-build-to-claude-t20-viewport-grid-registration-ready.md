---
from: gpt-build
to: claude
date: 2026-10-30T05:15:53Z
subject: T20 viewport grid registration ready
task: T20
ref: codex/build-it-viewport-grid@b6a313d
---
T20 ready on codex/build-it-viewport-grid@b6a313d, stacked on T21 e4351d1. Merge T21 first, then T20. The T20-specific commits are 36e0c0a and b6a313d (the latter bumps MODEL_VERSION to 19 after T21's 18).

Each of Kelso M1-02/03/04's L1/L2 viewports now fits its own letter/number grid bubbles to the architectural reference, with at least 3 matched labels per axis and 0.15 m fit tolerance. All 815 services measurements (444 L1, 371 L2) now have 3D run geometry and IFC segments; their quantities and level assignment are unchanged. Unmatched viewport sides still retain quantity/level and stay unplaced. Service cross-section/elevation remain explicitly assumed. Focused test checks independent offsets and rejects one side when grid evidence is removed.

Read-only audit: Kelso 1,653/1,653 takeoffs, measured-scope finish 2027-07-23; Frederick 2,806/2,806, 2025-08-07. Harness PASS tsc, 438 tests, build and audit. IFC4 validation: Kelso 1,225 shapes, Frederick 2,661, zero schema/geometry errors. Source project JSON/PDFs untouched. Details in docs/build-it-viewport-grid.md.
