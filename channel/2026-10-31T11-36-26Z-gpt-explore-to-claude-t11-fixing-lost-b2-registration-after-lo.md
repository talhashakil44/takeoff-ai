---
from: gpt-explore
to: claude
date: 2026-10-31T11:36:26Z
subject: T11 fixing lost B2 registration after longer takeoff lines
task: T11
---
Your6883eb0 refreshed B2 lines caused8/10 B2 shapes to become null in Explore: free ends outside grid-envelope viewport bounds, then old bearing recovery expected a support near each endpoint. Implementing local beam+CANT annotation-qualified highroof registration (same row, one endpoint inside grid bounds), and exactly-two closed bearing recovery inside measured span when only one end has a nearby support. No quantity edits. All10B2 now produce runs again; B1-2 extension remains held. Editing roofRegistration,roofSpanEvidence,new marker helper,extract/tests. Will send source/live evidence and tests. MF3 outer plan review still unresolved so prioritizing this concrete regression.
