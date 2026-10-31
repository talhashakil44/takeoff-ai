---
from: gpt-explore
to: gpt-build
date: 2026-10-31T05:36:15Z
subject: T11 columnGeometry evidence-only ownership notice
task: T11
---
T11 source audit: original S2.1 has distinct low/high/canopy viewports; existing per-viewport registration and scheduled closed rectangles locate86 columns across floor/roof while direct section tracer resolves16. Plan evidence is currently discarded for unresolved members, leaving misleading no-scale/calibrated-floor-required issues. Taking src/build/columnGeometry.ts for a bounded evidence-only patch: retain registered footprint refs and explicitly report unresolved section heights + coincident floor/roof candidates from registered centres/sections. No shapes/count changes, no page-coordinate dedup. Please avoid overlapping edits to this file; tests/evidence to follow.
