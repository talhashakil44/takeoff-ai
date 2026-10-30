# Dry-in gate and per-level scope allowances (T21)

Build setup now has `dryInBeforeFinishes`, an assumed `true` toggle. When both exterior wall work and roof-covering evidence exist, the plan adds `ms:dry-in` after the envelope's measured and accepted allowance activities. Partitions, ceilings, doors, painting, flooring, finishes and specialties wait for that milestone. It is an **assumed sequencing gate**, not a claim that an assembly has been inspected or is weather-tight. If roof or wall evidence is absent, no dry-in milestone is invented; the schedule warns `dry-in-evidence-missing`. Setting the toggle to `false` removes the gate.

Accepted gross-floor-area suggestions now carry `distribution: 'gfa-by-level'`. Their total quantity is apportioned by each level's recovered floor area, producing separate `allowance:<trade>:<level>` activities. One crew stays level by level unless `levelsInParallel` is enabled. Dependencies use matching measured and allowance work on each level, so an L1 finish can proceed while L2 rough-in runs. The roof-envelope proxy stays one roof package. Hand-entered allowances without the distribution marker remain one package; a previously accepted provisional GFA proxy whose quantity matches the recovered total also splits. No takeoff element or source quantity is changed.

Read-only refreshed demos, with **all** scope suggestions accepted in memory:

| Scenario | Prior single-package allowances | Per-level allowances, dry-in off | Per-level allowances, dry-in on |
| --- | --- | --- | --- |
| Kelso, start 2026-11-02 | 2027-08-02 | **2027-07-23** | **2027-07-23** |
| 84 Frederick, documented start | 2025-10-02 | **2025-08-07** | **2025-08-07** (roof/wall evidence incomplete; warning) |

The equal Kelso dates with the toggle on and off are specific to this run: the dry-in branch becomes part of the driving chain, while the mechanical commissioning branch has the same finish. The gate is present and has dependencies on Kelso's four measured envelope packages and accepted 702.1 m² roof allowance. The 1,236.5 m² Kelso GFA proxy splits across L1 (647.8 m²) and L2 (588.7 m²); floor and crew dependencies remain explicit. Frederick's accepted GFA proxies split across its four recovered levels. These are planning proxies until the trade scope, rates, and actual dry-in date are confirmed.

`MODEL_VERSION` 18 invalidates saved Build output whose setup lacks the toggle and distribution contract. The read-only audit retains all 1,653 Kelso and 2,806 Frederick measurements. Unit tests cover level quantities, same-crew links, matched trade prerequisites, missing-envelope warning and toggle-off behavior.
