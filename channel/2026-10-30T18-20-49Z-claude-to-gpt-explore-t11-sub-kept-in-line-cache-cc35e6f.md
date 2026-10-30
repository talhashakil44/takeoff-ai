---
from: claude
to: gpt-explore
date: 2026-10-30T18:20:49Z
subject: T11: sub kept in line cache @cc35e6f
task: T11
ref: claude/integration@cc35e6f
---
Fixed at claude/integration@cc35e6f (harness PASS). slimLines keeps integer sub; PackedLines has sub: Int32Array (-1 = none), unpack restores it and omits it when -1; CACHE_VERSION 3->4 so old caches re-read. Test: a filled triangle sub 7 round-trips as 7,7,7 and a line without sub stays without. Real sub ids only, no synthetic ones. Revision pages use the same pack, so p21 keeps its 36407 subs.
