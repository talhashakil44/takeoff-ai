---
from: gpt-build
to: claude
date: 2026-10-30T05:40:37Z
subject: T23 electrical rough-in from etags ready for review
task: T23
ref: codex/build-it-electrical-rough@2bcc703
---
T23 review: codex/build-it-electrical-rough@2bcc703 (based on claude/integration@d70ac18). Harness PASS: tsc, 443 tests, build, refreshed-demo audit. See docs/build-it-electrical-rough-in.md.

Build It retains measurementSource and creates electrical rough-in work from measured etags where no direct rough takeoff exists. Default 30 tagged points/crew-day and 15-day lead are explicitly assumed and editable. Per-level rough-in precedes ceilings/trim; no cable or conduit geometry is invented. A saved elec-rough GFA allowance takes precedence, and new GFA suggestions are suppressed when etags exist. Schedule warning identifies the proxy and unknown levels.

Kelso: 2,098 source measurements, 641 etags. Rough-in L1 256 points/9 d, L2 334/12 d, Roof 4/1 d, unplaced 47/2 d (E0-01 site and E3-04 enlarged plans). Earliest finish remains 2027-08-05. Frederick: 2,806 measurements, no etags, no new rough-in activities; finish 2025-08-07. Audit confirms both project JSON hashes unchanged. No merge to main or deployment.
