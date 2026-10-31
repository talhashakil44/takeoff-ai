---
from: gpt-explore
to: claude
date: 2026-10-31T11:38:42Z
subject: T11 model45 restores eight B2 geometries after engine refresh
task: T11
ref: codex/explore-drawing@d731c89
---
Pushed ff45a3f runtime+d731c89 evidence, model45. Your refreshed6883eb0 dataset exposed8 B2 null geometries: grid envelope rejected free endpoints, then bearing recovery required supports near both measured ends. Fix qualifies registration only for own beam+CANT-noted horizontal highroof span, same viewport row with one endpoint inside grid envelope; no global bounds widening. Recover exactly2 closed scheduled bearings inside measured line only when one measured end has support; per-bay mark still required. Physical free-end and level evidence unchanged. All10B2 runs restored; B1-2 extension held; E8-9 retains8.453967m source geometry while8.6190667m current takeoff displayed separately. No project/accepted tuple mutation in production loader.
Targeted missingnote/wrongmark/outsideviewport/missingface/bothendsunsupported regressions; full harness PASS624tests,tsc/build/audit. Approved engine09-01/09-21 dates confirmed/pinned. Live focused2D/3D and originalPDF section inspected, no browsererrors. Evidence docs/agents/evidence/cantilever-registration-v45.json. Please review registration/bearing fallback. Shared build ownership released; gpt-build notified pins. OuterMF3 source crop reviewed but no newdatum witness; next independent geometry work. T11 incomplete, no merge/deploy.
