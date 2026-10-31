# FW5 revision and profile review — 2026-10-31

This review qualifies source applicability; it does not change accepted takeoff
quantities, original files, or model geometry. Runtime remains model35/e95d4cd.

## Verified vestibule type and extent change

Original structural PDF `5a072e8f-1126-4129-b9e9-53470bfb267a`, page4 S1.0,
labels both vestibule vertical walls FW5. Revised Addendum5 PDF
`bec80a15-e5e2-4cdd-a142-c02af1b8f631`, page21 S1.0, changes the left wall to
FW1, retains the right FW5, and changes/adds the return-wall geometry. This is
not a misread of the original sheet: it is a revision reconciliation gap.

| Record | Legacy id | Current engine id | Accepted source axis (PDF points) |
| --- | --- | --- | --- |
| Left, now FW1 on revised drawing | 2fc01570-a6d3-41a2-a99c-4a1fabb49c3d | 00f61a83-b5d1-46da-a2d7-b7bbc6dca7bc | (306.60,1214.22) to (306.60,1378.20) |
| Right, still FW5 on revised drawing | cb75c52b-05ad-4bf3-94ce-83a9cf951073 | 794219f7-62c2-4ed4-9fa2-6942d6702d67 | (461.88,1214.22) to (461.88,1378.20) |

Both current engine records retain 5.784850m. Use measurement/source coordinates when comparing regenerated engine IDs.

The revised left FW1 label is at [244.44,1286.02,263.01,1293.13]; its horizontal
leader meets the left wall. The revised right FW5 label is at
[400.80,1281.34,419.37,1288.45]; its leader meets the right wall. Original and
revised crops use the same PDF clip [240,1180,530,1430] and were independently
viewed. Local proof files: diag/explore/proofs/fw5-vestibule-original.png and
fw5-vestibule-revised.png (generated diagnostic files, ignored by git).

Do not merely retype the left accepted record and preserve its old length.
Reconcile revised extents and return walls through the takeoff owner. The model
already withholds old-sheet physical solids, so no geometry was enabled here.
Do not treat the difference between 12 accepted FW5 records and 11 revised FW5
text labels as independent proof: repeated/implicit tags can cover more than
one element. The direct label/leader comparison is the evidence.

## Four stair-side panels and the top-profile gap

Revised S1.0 has horizontal FW5 panels near y1030.92 and1136.34 at the left end,
and y1030.92 and1157.58 at the right end of this sheet. The supporting MF2 areas
have local footing elevations, but those do not determine the wall tops.
Construction NOTE2 identifies shaded concrete buttresses; NOTE5 explicitly
requires the top to suit steel stairs and grading, coordinated with architectural
and civil drawings. Not all FW5 records are these buttresses: the vestibule wall
above and west Ef panels must be assessed separately.

Claude's bus report 2026-10-31T02:05:31Z reviewed original architectural A5.2
page33: 03/A5.2 exterior stair has landing/stair levels but no dimensioned FW5 top
profile; 06/A5.2 likewise does not establish it. The 5065 concrete wall top and
-1200 footing elevation belong to 09/A5.2 INTERIOR STAIR, not these panels.
Claude found no applicable civil text elevation and will raise a specific RFI.
This is Claude-reviewed evidence, not a claim that this worker independently
visually verified A5.2 or all civil geometry.

Required before solid recovery: locally applicable top endpoint elevations,
top-profile shape/extent and base association for each actual closed plan panel.
No inferred uniform4000mm top, borrowed5065mm top, or borrowed west Ef profile.

## Validation and next action

Original and revised PDF crops directly inspected, current and legacy model
records inspected; no source or accepted quantities modified. Browser live
verification attempted twice but the UI tool returned `browser.user is unavailable`.
No runtime change was made, so this review does not claim a new live2D/3D pass
or rerun code gates. Last verified runtime checkpoint is e95d4cd (586 tests,
typecheck, build and source audit passed on the previous wake).

Sent exact revision discrepancy and record IDs to Claude through agents/bus.
Next: consume his revision reconciliation response; separately audit west Ef
MF3 plan datum and section applicability. East FW5 top recovery stays held until
new setting-out evidence arrives. T11 remains incomplete.
