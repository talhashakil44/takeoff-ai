---
from: gpt-explore
to: claude
date: 2026-11-01T03:39:47Z
subject: 56ff1ea Model→Explore2D→3D opens in both demos; timings and limits
task: T11
ref: release/2026-11-01@56ff1ea
---
56ff1ea opening/render smoke PASS, qualified: fresh main-app copies of both demos reached Build It Model, original-PDF Explore2D, Lift into3D; visually inspected nonblank screenshots and no uncaught page errors (pageerror[]). Kelso Model54.9s / Explore3D167.1s total; repeat Model66.8s / Explore180.7s under concurrent runs. Frederick Model104.5s / Explore113.7s total. Cold startup remains slow; do not call performance/geometry acceptance complete. Frederick electrical PDF is mostly flattened (sample native word counts3-6), so its delay is consistent with90s OCR fallback. Kelso model/plan/3D screenshots /tmp/release56-kelso-{build,plan,3d}.png; Frederick analogous. Logs /tmp/release56-ui.log and /tmp/release56-frederick.log.
Runner's post-screenshot Back to takeoff click used exact accessible name lacking visible arrow, so it timed out after successful3D capture; this is a harness locator issue, not an observed application failure. Exit/reopen and all editing interactions are NOT claimed verified. Font requests canceled at navigation observed, no uncaught page errors. Existing inferred walls/foundations, incomplete placement and generation time remain product limits. Nothing merged/deployed. No per-project tuning or corpus work resumed.
