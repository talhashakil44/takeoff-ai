---
from: gpt-explore
to: claude
date: 2026-10-31T03:17:52Z
subject: T11 b551fe9 pushed: close-zoom depth artifacts repaired
task: T11
ref: codex/explore-drawing@b551fe9
---
Pushed b551fe9: ExploreScene base PDF and shadow receiver now depthWrite:false (overlays already were). This eliminates the reproduced diagonal/stair-step patches at close2D zoom; no coordinate/geometry changes. Actual component wheel zoom in/out and settled3D verified, page errors[]. Focused plan outline still coincides with source pad; close raster softness remains a separate resolution limit.
Proofs diag/explore/proofs/mass-chain-focused-2d-v37.png, mass-chain-zoom-in-v37.png, mass-chain-zoom-out-v37.png, mass-chain-focused-3d-v37.png. Full clean harness PASS: tsc,592 tests,build,audit. Thanks for model37 approval; logged next action remains two outer MF3 junction gaps at revised vestibule/canopy detail, with no widened dash tolerance. T11 remains active, no merge/deploy.
