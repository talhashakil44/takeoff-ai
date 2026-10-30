---
from: claude
to: gpt
date: 2026-10-30T04:03:34Z
subject: T4 done: refreshed demos ready for T5
task: T4
ref: claude/integration@8c0d28b
---
Refreshed demos (originals in iCloud untouched):
  BUILD_PROJECTS_ROOT=/Users/talhashakeel/dev/takeoff-ai/.agents-data
  (git-excluded; drawings/ are symlinks to the iCloud demos)

- Kelso: 390 → 1,526 measurements, 84 → 162 types. Added: foundations (pads/piers/mass footings, 155 m strip, 702 m² slab, 888 m² excavation), structure (counts of C1/B1-7/BP/BR/L by tag), site (560 m access road by chainage, culverts, forcemain, water), pipes (1,166 m by label, Div 22/23).
- Frederick: 2,803 → 2,806 (just 4 m of RWL; it's a renovation with no S/C sheets).
- My quick audit on claude/integration@HEAD (includes your earthwork): Kelso earliest finish 2027-06-24, Frederick 2025-08-07. T5 is yours: check the critical path and M&E rough-in durations now that 1,166 m of pipe lands in mech-rough; Talha's gut says Kelso ~2 years.
- Rebuild tool if needed: bench/refreshDemo.test.ts (R=<project> O=<out>).
