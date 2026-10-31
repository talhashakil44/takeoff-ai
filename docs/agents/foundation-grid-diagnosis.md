# Foundation registration diagnosis — development corpus

2026-10-31, Explore checkpoint 8ff3212, finalized run2 Williamsburg inputs.
Original PDFs matched the delivered manifest SHA1. No sealed inputs used.

## Observed failures

All ten foundation-source records on S1.1 are unplaced. The existing production
result reports a different scale from the main plans, but the deeper cause is
missing grid registration:

- S1.1 has two single-ended numbered grids (1/2) and two single-ended lettered
  grids (A/B). Text-only gridAxes requires three labels in a single-ended family
  and returns no axes.
- A2.2 has actual repeated 1/2 and A/B bubbles. Its numbered keynote list forms
  a longer collinear family, so the single-ended family pass replaces the real
  numbered grids with thirteen keynote rows. This reference has only y axes.
- Original S1.1 page29 and A2.2 page17 were visually inspected. The four genuine
  grids are present, with different paper scales (1:100 and1:50). No arbitrary
  translation, scale adjustment or two-label text-only relaxation is justified.

## Independent existing vector tracer diagnostic

Using traceGridStroke on every candidate A/B/1/2 label and both directions:

| Grid | S1.1 traced PDF coordinate | A2.2 traced PDF coordinate |
| --- | ---: | ---: |
| 1 (x) | 514.56 | 693.96 |
| 2 (x) | 1027.20 | 1717.08 |
| A (y) | 123.48 | 376.68 |
| B (y) | 462.72 | 1053.72 |

Section markers 1 and2 on S1.1 yield no traced grid. Opposite architectural
bubbles agree on each actual axis. Existing matchGridAxes accepts the traced
families with x offset5.9309m, y offset−2.2754167m, zero rotation. This is a
candidate registration, not accepted geometry or a physical coverage gain.
The source scale/glyph/vector precision leaves nonzero spacing residuals; do
not describe this as exact matching. Diagnostic log:
/tmp/williamsburg-grid.log; original renders /tmp/williamsburg-page-17.png and
/tmp/williamsburg-page-29.png. These local client artifacts are not committed.

## Next implementation gate

Add vector-backed grid-family evidence without weakening text-only ambiguity
checks. Consistent opposite bubble witnesses should outrank unrelated keynote
families. A smaller single-ended family needs independent stroke evidence and
cross-sheet spacing agreement. Conflicting witnesses must withdraw the axis.
Thread the same registration inputs through extraction and other registration
consumers; changing extraction alone can make roof/facade/column coordinates
inconsistent. Test synthetic keynote contamination, paired/single-ended grids,
conflicting traces and rotated frames, then compare both existing dev project
models and original-PDF/live overlays. No project-name or coordinate constants.
Foundation elevations and local section applicability remain separate gates.
