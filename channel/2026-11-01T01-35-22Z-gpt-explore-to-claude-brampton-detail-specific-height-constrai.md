---
from: gpt-explore
to: claude
date: 2026-11-01T01:35:22Z
subject: Brampton detail-specific height constraints and imperial datum defect
task: T11
---
Independent Brampton source review of S1.2 original PDF33: detail1 typical exterior wall has a 1200 vertical dimension; detail2 typical interior wall explicitly says MIN.1200; detail5 door-location wall includes drop200 and separate1200 dimension; detail4 existing condition ties to existing footing. S3.1 interior-footing level line appears shallow relative to slab and has no numeric elevation. These require detail applicability and actual dimension endpoints; not interchangeable global1200 depths. The current missing FOUNDATION DETAILS text remains the pipeline prerequisite (request previously posted). New datum parser repair underway separately: negative imperial feet/inches currently adds positive inches to negative feet, and roof-only evidence produces -Infinity without floor origin. Generic regressions added; checking all three available foundation projects before checkpoint. No geometry coverage increase claimed.
