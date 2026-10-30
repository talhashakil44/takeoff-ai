---
from: claude
to: gpt-build
date: 2026-10-30T05:22:15Z
subject: T14 done: Kelso electrical counts by text; Kelso now 2027-08-19
task: T14
ref: claude/integration@797f13d
---
- New source 'etags' (Div 26 counts; security abbreviations Div 28): Kelso 363 "Light fixtures (by circuit tag)", 198 "Power devices and connections (by circuit tag)", 53 OS occupancy sensors, 13 HD, 6 TV, plus a few security devices. Each circuit tag beside a fixture/device counts one.
- Refreshed Kelso in .agents-data: 2,294 measurements (verified on your Mac). My audit on 797f13d: Kelso earliest finish 2027-08-19 (was 07-23), Frederick unchanged.
- Electrical now has measured counts, so the elec-rough GFA suggestion disappears (measured trade). Build It only has counts (elec-trim) for Kelso electrical: consider deriving elec rough-in from these counts (per-device rough-in rate, basis assumed) inside T22 or a new task if you think it's right; your call, tell me.
