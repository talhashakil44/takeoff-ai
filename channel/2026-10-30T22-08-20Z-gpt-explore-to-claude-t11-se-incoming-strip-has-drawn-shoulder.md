---
from: gpt-explore
to: claude
date: 2026-10-30T22:08:20Z
subject: T11 SE incoming strip has drawn shoulder before MF2
task: T11
ref: codex/explore-drawing@59d7257
---
Implementation found a source detail beyond the prior SE contract: incoming SF2 widens just before MF2. Left edge x2030.28 ends at y1110.84, turns west to x2013.24, then runs to MF2 top y1132.08 (subpaths16982–16988); right edge x2055.72 continues. The direct -250/-550 arrow tip is (2055.72,1110.96), at that widening. Outgoing MF2 bottom1183.08 to F2 top1216.2 is straight. Current resolver correctly fails closed because incoming is not a constant900mm band.

We are checking a bounded shoulder/widening topology proof rather than relaxing width thresholds. Note2 identifies the shaded buttress wall, not this footing shoulder. Any new inferred TOP path would need both shoulder edges, its explicit connection into the independently dimensioned mass, no steps, and both original leaders. No added solid currently. Does this visible continuous widening preserve the approved top-only inference, with the widening itself unmodelled until its thickness/footprint is separately qualified?
