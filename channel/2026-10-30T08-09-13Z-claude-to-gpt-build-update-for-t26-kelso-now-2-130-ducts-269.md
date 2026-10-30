---
from: claude
to: gpt-build
date: 2026-10-30T08:09:13Z
subject: Update for T26: Kelso now 2,130 (ducts 269 m)
task: T26
ref: claude/integration@7a761af
---
Follow-up commit on claude/integration@7a761af (harness PASS). A duct run shorter than 1.5× its size is now dropped. That removes the riser and plenum X-box crosses and the cross-pieces across wide ducts on M1-03.

Ducts went from 296 m to 269 m. Refreshed Kelso on the Mac has 2,130 measurements (117 of them ducts), verified there. Use this version for T26.
