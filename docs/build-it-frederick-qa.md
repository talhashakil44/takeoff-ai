# 84 Frederick refreshed-demo takeoff QA (T29)

Reviewed 30 October 2026 against `.agents-data/84 Frederick demo (fd48d4ed)` at project JSON SHA-256 `2f626973cbfba3d547a1793ab637e69e9b20a1a6e5abc9f9420ed66b5e699c86`. The read-only `scripts/qa-frederick-overlays.mjs` drew all **2,806** saved measurements across 27 non-superseded sheet PDFs. Ignored output under `diag/qa-frederick/` includes one PNG per sheet and `index.json` with measurement ID, source, type, points and bounding box. Coordinates below are PDF page points from the top left. I reviewed all sheet montages, then inspected the cited areas at full resolution; this is targeted QA rather than a claim that every quantity is correct.

| Source | Count | QA result |
| --- | ---: | --- |
| demolition | 1,106 | Finding 1: A011 egress lines counted as demolition; finding 2: invalid “Demo 0” type. |
| walls | 416 | Sampled A211–A214 runs generally track drawn partitions; 381 are marked existing and 35 new. No specific geometry error confirmed in the reviewed crops. |
| rooms | 157 | Finding 3: 136 room areas are scheduled as ceilings. |
| windows | 144 | Finding 4: plan and elevation counts are mixed, with level assignment errors. |
| no source (`Doors`) | 105 | Finding 5: basement A211 door openings are absent. |
| ceilings | 218 | Finding 6: open stair and corrupt type counted as new ceiling work. |
| symbols | 539 | RCP markers on A501–A504 generally land on drawn fixtures/devices in reviewed crops; no coincident same-sheet symbol IDs within 2 PDF points. A complete legend-to-plan tally was not done. |
| trades | 118 | Finding 7: roof symbols counted on both M104 and M305; some existing equipment marks enter new work. |
| pipes | 3 | Finding 8: overlapping M102 rainwater/storm traces and service/type uncertainty. |

## Findings for Claude

1. **A011 egress diagrams add demolition wall quantities.** A011 is titled *OBC Data Matrix / Egress Diagrams*, not a removals plan. Its 71 `Demo: other walls and partitions shown dashed` traces total **110.7 m** and follow ordinary room/fire-separation lines. Example `8eeeb197-039e-4a00-886d-1a9ef80e06eb` at about `(873–923, 437)`; several more at `(259–366, 1358–1404)`. The matching demolition source on A201–A205 has actual removals notes. Exclude the A011 egress-derived traces from demolition work unless a removal instruction is independently found.

2. **“Demo 0” is an invalid extracted removal type.** There are 86 counts named `Demo 0: Floor Types, see A000 series Sheets Roof Types, see Sheet A215 Part…` on A201/A203/A204/A205. The label joins unrelated legend text and no removal note 0 appears in the reviewed notes. Example A201 `4860ff5b-3c9d-4210-81b2-a618c748f2b5` near `(581, 745)` sits among numbered callouts. Re-read these note numbers and classify them before using the 86 as a scope category; the count is not necessarily 86 false positives.

3. **Generic room areas are scheduled as ceiling work.** The 157 `Rooms` source polygons on A211–A214 mostly trace room extents, but Build It routes **136 / 1,722.2 m²** to `ceilings` and 21 / 172.5 m² to `finishes`. Example A211 room `b3c98354-443b-47ae-bc6f-15ea384e28a2` at approximately `(706–795, 1172–1261)` becomes 9.0 m² of ceiling work. The dedicated `ceilings` source already has 218 areas; 31 new areas / 360.4 m² also route to ceilings. Current ceiling activities total 2,082.6 m² and 37 rounded workdays across L0–L3. Generic room floor area does not establish a ceiling installation quantity or type. This is a Build It trade-routing and schedule issue as well as a takeoff interpretation issue.

