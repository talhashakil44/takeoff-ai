# Kelso refreshed-demo takeoff QA (T22)

Reviewed 30 October 2026 against the refreshed `Kelso demo (cf2bcad5)` under
`.agents-data`. `scripts/qa-kelso-overlays.mjs` renders each non-superseded
source measurement over its sheet PDF at 1 PDF point per pixel. Output is
ignored under `diag/qa-kelso/`: one PNG per sheet and `index.json` with IDs,
types, points and bounding boxes. Coordinates below are PDF page coordinates
from the top left, not screen pixels. The script only reads project JSON/PDFs.

The 2,294-measurement demo contains 1,263 measurements in the five sources
reviewed: 734 pipes, 127 ducts, 274 structure, 110 foundations and 18 site.
All 1,263 were drawn across 10 sheets. This is a targeted visual audit, not a
claim that every measurement is correct.

## Findings for Claude

1. **Plumbing and hydronic pipe runs classified as ducts (false positives).**
   On M1-01, `Duct 75 mm round` `c14491fc-a4a2-4fc7-aacb-8c7efe7e9ea0`
   at about `(1007–1041, 693)` follows the line labelled `75Ø SAN`.
   `Duct 150 mm round` `108b16a7-5206-4da9-a24d-4acd3b04cd0d` at
   `(906–930, 950)` follows `150Ø SAN` by the building cleanout. On M1-02,
   four `Duct 75 mm round` segments at `(1140–1153, 996–1010)` overlay the
   domestic water/plumbing cluster (IDs `abccc7aa-5894-4741-8e33-9d764af841d6`,
   `b6ae1644-e33a-4dda-bf1e-ab2364127f2b`,
   `28bd5b55-5c7f-4b89-9876-ced57627b3c1`,
   `be7ed5a3-474f-4585-a9a2-e3b37dce278b`). The fifth M1-02 duct,
   `Duct 12 mm round` `c276d810-e78d-4720-982e-21f14dd3a07c` at
   `(499–513, 598)`, is a short line in the plumbing/dehumidifier cluster;
   its duct service and size need manual review. On M1-04, `Duct 100 mm round`
   `87f6b0a9-7999-4f4c-a658-0edbacff5687` at `(1633–1674, 580)` sits
   on the line labelled `100Ø HGS` (heating glycol supply). The clear SAN/HGS
   examples should leave duct quantities and be counted only in the correct
   pipe service.

2. **Identical glulam beam spans counted repeatedly.** S2.0 B1
   `(1535.76, 812.04)–(2043.84, 812.04)` occurs **four times** with identical
   type and endpoints: `52faef89-8032-41f8-a678-5ed901203752`,
   `6e7223ad-3f36-4b6a-8d10-1b2bc7426bfa`,
   `d6bc79b5-d106-45b8-8f5b-974ed946a076`,
   `6e5cadc7-4239-46fb-b955-98eb3330363b`. It also crosses several
   column/grid locations as one beam span. S2.1 has two copies each of B1
   `(1085.52, 216.60)–(1498.29, 216.60)`, B1
   `(1498.29, 216.60)–(1836.36, 216.60)`, and B4
   `(1756.20, 227.52)–(1756.20, 410.88)`. Across the structure source,
   four exact-duplicate groups add six surplus span measurements. Deduplicate
   and split beams at actual supports before using span counts or lengths.

3. **Multiple pipe lengths trace the same drawn run.** M1-01 has two
   `Pipe 100 mm SAN` vertical segments at `(997.8, 701–780.7)` and
   `(999.5, 701–780.7)` (`7cb67a09-6854-4acb-b011-2f8713dd9de2`,
   `2ec7a813-cb56-4ebf-a47e-5973d4ae52ad`). These are parallel by only
   1.7 PDF points and overlay one double-line sanitary run. Near
   `(1044–1105, 1213–1216)`, three `Pipe 75 mm SAN` segments likewise trace
   one horizontal run (`a6abeb63-9270-43f4-8d36-42aa4e61a8c5`,
   `b9248d5b-1819-4ef6-a24c-cfcf8dfc6823`,
   `5ad92740-34ab-4ab8-8d96-5aa2afd4b568`). Check centerline merging;
   the exact project-wide overcount was not calculated.

4. **Clearly labelled pipe and duct runs missed.** M1-01's vertical
   `75Ø SAN` run near `(995, 370–550)`, from the upper FD-1 down to the
   junction, has no red pipe overlay. M1-03's auditorium `400x300 S/A`
   horizontal branch near `(1260–1430, 410)` has no blue overlay beyond a
   short near-core stub. Other parallel `400x300 S/A` auditorium branches
   below it also lack overlays. These are examples, so a full missed-run
   sweep is still needed.

5. **Foundation and base-plate count geometry is on labels, not the
   components.** On S1.0 around `(980, 843)`, F1 pad footing
   `e868a69e-dc24-4cfe-925c-9eddc9ad71ae`, P2 pier
   `be38c894-a3f0-48c5-ace4-7519f1ed0e5b` at `(984, 851)`, and BP2
   base plate `14da9daf-fe95-467d-9825-637582221810` at `(991, 858)`
   are plotted on adjacent F1/P2/BP2 tags. The dashed pad and column center
   is near `(1010, 925)`. Quantity may still be one each, but 3D placement
   uses the wrong XY point. The repeated pattern is visible along S1.0's
   interior grid. Register count markers to their actual footing/column
   centers after reading the tags.

6. **Five existing-condition culverts appear as new site quantities.**
   C-101 is titled *Existing Conditions and Removals*. The five site-source
   `Culvert` measurements there are placed on existing culvert labels:
   450 mm 8.5 m `c1ae437e-8c47-4e13-ae6c-becd8dcb3886`, 200 mm 9.7 m
   `18431560-4ce0-417f-803d-b14e4a47404a`, 450 mm 14.5 m
   `1c3d367d-5fce-4ba6-a3cb-8fa02217a3cd`, 750 mm 6 m
   `e4c9702d-1c06-42a5-b267-a499849fba3a`, and 300 mm 5.5 m
   `45f702f0-39ca-474f-8ccb-a157f17a347d`. They should not enter new
   culvert installation quantities without a proposed-work or removal
   instruction. C-103's one proposed 400 mm culvert is a separate item.

## Scope and limits

- The S1.0 foundation-wall and strip-footing line overlays generally follow
  the drawn wall runs in the reviewed crop; no exact duplicate foundation
  or site geometry was found by endpoint comparison. This does not validate
  the assumed concrete sections or quantities.
- C-103 site utility measurements are short marks over *stated length*
  labels, so the recorded metres are label-derived, not traced routes.
  C-106's 560 m access-road measurement is likewise a mark at chainage
  `0+560` near `(1990–2012, 1538)`. The overlay cannot validate the route
  geometry or independently confirm the chainage length.
- T14's new electrical counts arrived during this review. Deriving rough-in
  durations from device counts is a separate Build It planning task; no
  Claude-owned takeoff code or original project data was changed here.

Reproduce: `BUILD_PROJECTS_ROOT=/Users/talhashakeel/dev/takeoff-ai/.agents-data
node scripts/qa-kelso-overlays.mjs` (Node 24). Open the PNGs and query
`diag/qa-kelso/index.json` by sheet, type or measurement ID.
