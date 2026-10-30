# Kelso services re-QA after T24 (T26)

Reviewed the refreshed `Kelso demo (cf2bcad5)` at
`.agents-data` on 30 October 2026. It has **2,130** measurements (590 pipes,
117 ducts). `scripts/qa-kelso-overlays.mjs` drew each source measurement over
M1-01 through M1-04; images and `index.json` are under ignored
`diag/qa-kelso/`. Coordinates below are PDF points from the top left. The
original project JSON and PDFs were only read.

## Findings for Claude's takeoff engine

1. **M1-01, 75Ø SAN vertical still starts late.** The pipe from FD-1 near
   `(998, 365)` runs down to about `(998, 554)`. Measurement
   `e85bac92-cf1c-4520-8781-b777f1fd7c8f` covers only
   `(998, 468–554)`. The upper roughly 103-point segment remains black in the
   overlay. T24 recovered the lower part, not the whole drawn run.
2. **M1-01, 75Ø SAN upper horizontal mostly missed.** At the label
   `(1189, 449)`, the line from the centre stack near `(1130, 449)` toward
   the eastern fixtures (about `x1320`) has only a 15-point overlay at
   `(1242–1257, 451)` (`ce25eeb3-59ea-4ee7-a751-ee2cd5ec2df0`).
   The line on either side is visible without a pipe measurement.
3. **M1-01, 75Ø SAN lower horizontal mostly missed.** Near the label
   `(1211, 1270)`, the drawn run is visible from about `(1025, 1270)` to
   `(1284, 1270)`. Only `(1229–1284, 1270)` is overlaid
   (`4642fe9e-c8d0-4343-abfb-242dafffc672`).
4. **M1-03, auditorium 400x300 S/A branches remain partial.** The upper
   branch near `(1253–1430, 302)` has only `(1253–1298, 302)` overlaid
   (`97ba60e8-32c8-4e3d-9513-7c4ba8839f4b`). Another branch near
   `(1250–1420, 419)` has only `(1276–1339, 419)` overlaid
   (`bd5b17e6-d968-4fa6-bce1-a74b5942c91a`). A lower branch near
   `(1254–1420, 1018)` likewise has only `(1276–1339, 1018)` overlaid
   (`b5627a1d-c222-406d-9c6a-249ed7105669`). Other auditorium branches
   are now substantially recovered; these three still need full centreline
   coverage.
5. **M1-03, same duct centreline counted twice.** `Duct 300x400` on the
   right auditorium perimeter at `x1476`: measurement
   `3d6f29c9-390e-4dca-bdf9-78d7d11462bc` spans `y449–717`; another,
   `378f7e07-84fc-4a0d-9cc6-75b8bd9d7982`, spans `y482–658` on the same
   centreline, a 176-point overlap. `Duct 250x200` on the L1 side at `x521`
   similarly overlaps 66 points (`y1006–1116` and `y1031–1097`, IDs
   `26141b97-dab6-4f18-a7d5-ad504662ecea` and
   `14ab83eb-fd17-484a-af42-a2bb928303cb`). These are surplus lengths,
   not separate ducts.
6. **Overlapping pipe lengths remain.** M1-01 `100Ø SAN` vertical at
   `x999–1001, y834–931` is covered twice (IDs
   `51f1dd6e-f823-450a-b20b-b8bd186e4081`,
   `4b6bee8a-09ab-4cf1-899f-9d664392671e`; 97-point overlap).
   M1-02 `20Ø DHW` at `x534–537, y857–922` overlaps the long
   `y409–922` run (IDs `f24b7a18-9b67-459b-ac5e-806eaeee6b9d`,
   `70a357d4-9b83-4d43-906b-cc421eee7b6e`; 65 points).
   M1-04 `75Ø HGS` at `y505–506, x733–819` overlaps the long
   `x557–819` run (IDs `dc35ca90-8347-4edc-b84e-822872b0e37e`,
   `50492901-303c-497c-bcf7-7113595f2e27`; 86 points). A heuristic
   search found 43 near-collinear pipe pairs and 10 duct pairs of the same
   size with more than 80% of the shorter segment overlapping within
   3 PDF points; these cited examples were visually checked, while the pair
   counts are review leads rather than a calculated quantity overrun.

No duct-source measurements remain on the M1-01/M1-02 plumbing or M1-04
heating sheets. The above examples are the clear misses and double counts
found in this sweep; they are not a complete centreline reconciliation.

## Schedule check

The refreshed audit (start 2026-11-02) reads **875 m of piping** and
**269 m of ductwork**, or **1,144 m** of mechanical rough-in. The current
activities are Foundation **67.63 m / 3 working days**, L1 **591.60 m / 22
days**, and L2 **484.73 m / 18 days**, at the assumed **27 m per crew-day**.
L1 and L2 each have 2 days of float. Compared with Claude's pre-T24 lengths
of 836 m pipe and 199 m duct, measured work increased by about **109 m**, or
about **4.0 unrounded crew-days** at that rate. The prior project snapshot is
not retained, so an exact before/after *per-level rounded duration* cannot
be verified. The current three activities total 43 working days.

Kelso's earliest finish remains **2027-08-05**; Frederick remains
**2025-08-07**. The audit confirms 2,130 Kelso and 2,806 Frederick takeoff
elements and preserves each source project's JSON hash. No takeoff engine or
Build It code was changed for this review.
