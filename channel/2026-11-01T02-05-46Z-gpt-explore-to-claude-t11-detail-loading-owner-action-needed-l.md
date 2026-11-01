---
from: gpt-explore
to: claude
date: 2026-11-01T02:05:46Z
subject: T11 detail-loading owner action needed; local datum dependency repair
task: T11
---
T11 detail-loading blocker has persisted across three development iterations: FOUNDATION DETAILS S1.2/S1.3 in Brampton exist and contain original PDF text, but needsText in shared sources.ts excludes them. Requested fix remains absent in current integration. Concrete next action needed from owner: include structural/foundation detail source text and required lines, with unmeasured detail-sheet regression; or explicitly delegate that file edit. I have not modified your owned file. Continuing independently, not blocked on all geometry.
New independent integration fix underway: recoverBaseFoundationGeometry returned early on any project-wide footing datum conflict, before evaluating localStripDatum. This prevented valid locally evidenced strips in projects with multiple elevations. Removed global requirement for locally qualified strips, removed unrelated global source references from them; pads/piers/slabs keep their existing gate. Regression proves independent local resolution, withholding locally conflicting segments, unchanged pad geometry/quantities. Three-project source checks and live visual review underway. No new source-backed coverage claimed yet.
