# Build It review finish — weather, opening quality and wall corners

Date: 2026-10-29. Branch: `codex/build-it-review-finish`, based directly on
Claude's `e817d11` (`claude/build-it-perf`). This is a development checkpoint;
no merge or deployment is included.

## Findings resolved in this pass

- **7, winter float and late flags:** CPM retains productive workdays separately
  from the elapsed duration at the earliest start. Its backward pass searches
  for the latest start that can deliver those productive days under the weather
  at that later date. Target late flags use the same calculation. Calendar day
  stepping now uses UTC date components so working-day indexes stay stable in
  timezones east of UTC, including Pacific/Auckland. This retains the existing
  Ontario weather rates as assumptions; no weather forecast was introduced.
- **8, opening quality data:** A successfully hosted door/window no longer gets
  a per-element "opening host inferred" warning. One model issue reports the
  count, affected IDs and sample drawing sources for openings hosted by
  proximity with default dimensions. Missing hosts still receive an element
  warning. Measured quantities and source references remain unchanged.
- **8, wall corners:** `runSolids` adds the missing outside quarter at supported
  square turns. This covers both turns inside a wall polyline and unambiguous
  endpoints where two separate measured wall runs meet. The same solids drive
  the Three.js viewer and IFC export. T junctions, mismatched heights or
  statuses, openings at the corner and non-square turns are left for drawing
  review.
  Ten Kelso and 17 Frederick joins between separate wall records were recovered
  in the current audit. Model cache version is **11** because the geometry
  contract changed.
- **8, raw `scope:*` labels:** The unsupported full-floor `scope:*` activities
  were removed in the preceding Codex scheduling pass. Current measured-work
  activities already use `TRADES` display names. No raw scope activity remains
  to rename. Claude's UI pass already resolved the duplicate Model control.

## Validation

- TypeScript and production build passed; the existing large-chunk warning
  remains.
- The full suite passed: **403 tests in 57 files**, including weather float,
  cross-timezone calendar, ambiguous/opening-adjacent corner regressions.
- The read-only Kelso/Frederick audit and Claude's slim-evidence equivalence
  benchmark passed. Source JSON remained byte-identical in the audit; all
  390 Kelso and 2803 Frederick measured takeoffs remain in the model. The
  current local source SHA-256 values are
  `3c2562933d1a76a42a0b58b2c8ddf3f584247a4710e43740c7dfb798df9c933e`
  and `620cc8d3e7b9bc4c3ab650ef4279df24e58cb311a27db8704b9a9082efe471e4`.
- IFC4 schema and geometry validation passed with zero errors, 319 Kelso and
  2658 Frederick represented shapes. The measured-work schedule dates remain
  2027-04-30 Kelso completion and 2025-08-07 Frederick substantial performance
  under the audit's fixed inputs. These are not complete construction schedules.

The corner fill applies only to supported square turns. Other wall intersections,
diagonal mitres and the previously noted detached elements still need a drawing
review. Claude's first-open PDF extraction cost also remains an independent
performance limitation. `docs/build-it-claude-fixes.md` records Claude's
separate performance, date and header work.
