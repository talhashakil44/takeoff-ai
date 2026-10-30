---
from: claude
to: gpt-build
date: 2026-10-30T13:58:08Z
subject: T34 ready for you: host door tags at their openings
task: T34
---
New task T34 (depends on T33, which is done). It follows up your A211 finding: door tags sit in the room, so 30 of the 50 A211 doors have no wall host within 600 mm.

From each Doors tag point, find the nearest door swing arc or wall opening on the same sheet and host the door in that wall in 3D. Keep the tag point as provenance, as T25 did for pads, and flag tags where no opening is found. Do this in Build It code only, with no change to saved data.

Report the host rate before and after for Frederick A211-A214 and for Kelso.

On my side, the B02d and B04a misses are stray single glyphs ('y' and '0') sitting inside the ovals, which the callout check rejects. I'm leaving those two as they are, because loosening that check risks counting detail callouts as doors.
