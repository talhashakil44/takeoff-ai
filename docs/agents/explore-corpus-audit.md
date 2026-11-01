# Explore rule audit before corpus evaluation

Checkpoint: `7c66ddd` (implementation `58dbf78`, model 59). 2026-10-31.
Claude's bus directive at 19:54:56 UTC parks Kelso-specific T11 work and
requests general rules evaluated across the development corpus. T11 remains
incomplete. This audit does not assert cross-project accuracy.

## Recent rules and their limits

| Change | Classification | Evidence and action |
| --- | --- | --- |
| `sourceRegion.ts`: pad point/line evidence boxes for viewing; reject invalid boxes | General display rule | Preserve. No measurement or placement change. |
| Model 54 per-view scale guard | General safety rule | Preserve: a main-sheet scale cannot place an element measured in a differently scaled inset. Engine scale fixes must come from integration wholesale. |
| `insetRegistration.ts`, `gridStroke.ts`: traced axes, independent reference spacing, redundant residual and ambiguity gates | General algorithm, limited production validation | Preserve provisionally; quantify unsupported views across dev projects. Requires suitable grid labels, reference floor frame and detected view. Quarter-turn fitting is not arbitrary-rotation support. Fixed tolerances are hypotheses, not demonstrated corpus accuracy. |
| Model 57 sheet-view gutter split | General engine rule | Engine-owned; integrate Claude's version. Synthetic checks and revised Kelso source are not multi-project validation. |
| `foundationPlanEvidence.ts`: scheduled rectangular pad/pier outlines | General but restricted candidate algorithm | Dunnville evidence; only F/P marks, rectangular outlines, matching schedule and no revised foundation pages. Stacked pier/pad tag convention and 15 mm size tolerance need corpus evaluation. Does not place a solid or establish elevation. |
| `insetEvidence.ts`: registration provenance, stale withdrawal, plate designation conflicts | General scaffolding with notation restrictions | No hard-coded BP5/BP6 substitution. BP-number marks and plate schedule recognition limit coverage. Keep saved takeoff unchanged; do not resolve conflicts automatically. |
| `planTrace`, paper-only rendering, hit selection and candidate inspector | General UI/model capability | Preserve. Candidate lines are not source-verified physical beams and must not increase solid coverage. |
| `insetBeamTrace.ts`: tagged straight-ink extraction | General-shaped implementation with Kelso-derived pen assumptions | Exact black/#191919 and width >= 0.6 are not office-independent. Also restricts orientation and tag proximity. Keep candidate-only; evaluate dev misses before replacing with relative pen evidence or engine beam-span association. Never simply relax thresholds to raise coverage. |
| `canopyRegistration.ts`: canopy roof datum adapter | Narrow semantic adapter demonstrated on Kelso | XY now delegates to generic registration; elevation still requires exact `T/O ENTRY CANOPY`, structural sheet prefix and nearby 4–5 digit values, with two agreeing sheets. Do not broaden labels without linking the applicable datum to the actual roof region. Do not count this as general roof support. |

The older exact-title canopy XY/window solver was removed in `773a6d4`.
No B4 height or BP6-to-BP5 quantity/designation replacement was introduced.
The four B4 lines are 2D candidates, not newly placed beams. Remaining canopy
solids retain their prior qualified source gate; this audit does not revoke or
extend that gate. No blanket revert is warranted merely because a reusable
algorithm was first tested on Kelso. Narrow adapters must be identified in
evaluation, then generalized or removed based on development evidence.

## Proposed corpus coverage contract for Claude review

Freeze project revisions, accepted takeoff records, category mapping and source
versions before comparing checkpoints. Score original takeoff records, not
generated fragments; a record with several generated elements counts once.
Report by project and category, including zero-coverage categories:

- Denominator: all eligible accepted takeoff records in the frozen category.
  Keep unregistered and unresolved records in it. Explicitly report excluded
  demolished/superseded records and the exclusion policy.
- Numerator: records with source-backed physical geometry whose placement,
  dimensions and required vertical datum are qualified. A non-null `shape`
  alone is insufficient evidence; axes, locators and inferred shells do not count.
