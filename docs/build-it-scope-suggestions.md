# Missing scope suggestions (T12)

Build It now routes `EW1`, `EW2`, `EW1A`, and other `EW*` wall types to the
envelope trade. Explicit exterior wall, cladding, and air barrier types also
route there. Their measured takeoff elements are unchanged; envelope work
follows structure on the same level. `MODEL_VERSION` 16 rebuilds models saved
under the previous trade routing.

`suggestScopeAllowances(model, setup)` returns reviewable suggestions for area
based trades with no measured element. For floor trades, it uses recovered
gross floor areas of normal levels as a **quantity proxy**, excluding Foundation
and Roof. For an unmeasured envelope, it uses a measured slab-on-grade footprint
as a **roof area proxy**, without inventing pitch, eaves or a solid. It uses
the trade's current `m²` or `SF` crew-day planning rate.
Both origins are explicit in `ScopeSuggestion`: `areaBasis: 'inferred'` and
`rateBasis: 'assumed'`. Rates are not documented trade commitments. Count and
site work cannot be inferred from floor area and are excluded.

The return type is:

```ts
interface ScopeSuggestion {
  key: string;
  allowance: ScopeAllowance; // quantity, unit, rate, provisional: true
  referenceAreaM2: number;    // gross floors or measured slab footprint
  areaBasis: 'inferred';
  rateBasis: 'assumed';
  why: string;
}
```

The function never edits `setup`, the project, or the plan. The Setup UI can
read `out.scopeSuggestions` (present after both build and replan), show each
suggestion, and accept it by copying `allowance` into
`edits.setup.allowances[key]`. It must omit a suggestion when that trade already
has a measured element or a saved allowance. If the required reference area is
missing, it returns no suggestion for that trade.

The refreshed 1,653 measurement Kelso demo has 1,236.51 m² recovered gross
floor area and a 702.065 m² measured slab-on-grade footprint. Its current
missing trade suggestions are envelope at 702.1 m² / 74 m² per crew-day,
electrical rough-in and
fire rough-in at 1,236.5 m² / 56 m² per crew-day, painting at 1,236.5 m² /
167 m² per crew-day, and flooring at 1,236.5 m² / 74 m² per crew-day. Each is
provisional and adds **zero** schedule time until accepted. Other scope gaps,
such as device counts, still need their own evidence.

The read-only audit on the refreshed demo is reported in the T12 handoff. It
does not include a suggestion until the user accepts it. The missing roof
takeoff remains a provisional schedule suggestion, not physical geometry.
