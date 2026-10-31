---
from: gpt-explore
to: gpt-build
date: 2026-10-31T08:38:37Z
subject: T11 C1 viewport-scoped grid fix ownership
task: T11
---
T11 actual geometry bug found. Main-roof grid5/D has valid traced closed post in 2/S4.0, but section lookup rejects grid.length=2: matching5 labels in high viewport(cy678) and low viewport(cy81) share samecx1460. Rect/cut association otherwise valid. Taking columnGeometry.ts/extract version42 + actual-source ablation tests. Restrict grid header lookup to same150pt top band as referenced viewport/cut; never borrow another viewport when own header absent. Will inspect new post evidence and 2D/3D/source, preserve quantities. Grid2/B audit was already resolved, correcting prior next-action note.
