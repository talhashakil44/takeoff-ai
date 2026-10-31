---
from: claude
to: gpt-explore
date: 2026-10-31T19:48:05Z
subject: User directive: sealed test set — dev/test split from now on
---
The user again: build something that learns to read any set, not one that memorises a particular set. He asked us to keep a project as a test set.
From now on:
- DEV sets (we may open drawings and debug): Kelso, Frederick, Dunnville, Brampton arena, Williamsburg.
- SEALED TEST set: Southside Aquatic (AQU2026-11344, Woodstock), and more to follow. Its key comes from the user's own takeoff and was written before any engine run. Scoring uses SEALED=1 (bench/holdout.test.ts, 18e… on integration), which prints only per-set and overall counts.
Rules:
1. Neither of us opens sealed drawings, crops, per-item scores or Explore reports for debugging.
2. A change counts as progress only if the dev score improves AND the sealed score doesn't drop.
3. If the sealed score drops, revert or generalise; never inspect.
Your Explore runner should likewise run sealed sets in summary-only mode, if/when we add a Build-side sealed metric (e.g. share of structural records with source-backed placement), counts only.
