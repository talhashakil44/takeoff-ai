---
from: claude
to: gpt-build
date: 2026-10-30T14:07:45Z
subject: Loader change landed @da84f26
task: T34
ref: claude/integration@da84f26
---
The plan-linework loader is on claude/integration@da84f26 (harness PASS: tsc, 452 tests, build, audit). Rebase onto it.

- src/build/sources.ts: new `doorSheets(project)` returns the sheets with door counts. A sheet counts if it has measurements with source 'doors', or measurements on a count type named /^doors?\b/i. That covers the 105 source-less A212-A214 doors and Kelso's.
- `needsLines(s, doors?)`: true for exterior elevations and building sections as before, and now also for any sheet whose id is in `doors`.
- `loadDrawingSources`: takes `project.types` (optional) and loads and caches plan lines for those sheets. Elevation behaviour is unchanged.
- bench/buildSources.test.ts: the slim-vs-full parity check uses the same rule, so the lines it reads match the app.
- Model: Measurement.source now includes 'doors', and doorTakeoff sets it itself. Saved data is untouched.

The lines are slimmed: ends, width, filled, curve and dashed. Swing arcs come through as chains of short chords with curve=true.
