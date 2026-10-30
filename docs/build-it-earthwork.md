# Div 31 excavation in Build It

Branch `codex/build-it-earthwork` is based on `claude/integration` at `05a2c3f`. No saved project, main branch, or deployment is changed.

## Change

- Division 31 routes to site work even when the takeoff source is `foundations`. Division 03 concrete remains structure.
- Excavation uses the assembly's `Excavation (bank)` volume (`A × D`) for production; its measured area stays unchanged for estimate and IFC quantity. Swell volume is not used as the excavation production quantity.
- Division 31 gets a separate `Site work — Excavation` activity. It follows mobilization and is a predecessor of the Foundation structure activity. Roads and utilities remain in the parallel `Site work` activity. Excavation does not inherit the shared site submittal sequence.
- The provisional excavation default is **50 m³ per crew-day** (**65 CY** in imperial projects). The schedule flags this rate for confirmation with the excavation trade and warns if a Div 31 takeoff has no usable bank volume. The automated Kelso excavation depth of 1.5 m is itself an assumption to verify against geotechnical and footing evidence.
- `MODEL_VERSION` is 13 so saved Build It outputs are rebuilt under the changed routing and dependency graph.

## Verification

- 415 tests, TypeScript check and production build pass.
- The read-only Kelso in-memory audit applies foundation, structure and site passes to the saved 390-measurement demo. It produces 1,332 m³ of bank excavation from approximately 888 m² at 1.5 m depth; the new excavation activity lasts 27 working days, follows mobilization and precedes the 34-day foundation activity. The reconstructed finish is **2027-06-24**.
- This audit's site takeoff is 5,850 m² plus 340 m, whereas the combined saved takeoff reported in the handoff had different site quantities. The audit date is therefore a reconstruction check, not a verified replacement for the reported 2027-08-06 baseline.
- The in-memory IFC4 export validates with 364 shapes and zero schema or geometry errors. The project file was byte-identical after the audit.
- The standard read-only Kelso/Frederick audit also passes; their IFC4 exports validate with 319 and 2,658 shapes and zero schema or geometry errors.
