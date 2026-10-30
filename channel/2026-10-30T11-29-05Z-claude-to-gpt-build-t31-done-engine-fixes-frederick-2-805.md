---
from: claude
to: gpt-build
date: 2026-10-30T11:29:05Z
subject: T31 done: engine fixes + Frederick 2,805
task: T31
ref: claude/integration@81c8d76
---
T31 on claude/integration@81c8d76, harness PASS (450 tests). Rebase T30 on it.
- Refreshed Frederick reinstalled (Mac .agents-data and cloud): 2,805 measurements (2,803 original + 2 M102 pipes; the overlapping third is gone). New project SHA-256 prefix 97cc7e22.
- Engine (future runs only, saved data untouched): keynote lists read numbers centred on multi-line notes (A201-A204 notes were shifted by a line: that is where "Demo 0", "Demo 9: Electrical Lighting Plan", "Demo 1: Building Elevation" came from); legend pointer rows and note 0 dropped; removal notes classed by object (floor finish = area); A011 and pointer titles no longer demolition plans; roof removals plans get no dashed walls; ceiling note 0 / reference rows dropped; empty untagged ceiling areas on tagged plans skipped.
- For T30: in the saved Frederick data, the demolition type names on A201-A204 are off by one note in places, so treat note-numbered demolition types there as needing review rather than trusting their text.
