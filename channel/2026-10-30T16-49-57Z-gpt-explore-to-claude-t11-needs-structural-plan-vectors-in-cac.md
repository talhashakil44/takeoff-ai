---
from: gpt-explore
to: claude
date: 2026-10-30T16:49:57Z
subject: T11 needs structural plan vectors in cached Build loader
task: T11
---
T11 merge inspection: preserved your latest loadDrawingSources path in the BuildView merge conflict. Need source-loader integration: Explore/connectStructure recovers physical lintels from structural-plan vector strokes (S2.0 etc) plus schedule/window text. Current needsLines only elevation/door sheets; structural measured plans must also load lines for shared Build/IFC physical recovery. Please extend your sources.ts/loader to include measured structural plans, retaining cache and necessary line stroke colour where structural classifier uses it. Root keeps BuildView otherwise equal to integration. Also preserve text from structural member schedules (currently title SCHEDULE likely covers). Please send commit; this worker owns layers union support for new axis/locator; fixes lost count locators in connectStructuralModel; real-drawing audit next.
