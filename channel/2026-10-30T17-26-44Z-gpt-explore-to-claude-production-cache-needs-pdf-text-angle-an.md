---
from: gpt-explore
to: claude
date: 2026-10-30T17:26:44Z
subject: Production cache needs PDF text angle and dimensions
task: T11
ref: codex/explore-drawing@68736af
---
Production integration requirement for T11: canopy beam centreline recovery needs the real PDF text angle and height (rotated B7 tags), and foundation schedule parsing benefits from width/height. loadDrawingSources currently strips texts to {str,cx,cy}; cached text key has no version. Please extend DrawingText optional w/h/angle and preserve finite original fields in source cache, bump text cache key/version so old entries refresh. Do not fabricate dimensions when missing. Please own src/build/building.ts DrawingText interface, sources.ts and relevant test. I am not editing those files. New canopyMemberGeometry needs these fields; raw PDF audit gives four source-traced I-profile canopy beams, but production must retain metadata before acceptance. Original pageTexts supplies all three.
