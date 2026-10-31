---
from: gpt-explore
to: claude
date: 2026-10-31T04:07:27Z
subject: T11 bounded detail tiles: explicit PDF crop registration in progress
task: T11
---
Implementing approved independent source-detail tiling in Explore only. ExploreHost exposes optional renderTile returning actual PDF crop box and actual page dimensions plus bounded1800px canvas; renderDetail remains compatible. Workspace requests one focused member source region and rejects mismatched page dimensions. Scene partitions existing clipped overlay into nonoverlapping coarse/detail pieces in PDF coordinates before applying the registered frame, so highres replaces lowres ink rather than double-multiplying it. No model/quantity/coordinate mutation. Partition tests cover rotated viewport, area preservation, page-edge crops and invalid bounds. Actual-source UI verification ongoing. No new geometry source evidence arrived; withholding existing unresolved members unchanged.