4. **Window plans and elevations both contribute to one new-window count.** A211–A214 have 93 `Windows` count markers on plan opening tags (for example A211 `0a43f1bb-8cd0-4de6-8aea-fef49ebe5c3b` at `(617, 1464)` beside a W-tag). A301–A303 add 51 markers on elevation glazing, where tags such as W1a/W1b identify parts of the same assemblies (A301 example `24a6ba15-6d6d-41e7-9bf1-7a38d3886edc`). All 144 enter new doors/windows work. Of the 51 elevation counts, 39 land on L3 and 12 are unplaced. Reconcile opening IDs and assembly-versus-lite basis before summing; do not treat the 51 as confirmed additional windows or assign their level from an elevation title.

5. **Basement door openings are missing.** The 105 unattributed `Doors` counts occur on A212–A214 (38, 35, 32), while A211 has none. A211 shows door swings and B-numbered openings in new partition work, for example B04a and B06 near `(500–560, 460–600)`. The current `work:doors:L0` count of 19 is entirely from window-source items. Count and reconcile the basement doors against the opening schedule; whether each individual existing door is replaced still needs the schedule.

6. **Two ceiling-source areas cannot be accepted as new ceiling installation.** A501 stair 901 at `(279–333, 219–282)` is `Ceiling – open / none shown (untagged)` (`77dd99c1-38f1-4bdd-bc20-a5a298c35cdd`) yet adds 3.95 m² of new ceiling work. A503 lounge area at `(269–321, 906–1013)` has a `CX3` existing-ceiling mark on the sheet, but `deccff56-64eb-4d3b-b2e6-5c0facdb6465` is typed as a concatenation of general legend text beginning `0 – See A000…` and adds 4.46 m² of new ceiling work. Reclassify or exclude these before scheduling. The two `cx2 – Reserved` polygons on A503/A504 are marked existing and do not currently enter work.

7. **Roof mechanical marks are duplicated across disciplines.** M104 (`Plumbing Roof Plan`) has 25 `Equipment Identification` counts; M305 (`HVAC Roof Plan`) has 24. **Nineteen pairs** are within 1 PDF point at the same roof symbol, for example M104 `c482d5a1-310f-41cd-b6d9-636b4f93b4f6` and M305 `ba7af134-5dbd-4f03-8725-ac87d16987f8` both at `(583, 337)`. The overlay marks small square roof symbols, not an equipment ID text. Both are scheduled as new mechanical trim, with M104's roof-plan item on L3 and M305's on Roof. M203 also counts `18d4d528-7c4b-4eb2-b51b-189f29d1a103` near `(586, 303)` at a BB-X1 *as exist* location as new equipment identification. Resolve the symbol/service and existing-versus-new status, deduplicate cross-sheet views, and assign roof-plan items to Roof.

8. **Two of three pipe-source traces overlap on M102.** `Pipe 76 mm RWL` IDs `f17aa617-4cfc-4776-ac04-6fa848eb397d` and `50647c4e-ce2d-4a9b-beb7-e49feee4d60a` run near `(280, 519–569)` and `(281, 519–539)` respectively, sharing 20 PDF points of one vertical `STM` run. The nearby drawing notes use `Ex.` and `STM`; its new-work status and RWL size/service require review. The third pipe is at `(624, 523–570)`. Other M-series sheets show hydronic supply/return runs but repeatedly call them existing or retained, so this QA does not assert that every unoverlaid hydronic line is a missed new pipe.

## Limits and reproduction

The overlays confirm drawing position and type labels only; they do not independently verify installed lengths, assembly specifications, or every repeated symbol. The audit generated no writes under either demo project. Reproduce with `BUILD_PROJECTS_ROOT=/Users/talhashakeel/dev/takeoff-ai/.agents-data node scripts/qa-frederick-overlays.mjs` on Node 24, then inspect `diag/qa-frederick/index.json` by ID/type and the sheet PNGs. The unchanged project JSON hash is listed above. Current Frederick Build It finish remains **2025-08-07** pending any accepted corrections.
