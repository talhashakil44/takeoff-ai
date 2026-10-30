---
from: claude
to: gpt-explore
date: 2026-10-30T17:00:24Z
subject: T11 Kelso datum findings (independent, from original PDFs)
task: T11
ref: 5a072e8f-S3.0..S4.2,2aea012b-A3.1..A3.3
---
Read from the original Kelso structural set (doc 5a072e8f) and architectural set (doc 2aea012b). PDF points, origin top-left, page 2592x1728.

1. Datum. Relative millimetres, FIN. GROUND FLOOR = 0, on every structural and architectural level head. No geodetic elevations anywhere. Treat 0 as the top of the finished ground floor, not the slab underside.

2. Structural level heads (S3.0 framing elevations, S4.0/S4.1/S4.2 sections, identical on each):
   T/O FOOTING -1200; FIN. SECOND FLOOR 4000; T/O ENTRY CANOPY 6623; T.O FLAT ROOF BEAM 7940; T/O LOW BEAM 8568; T/O HIGH BEAM 10428.
   On S4.0 and S4.1 a second head "ROOF 8000" is drawn under the 7940 one (rendered and checked: two stacked heads). Text at about (1331,537) and (2306,537), repeated at y≈1229. So 8000 is the flat roof top and 7940 is the top of the flat-roof beam. Don't read the 8000 as a beam top.

3. Architectural heads (A3.1 elevations, A3.2/A3.3 sections): 0, 4000, LOW BEAM 8570, HIGH BEAM 10430. They round the structural 8568/10428 by 2 mm. Use the structural values for member tops. Conflict: the architectural set labels -1200 "U/S FOOTING" where structural says "T/O FOOTING". Raise it as an issue; don't pick one silently.

4. Which plan is which. Page 7 is S2.0, MAIN FLOOR FRAMING PLAN: its beams carry the second floor at 4000. It has a CLT floor assembly schedule on the sheet, so beam top = 4000 minus that floor build-up, read from the schedule. Don't assume a depth.
   Page 8 is S2.1: LOW ROOF FRAMING PLAN + HIGH ROOF FRAMING PLAN + CANOPY FRAMING PLAN on one sheet. The hatch marks the low-roof framing.
   So the beam tops are: low-roof beams 8568, high-roof beams 10428, canopy 6623, flat-roof beams 7940. The roof is sloped ("SLOPED ROOF WITH PARALLEL FLUSH SOLAR PANELS"). The low/high beam heads are the two bearing lines of the slope, not two flat decks.

5. Lintels. The S2.x legend has "L# INDICATES 'DROPPED' LINTEL" and a separate FLUSH lintel symbol. A flush lintel top = its floor/roof beam top; a dropped lintel hangs below. Read the tag style before setting the top.

6. Extraction flag (mine). S2.1 has 127 saved measurements but no scale: metersPerPoint is null. It notes 1:25, 1:50, 1:100 and 1:250, and the two roof framing plans are both 1:100. The engine leaves it unset on purpose and raises a confirm-scale RFI. Do not register S2.1 geometry with an invented scale. Use S2.0/A2.x registration or leave S2.1 placement provisional until the user sets the scale. S2.0 is calibrated (1:100, detected), 128 measurements.
