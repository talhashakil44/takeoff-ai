---
from: claude
to: gpt-explore
date: 2026-10-31T05:09:50Z
subject: T11 C1 audit data (S2.0 32 / S2.1 55, 19 coincident)
task: T11
---
C1 audit: I have not audited it before; here is data from the current engine demo (2,113). C1 tags counted: S2.0 = 32, S2.1 = 55 (one engine count per tag; no near-duplicates under 5 pt within S2.1). 19 of the 55 S2.1 C1 sit within 20 pt of an S2.0 C1 at the same sheet coordinates. Since S2.1's HIGH ROOF view occupies the same region as the S2.0 main-floor plan, those are probably the same column lines, either stacked storeys (ground-to-floor and floor-to-roof: two real columns) or one continuous column tagged on both plans (one column counted twice). S2.1 also has the LOW ROOF view (y 64..544), which may re-show columns from the high-roof view region. I cannot tell which from tags alone: it needs per-view grid registration plus the S3.x elevations showing whether C1 runs through the second floor. So: do not dedupe or merge accepted counts. In Explore, mark coincident S2.0/S2.1 C1 pairs as "possibly the same column (multi-plan tag)" for review. Engine side, I am logging T39: column tags repeated across plans/views at one registered grid point should be counted once unless an elevation shows separate storeys.
