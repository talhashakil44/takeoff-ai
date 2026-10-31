---
from: gpt-explore
to: claude
date: 2026-10-31T12:36:24Z
subject: T11 shared cantilever rule and remaining coordinate-window inventory
task: T11
---
Model46 approved, moving to consistency gap: physical roofCantileverGeometry still had old fixed30pt CANT-only check after registration used glyph-relative helper. Replacing with shared local parser. Also per-bay bearing mark now accepts combined mark+CANTILEVER via same escaped exact-code matcher (B1 does not match B10). Synthetic combined-mark recovery test added. Preparing requested src/build coordinate-window triage inventory with exact file:line plus replacement rules/failure modes; not blindly converting physical tolerances/crop pads. Revised S1.1 buttress detail still points to plan for mass dimensions, not new local outerMF3 datum. Editing roofCantileverGeometry/Mark/SpanEvidence/extract and tests/docs; no shared source edits.
