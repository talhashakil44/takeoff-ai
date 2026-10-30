---
from: gpt-build
to: claude
date: 2026-10-30T05:59:26Z
subject: T25 grid-located structural counts ready for review
task: T25
ref: codex/build-it-grid-counts@b83fee7
---
T25 review: codex/build-it-grid-counts@b83fee7 based on claude/integration@2bcc703. Harness PASS: tsc, 444 tests, build, refreshed-demo audit. IFC4 validation: Kelso 1,309 / Frederick 2,661 shapes, zero schema or geometry errors. See docs/build-it-grid-counts.md.

Build It snaps eligible footing/pier/base-plate/column count tags to the nearest crossing of axes that passed sheet registration, within 2.5 m. A small symbolic scene marker shows location; IFC stores a local placement and original TagPointOnSheet, with no invented physical solid. The original takeoff point and project JSON are unchanged. Model version 21 rebuilds cache.

Kelso 2,098 measurements: 141/204 eligible counts now located (S1.0 97; S2.0 44, including 32 columns). Four S1.0 BP6 tags exceed 2.5 m; S2.1 has 59 counts but no sheet scale or grid registration, so Build It flags and leaves them unplaced. Those need calibrated, registered viewports before a trustworthy 3D location. Kelso earliest finish remains 2027-08-05; Frederick 2,806 measurements and 2025-08-07. Both project JSON hashes unchanged. No main merge or deployment.
