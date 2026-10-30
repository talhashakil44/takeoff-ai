# Build It refreshed demo audit (T5)

Audited `claude/integration@dda7607` against Claude's refreshed, local
`.agents-data` demos on 2026-10-30. The read-only integration audit passed.
It checked that each project JSON was byte-identical afterward and that every
measurement became a takeoff element. These are schedule calculations from the
currently measured and entered scope, not a complete construction estimate.

| Project | Start | Measured / modeled | Schedule milestone | Earliest date | Driving working days |
| --- | --- | ---: | --- | --- | ---: |
| Kelso | 2026-11-02 (audit assumption) | 1,526 / 1,526 | Project complete | 2027-07-07 | 178 |
| 84 Frederick | 2025-02-24 (specified) | 2,806 / 2,806 | Substantial performance | 2025-08-07 | 119 |

## Kelso driving chain

All production rates below are **assumed defaults**. Quantities come from the
refreshed takeoff; the resulting durations are inferred, not documented trade
commitments. One crew per trade and Monday–Friday working are also assumptions.

| Activity | Working days | Quantity and basis |
| --- | ---: | --- |
| Structure submittal preparation | 10 | Assumed; no linked spec section |
| Consultant review | 10 | Assumed; no review period found |
| Resubmission and re-review | 15 | Assumed one round: 5 preparation + 10 review |
| Structure fabrication and delivery | 20 | Assumed lead after approval |
| Foundation structure | 34 | 44 ea at 10 ea/crew-day **plus** 230.26 m³ at 8 m³/crew-day; ceiling of 33.18 crew-days |
| Structure, Level 1 | 24 | 83 ea at 10 ea/crew-day **plus** 265.70 m at 18 m/crew-day; ceiling of 23.06 crew-days |
| Partitions, Level 1 | 20 | 417.23 m at 21 m/crew-day |
| Partitions, Level 2 | 13 | 258.47 m at 21 m/crew-day |
| Partitions, Roof | 5 | 84.67 m at 21 m/crew-day |
| Mechanical trim, Roof and unplaced | 1 + 1 | 3 ea and 8 ea, each at 10 ea/crew-day |
| Mechanical commissioning | 10 | Assumed |
| Closeout | 15 | Assumed |

The chain has no documented duration. The calculated substantial performance
is 2027-06-17, followed by closeout through 2027-07-07. The date is 9 working
days later than Claude's T4 quick audit of 2027-06-24; the current
`claude/integration` includes T7's beam length quantities, adding a 265.70 m
linear component to Level 1 structure.

### Parallel work and limits

- The 1,165.67 m of Div 22/23 pipe is included in mechanical rough-in: 73.32 m
  at Foundation (3 days) and 1,092.35 m unplaced (41 days), both at the assumed
  27 m/crew-day. Rough-in has 17 working days of float and is not the driving
  chain. `unplaced` describes missing level placement, not omitted quantity.
- Excavation is 1,332.17 m³ at the assumed 50 m³/crew-day: 27 working days
  after mobilization, before foundations, with 23 days of float. Other site
  work is 5,849.70 m² and 340 m at 139 m² and 46 m per crew-day respectively;
  its 50 days have 75 days of float.
- The model flags `structure-production-review` and
  `excavation-production-review`. Rates and sequencing need trade review.
  There is no evidence in the current demo for a different production rate,
  so this audit does not replace either default.
- `setup.allowances` is empty. Missing or untaken scopes add no duration until
  a user enters a quantity and rate. The 2027-07-07 result must not be read as
  evidence that the entire Kelso project fits in eight months. Current modeled
  work has no electrical rough-in, fire rough-in, flooring, painting, envelope
  or full site grading/paving schedule activities.

## Frederick driving chain

Frederick's specified start is 2025-02-24. The chain is doors submittal
preparation (10 assumed days), consultant review (10 assumed), one resubmission
(15 assumed), fabrication and delivery (40 assumed), then door work on Level 0
(19 ea / 6 ea per day = 4 days), Level 1 (68 ea = 12 days), Level 2 (53 ea = 9
days), Level 3 (97 ea = 17 days), and unplaced (12 ea = 2 days). The five
installation rates are assumed defaults, one crew. Substantial performance
remains 2025-08-07. Its phase scope is still unmapped, and the audit flags the
historical start.

## Reproduction

```sh
BUILD_PROJECTS_ROOT=/Users/talhashakeel/dev/takeoff-ai/.agents-data \
  npx vitest run -c bench/vitest.config.ts bench/buildModel.test.ts
```

Input SHA-256: Kelso
`268e7d5262186d9aef1197747978a66ab64a96af856a05a61a26819d46fe6cc6`;
Frederick `2f626973cbfba3d547a1793ab637e69e9b20a1a6e5abc9f9420ed66b5e699c86`.
The ignored `diag/build-acceptance/` directory contains the complete activity
schedule, critical chains, issues, and IFC output from this audit.
