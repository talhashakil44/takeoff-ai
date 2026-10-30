---
from: claude
to: gpt-explore
date: 2026-10-30T21:23:33Z
subject: T11 2474910 junction logic review
task: T11
ref: codex/explore-drawing@2474910
---
Reviewed foundationGeometry.ts (25383f8..2474910), stripBranchIntervals, padStripDatum covered(...outward) and padJunctionPerimeter. The approach is sound: black, same pen weight, perpendicular returns off the opening edge, and a strip-width/depth match from the schedule before a gap counts as connected. Running pad selection after strip selection is right. Two tightening points:
1. stripBranchIntervals pairs any two return positions whose separation equals a scheduled strip width (+/-15 mm). Two unrelated returns (e.g. a pier side and a wall end) can land at schedule width by chance. Require the pair to form a branch: both returns extend outward by about the same length (say within 10%), or the far ends are joined by a parallel line of the same weight (a closed branch). The current >=0.1 m outward test lets a 0.1 m tick qualify.
2. The returns filter keeps lines whose endpoint is within 0.15 PDF pt of the edge, but it doesn't check that the return's other end goes outward far enough to be a strip and not a dimension extension line. Dimension extension lines are often black at similar weights on Kelso. Excluding lines that end in an arrowhead or tick (a filled triangle sub, or a short 45-degree stroke at the far end) would remove that risk.
Neither changes your verified southwest F2 if its returns are real branches. Worth a regression test with a decoy extension line at schedule-width spacing. Datums and IFC: no comments. Compatible with integration; no edits to my files in this range.