- Separately report registered-view evidence, 2D outline/trace candidates and
  unresolved records. These are diagnostic stages, not numerator substitutes.
- Publish per-project rates and their macro average alongside pooled counts,
  so a large job cannot mask regressions on smaller jobs. Require source/visual
  validation on changed dev categories; counts alone cannot prove alignment.

Confirm category mapping, exclusions and the qualification contract with Claude
before implementing the evaluator. Keep the engine quantity score separate
from Explore geometry coverage. Acceptance requires the agreed dev average to
rise and the corresponding sealed metric not to drop; no claim of acceptance
is possible until the sealed Explore metric exists.

## Sealed boundary and next action

`bench/exploreHoldout.test.ts` is a **development-only detailed diagnostic**:
it writes source texts/lines, item records, grid diagnostics and PDF paths.
It has no sealed-output gate. Do not run it on sealed inputs. Its current
solid count is not the proposed source-qualified coverage metric, and it
does not evaluate specification facts.

Claude owns sealed evaluation. Any future sealed Explore runner must expose
only agreed aggregate counts, suppress item-level assertions/logs/artifacts,
and keep source/debug access outside the development loop. Do not inspect
sealed drawings, snapshots or per-item scores to choose fixes.

Next: receive Claude's dev corpus/category table and metric contract, establish
the baseline using dev sources only, then address the highest aggregate miss
category with a general rule. Kelso B4 elevations, canopy datums and individual
plate conflicts remain parked. No source files or measured quantities changed
in this audit; no merge or deployment.

## 20:34 UTC contract update

Claude supplied nine development sets: Dunnville, Brampton arena, Williamsburg,
Trafalgar (no key), Market, Seneca, HOPA, Stadium and Malton. Use key categories
`walls`, `walls-total`, `foundations`, `slab`, `structure`, `ceilings`, `floors`,
`doors`, `windows`, `plumbing`. Trafalgar is diagnostic-only until it has a key;
do not silently score it as zero or include it in the scored macro average.
Claude owns OCR and engine classification repairs and will send the next
category table before Explore chooses a category. Sealed evaluation remains
Claude-owned and summary-only; Explore must not run on sealed data.

There is a denominator distinction to settle before implementation. The fetched
engine scorer at integration `524748f` uses aggregate key items (`code`, `kind`,
`qty`, optional type-name `match`), not individual takeoff record IDs. One placed
record cannot mark a whole key item as geometrically covered. Keep record-level
placement coverage as a separate diagnostic from key-item coverage. Confirm how
to score partially covered key items and overlapping aggregate keys such as
`walls-total`, and how source-qualified geometry maps to quantity contributions
for room finishes. Do not sum lengths, counts and areas into a single numerator.
The forthcoming category/contributions scorer has not landed on fetched
integration yet; reuse its matching semantics when available instead of
creating a competing category matcher.

## 21:04 UTC agreed fractional rule
Claude confirmed qualified placed quantity / engine quantity for matching
contributions of the same kind, capped at one. Room-finish contributions use
room geometry. `walls-total` is diagnostic-only; no-key projects excluded.
`src/build/geometryCoverage.ts` implements arithmetic and matching only, with
explicit qualification supplied by the caller. It does not qualify shapes or
read datasets. Zero-engine keys remain zero coverage with a missing-engine
flag. Per-contribution caps prevent an oversized fragment from covering other
unplaced records. Pooled output averages dimensionless key fractions, never
sums quantities of incompatible units. Corpus wiring and source qualification
are still outstanding; synthetic tests are not evidence of drawing accuracy.

The contribution adapter now calls app contributions() directly, retaining room
measurement/type/role identity and converting quantities to metric exactly once.
Sheet repetition is already present in length/area vars and is applied explicitly
for counts. Qualification defaults to zero and must account for repeated
instances; a drawn typical-floor mesh alone cannot qualify all repeated floors.
This adapter does not establish source qualification or run a corpus baseline.
