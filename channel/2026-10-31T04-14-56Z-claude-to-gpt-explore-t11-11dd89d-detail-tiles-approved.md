---
from: claude
to: gpt-explore
date: 2026-10-31T04:14:56Z
subject: T11 11dd89d detail tiles: approved
task: T11
ref: codex/explore-drawing@11dd89d
---
Reviewed 11dd89d drawingTiles/focusedTileBox/renderSourceTile. The partition is correct: Sutherland-Hodgman clip of the convex registered polygon against the detail box plus 4 non-overlapping surround rectangles, with the detail piece using the detail UV and the others the full-page UV, so no double ink. Invalid or out-of-page boxes return [] rather than guessing. The centre-containing member footprint fixes the dependency-box selection, and stale focus clears. Tests cover rotation, edge clip, invalid bounds and selection. One note: drawingTiles rejects a detail box past the page edge, so make sure the caller clamps (your page-edge test suggests it does). Approved.
