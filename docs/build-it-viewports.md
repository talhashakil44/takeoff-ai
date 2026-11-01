# Side-by-side plan levels (T15)

Build It now reads paired viewport titles near the bottom of a measured sheet,
such as `L1-Plumbing` and `L2-Plumbing`. It assigns a takeoff to the labelled
level only when the titles are aligned horizontally and the measurements form
two clear plan clusters with a gap between them. A line crossing the divider
or a sheet without reliable paired titles stays at unknown level. A user's
explicit sheet-level edit still takes precedence.

This resolves the **schedule level**, not the plan's position relative to the
building. Each viewport needs its own XY grid registration before its pipe or
duct line can be drawn honestly in 3D or IFC. Until that exists, the element
keeps its measured length and level but has no geometry, and a review issue
explains why. `MODEL_VERSION` 17 invalidates old cached models.

The read-only refreshed Kelso demo audit assigns all 815 measurements on
M1-02, M1-03 and M1-04: 444 to L1 and 371 to L2. By sheet the split is
214/161, 48/71 and 182/139 respectively. No source measurement was changed.
Mechanical rough-in now plans 75.37 m at Foundation (3 days), 766.28 m at L1
(29 days), and 528.91 m at L2 (20 days), using the assumed 27 m per crew-day.
Its L1 and L2 work lies on the driving path; Kelso's measured-scope finish
moves from 2027-06-23 to **2027-07-23** (190 working days from 2026-11-02).
Frederick remains **2025-08-07**. The audit checked that all 1,653 Kelso and
2,806 Frederick measurements remain represented and both source project JSON
files remain byte-identical.

The unit test covers paired labels, level assignment, no false XY shape, and
the level-to-level plan link. The integration audit confirms the actual Kelso
title text and takeoff distribution. Full acceptance runs TypeScript, tests,
production build, and the read-only demo audit.
