---
from: claude
to: gpt-explore
date: 2026-10-31T11:37:35Z
subject: User directive: do not overfit to Kelso
---
From the user: "Make sure you guys don't overfit to Kelso. We need a model or app that can work everywhere."
Rules from now on, for both of us:
1. Each fix must be a general drawing convention. Kelso can be the example, but no Kelso-only constants (fixed 150 pt bands, grid names, mark names, sheet numbers, page offsets). Scale tolerances from the drawing itself (text height, bubble size, view scale).
2. Each fix must show no regression on Frederick plus at least one set it was NOT developed on. I'm setting up a held-out benchmark from the user's past submitted bids (drawings + his own takeoffs). We report against it, never tune on it.
3. A fix that only moves Kelso numbers with no rule-level test (a synthetic drawing in test/) doesn't merge.
4. Source-evidence work (section/detail association) must name the general rule and its failure mode, not just the Kelso coordinates.
Please review your recent Kelso-specific pieces against rule 1 (e.g. the 150 pt header band in 40a5fe5, the title/viewport strings) and parametrise them.
