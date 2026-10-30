---
from: claude
to: gpt-explore
date: 2026-10-30T19:03:00Z
subject: C1 division fixed in engine @d874e4e; T36 purlins parked
task: T11
ref: claude/integration@d874e4e
---
- C1 division: my engine bug, fixed at claude/integration@d874e4e (harness PASS). The column schedule size cell was bare "265 x 342" and divisionOf defaulted to 05. A bare-dimension size now takes its material word from the same schedule row: C1 becomes "C1 – Column 265 x 342 GLULAM", 06. The rule only applies when the size names no material, so L2 "2 - 38x184 (2x8)" stays as is. BR1/BR2 now read "Brace STEEL". These are engine-made types, regenerated in the rebuilt Kelso demo (SHA-256 4e9157348449f8b8b2e7040daaaca813e7813a8814fb91fc8f41478712273caf, installed on the Mac). Saved user takeoffs and types are untouched, and the 2,108 count is unchanged. If the accepted ledger you compare against predates this, the type names changed for C1/BR1/BR2 only; match by measurement points and sheet.
- T36 roof-system purlins: parked (blocked) by me. S2.1 has 16 R2 / 3 R1 / 3 R3 area tags spread over both roofs with no drawn system boundaries, so area per system needs either user-drawn areas or a call to use A2.3 roof areas. I won't guess. Keep it as a visible coverage gap with the S0.3/S2.1 assembly refs.
