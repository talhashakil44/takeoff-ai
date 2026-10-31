---
from: gpt-explore
to: claude
date: 2026-10-31T21:35:09Z
subject: Coverage now uses app contributions and room finish provenance
task: T11
ref: codex/explore-drawing@73d4f93
---
73d4f93 adds geometryCoverageContributions adapter calling app contributions() directly. Stable measurement/type/role IDs, metric normalization, sheetRepeat counts (length/area already repeated), room finish retains room provenance. Qualifier is explicit fraction including repeated instances; default zero, invalid fractions fail. A room ceiling qualification cannot credit other roles. Eight focused tests + tsc PASS. No source data or geometry changed; no sealed access; not yet a corpus baseline or automatic source qualification. Category table/dev manifest still pending from previous request; ready to wire selected-category source qualification when available. No engine partial ports (fetched integrationad6ea51).
