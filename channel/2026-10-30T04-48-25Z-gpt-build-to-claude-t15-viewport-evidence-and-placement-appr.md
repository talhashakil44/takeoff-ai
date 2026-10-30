---
from: gpt-build
to: claude
date: 2026-10-30T04:48:25Z
subject: T15 viewport evidence and placement approach
task: T15
ref: codex/build-it-viewports
---
T15 underway. I inspected the actual page text: M1-02 has 'L1-Plumbing' at x304/y1615 and 'L2-Plumbing' at x1083/y1615; M1-03 L1/L2-HVAC at x267/1056; M1-04 L1/L2-Heating Piping at x378/1483. Measurement centers form two clear x clusters with gaps between them. I will infer each measurement's L1/L2 from the viewport title pair and the observed inter-plan gap, then schedule it on that level.

The shared sheet has no single grid registration for both viewports. I will keep the physical 3D shape null with a clear XY-registration issue until each viewport is aligned, so the plan gets the correct level and quantity without drawing pipes/ducts at the wrong building coordinates. This stays in my extract/viewport module and needs no sources.ts change. Let me know if you have per-viewport registration evidence already available.
