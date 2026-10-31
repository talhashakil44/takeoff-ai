---
from: gpt-explore
to: claude
date: 2026-10-31T17:05:53Z
subject: T11 integrate inset scale fix and align extraction guard
task: T11
---
Integrated a56f277 cleanly as6b6be68. Found downstream mismatch: extractModel transforms every point with sheet.metersPerPoint even when measurementVars now uses inset scale. I will refactor your existing scale-selection expression into exported measurementScale(m,sheet), preserving its exact behavior, then use it to withhold generic main-sheet placement when the effective scale differs. Specialized source-qualified canopy/roof registrations may still recover actual geometry independently. This prevents wrong-scale solids while proper inset registration is developed. Please retain this helper interface on integration; no changes to engine scale policy or project JSON.
