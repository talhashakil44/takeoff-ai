# Build It duration realism review (T19)

## Reproduction and scope

I reviewed `origin/claude/integration@9cc20bf`, using the refreshed, **read-only** Kelso and 84 Frederick demos under `.agents-data`. Their saved measurement counts are 1,653 and 2,806 respectively. I generated the refreshed Build audit inputs, accepted every suggested allowance **in memory**, and called `replan` with the extracted model, spec sections, and facts. No project JSON/PDF was edited. Use `schedule.feasibility.baselineFinish` for the lean finish: `schedule.times["ms:finish"]` can differ by a day, and Frederick's documented target can trigger resource recovery.

| Scenario | Start | Lean finish | Driver |
| --- | --- | --- | --- |
| Kelso, all five suggestions accepted | 2026-11-02 | **2027-08-02**, 196 working days | Structure approvals/fabrication → foundation → L1 structure → L1/L2 mechanical rough-in → L2 ceilings → flooring → 15-day closeout |
| Frederick, all suggestions accepted | saved contract start | **2025-10-02**, 159 driving working days | Demolition → provisional electrical rough-in → ceilings → flooring |

Frederick's saved target is 2025-10-31, so its final `schedule.times` may show target recovery; the lean baseline is 2025-10-02.

## Quantities and rate evidence

All rates below are **Build It assumptions**, not verified Kelso subcontractor production. The durations are calculated by summing quantity/rate across units, rounding up, with one crew unless stated otherwise. Published data do not establish a directly transferable Ontario crew rate for this mix of foundation, glulam/steel, mechanical, and interior assemblies.

| Package | Current quantity and arithmetic | Duration | What the evidence supports |
| --- | --- | ---: | --- |
| Earthwork | 1,332 m³ / 50 m³ per day | 27 d | Depth and bank-volume rate are provisional; excavation has 23 d float in this run. |
| Foundation | 44 items / 10 per day + 230 m³ / 8 m³ per day | 34 d | The 8 m³ is a **combined planning proxy**, not a concrete placement-only benchmark. Foundation geometry, forms, rebar, curing, and crew scope are unverified. |
| L1 structure | 83 items / 10 per day + 266 m / 18 m per day | 24 d | A single count/length rate conflates steel and glulam connection complexity. |
| Mechanical rough-in | L1 766 m / 27 m per day; L2 529 m / 27 m per day | 29 + 20 d | The 27 m/day value does not distinguish pipe, duct size, hangers, joints, or separate crews. Both levels are on the critical path. |
| Electrical and fire rough-in allowances | Each 1,236.5 m² / 56 m² per day | 23 d each | GFA proxy, no device/circuit/head counts; 15 d float each in Kelso. |
| Roof envelope allowance | 702.1 m² / 74 m² per day | 10 d | GFA-derived roof proxy, no roof assembly or weather-tight milestone; 47 d float. |
| Painting allowance | 1,236.5 m² / 167 m² per day | 8 d | GFA is not paintable wall/ceiling area; 18 d float. |
| Flooring allowance | 1,236.5 m² / 74 m² per day | 17 d | GFA may include unfloored areas and multiple floor systems; zero float. |

The [FHWA contract-time guide](https://www.fhwa.dot.gov/construction/contracts/t508015.cfm) recommends rates grounded in local completed-project records, with explicit crew and equipment assumptions, because production varies by size, location, and site conditions. Its highway rates cannot be imported into a building schedule. The [Construction Industry Institute benchmarking report](https://www.construction-institute.org/productivity-benchmarking-summary-report) specifically notes that foundation-concrete productivity differs substantially by foundation size. A [field study of a Cleveland mass-timber tower](https://easychair.org/publications/open/LWX1) reports 2,323 ft² of structure per crew-day; this is floor-area output from a different building and cannot validate Kelso's 10 members or 18 m per crew-day. A [primary MEP productivity study](https://doi.org/10.3390/buildings12050565) identifies coordination, space, materials and rework as material variables, without a transferable duct/pipe metre rate. The [US Census construction-duration series](https://www.census.gov/construction/c30/lengthtimeintro.html) gives 7.6 months for all private commercial projects completed in 2016–17; it is a broad historical comparison, not a Kelso target. These sources do **not** justify replacing any of the current numerical rates.

## Dependencies and sensitivity

The single `allowance:flooring` follows the **last** ceiling level; the single `allowance:painting` follows the **last** partition level. Therefore no floor-by-floor overlap is represented for these GFA allowances. The roof allowance follows the measured envelope roof, but neither painting, ceilings, nor flooring waits for it. The measured envelope work is split by level but is not a demonstrated weather-tight assembly. An actual [public building construction plan](https://www.sandiego.gov/sites/default/files/k-17-1424-db2-3_sunshine.pdf) describes finishing after substantial dry-in; [GSA guidance](https://www.gsa.gov/governmentwide-initiatives/federal-highperformance-buildings/highperformance-building-clearinghouse/workplace-strategies/project-guidance/space-reconfiguration-renovation-and-construction) also phases absorptive flooring and ceiling materials after wet finishes have dried. This is evidence to **review** a dry-in/finish gate, but roof-area proxy alone cannot prove dry-in. A new dependency on that proxy would give false assurance.

Sensitivity, all five Kelso allowances accepted, **hypothetical only** (each change in isolation, no claim that half-rates or two crews are typical):

| Changed assumption | Lean finish | Change from 2027-08-02 |
| --- | --- | ---: |
| Foundation concrete 8 → 4 m³/crew-day | 2027-09-10 | +28 working days |
| Structural count 10 → 5 items/crew-day | 2027-08-19 | +12 |
| Mechanical length 27 → 13.5 m/crew-day | 2027-10-08 | +48 |
| Flooring 74 → 37 m²/crew-day | 2027-08-26 | +17 |
| Mechanical rough-in 1 → 2 crews | 2027-07-13 | −15 |

The baseline is driven by **55 working days of assumed structure approval/fabrication**, 34 foundation, 24 L1 structure, 49 L1/L2 mechanical, and 17 flooring. Rate changes or extra crews must be tied to actual assemblies and subcontractor plans. A per-level allowance split would also require documented floor areas, material coverage, and an explicit same-crew or separate-crew policy; simply dividing the GFA proxy could manufacture overlap and an earlier finish. This review makes no production-rate or dependency code changes. Before treating the finish as a contractual forecast, obtain trade-confirmed quantities/rates and a dry-in milestone, then rerun the schedule.
