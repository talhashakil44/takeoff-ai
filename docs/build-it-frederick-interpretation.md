# Frederick Build It interpretation after takeoff QA (T30)

Read-only comparison on 30 October 2026 against the same refreshed demo project JSON, SHA-256 `97cc7e2265b96d04dea018e591f4d079b25769e6dc2d27d2d48c03fa537419c2` (2,805 measurements after T31 removed one overlapping M102 pipe). The baseline is `claude/integration@81c8d76`; the comparison holds the source project, PDFs, start and setup fixed. The original saved takeoff remains untouched.

| Work trade and unit | Baseline | T30 | Change |
| --- | ---: | ---: | ---: |
| Ceilings, m² | 2,082.6 | 352.0 | −1,730.6 |
| Other finishes, m² | 425.6 | 253.2 | −172.5 |
| Demolition, m | 1,046.4 | 844.5 | −201.8 |
| Doors/windows, ea | 249 | 198 | −51 |
| Mechanical trim, ea | 133 | 105 | −28 |

Frederick's earliest finish moves from **2025-08-07** to **2025-07-25**. This is a schedule response to changed planning quantities, not a validated completion forecast. The project has a historical start and unresolved scope findings. Kelso remains **2027-08-25** with its inferred roof-covering area.

The model retains all 2,805 source measurements. It records why an item is excluded, keeps a sheet/point source reference, and emits grouped schedule issues with measurement IDs for review. The work activities omit 157 generic room polygons, 51 elevation window marks, 71 A011 egress-diagram demolition traces, 86 unverified `Demo 0` marks, two open/corrupt ceiling areas, and 19 coincident M104/M305 roof marks. The 86 `Demo 0` marks may represent real numbered removals; their labels need reconstruction before they can be scheduled. Rooms remain spatial floor-area context, with no ceiling or floor-finish scope inferred. Elevation windows remain unlevelled review evidence, not extra plan openings.

T31 found that the saved A201–A204 keynote labels were shifted by one line in places. Build It now flags all **334** note-numbered demolition markers on those sheets for review. The 86 `Demo 0` markers stay excluded; the other 248 retain their measured work quantity only as provisional demolition scope. Their specific removal type, unit and production basis cannot be trusted until the saved markers are reconciled to the corrected notes. Future engine runs with corrected types need a fresh audit.

M305's roof-plan marks are the retained copy of the 19 coincident pairs. Multiple matching positions establish that M104's generic equipment marks are in a roof-plan view despite its stored sheet title; its six unmatched marks are therefore levelled to Roof, with an explicit inference note. Nine generic equipment marks near an X-coded tag and an “as exist” note (five M201, four M203) are marked existing rather than new. Their service and exact identity still require drawing/legend review.

Reproduce the comparison with `BUILD_PROJECTS_ROOT=/Users/talhashakeel/dev/takeoff-ai/.agents-data` and the bus `tsc,test,build,audit` harness. The audit writes only ignored diagnostics under `diag/build-acceptance/`, and verifies that the project JSON bytes remain unchanged.
