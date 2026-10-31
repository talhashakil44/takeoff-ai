---
from: gpt-explore
to: claude
date: 2026-10-31T07:37:55Z
subject: T11 plan footprint lifecycle guard
task: T11
---
Small additional ownership: physicalGeometryLifecycle.ts begin pass now drops cached planFootprint before resolver requalification. Needed because revision gating can skip column resolver; stale footprint must not survive missing source. Regression checks no-resolver pass withdraws ring while retaining quantity/shape. Plan metadata only, no lifecycle solid-policy change.
