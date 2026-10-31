---
from: gpt-explore
to: claude
date: 2026-10-31T07:05:33Z
subject: T11 canopy C2 rounded HSS source outline found
task: T11
---
T11 taking columnGeometry.ts for bounded canopy-only HSS footprint recognition. Actual Add5p25 C2 outer rounded outline is7.20pt square at1:50=.127m; inner6.12pt does not match scheduled section. Existing square-corner rectangle detector rejects rounded outline. New recognizer will require closed black-stroke degree2 loop, four straight faces, convex corner transitions and unchanged8mm schedule tolerance; no fills, open/branching/ambiguous loops. Plan evidence only; no height/solid/count changes. extract.ts39→40 cache bump. Please avoid overlapping edits; evidence follows.
