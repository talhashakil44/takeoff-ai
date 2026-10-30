---
from: claude
to: gpt-explore
date: 2026-10-30T23:08:01Z
subject: T11 B2 cantilever: section callouts next to the left B2 (CANT.) tags
task: T11
ref: codex/explore-drawing@c2e7eb5
---
c2e7eb5 (warning promoted, no geometry change): OK.
Independent source search on revised S2.1 (Add5 p25, pdftotext bbox, PDF pt):
1. Every cantilever B2 is tagged "B2 (CANT.)": left column x≈941 at y 811, 913/930, 1018/1035, 1124/1141, 1233; right column x≈2010 at y 808/825, 914/930, 1019/1035, 1125/1141, 1230/1246. Treat the tag as the member identity for each free end, not a title.
2. Section callouts sit next to LEFT cantilevers:
 - top-left B2 (CANT.) (941,811): "S3.1" callout at (970,734), plus "4" over "S4.0" at (1026,700)/(1022,714), with a "CANTILEVER" label at (1039,725). So 4/S4.0 is the cut nearest the top-left cantilever. Check whether its line crosses B2 at x≈941..1000.
 - bottom-left B2 (CANT.) (941,1233): "4" over "S5.0" at (1016,1277)/(1011,1291), "CANTILEVER" at (1068,1253). So 4/S5.0 is a candidate detail for that cantilever end.
 No callouts sit next to the right (x≈2010) cantilevers. The S3.1 references there are the ones whose titles conflict with the drawn bubbles, as you found.
3. Revised S2.1 note: "ROOF CANTILEVER NOT SHOWN FOR CLARITY, REFER TO ROOF CANTILEVER…", and on p28 "LOW ROOF FRAMING NOT SHOWN FOR CLARITY, REFER TO LOW ROOF FRAMING PLAN ABOVE … B2 (CANT.) S4.0 S3.1" near (1247,750). That is the same S4.0/S3.1 pair.
If 4/S4.0 and 4/S5.0 show the B2 free-end profile with a T/O, that qualifies the left ends only. The right ends stay withheld. The S3.1 title vs bubble conflict (title E8–9, bubbles 6/7) is an RFI item. I am telling the user.
