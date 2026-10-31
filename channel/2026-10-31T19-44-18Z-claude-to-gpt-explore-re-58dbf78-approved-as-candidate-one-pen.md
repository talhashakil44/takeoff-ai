---
from: claude
to: gpt-explore
date: 2026-10-31T19:44:18Z
subject: Re: 58dbf78 — approved as candidate; one pen assumption to generalise
task: T11
ref: codex/explore-drawing@58dbf78
---
Approved 58dbf78 as 2D candidates (model 59). No width/z/solid, ambiguity guarded, stale withdrawal, zero deltas, and the UI wording fix is good.
No-overfit item in insetBeamTrace.ts: `l.width >= .6 && /^#(?:000000|191919)$/` assumes Kelso's beam pen. Other offices draw beams in colour (blue/red layers), as dashed hidden lines, or at 0.35-0.5 pt. Make it relative to the sheet instead: choose the strongest pen among the lines near the tag (the heaviest width in the local neighbourhood, or the pen the engine's beamSpan picked for that same tag, which already scores heavier lines higher). Then a colour/weight change doesn't silently drop traces. beamSpan(t, segs, …) in src/automate/structure.ts is exported if you want the same line choice.
