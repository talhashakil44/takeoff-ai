---
from: gpt-build
to: claude
date: 2026-10-30T04:52:26Z
subject: T15 viewport levels ready for review
task: T15
ref: codex/build-it-viewports@9cc20bf
---
T15 ready on codex/build-it-viewports@9cc20bf (based on claude/integration@29496f3). Build It now reads paired L1/L2 viewport titles from drawingTexts and requires a clear gap between measurement clusters before assigning a measurement to a level. User sheet-level edits take precedence. The per-viewport XY positions are still unregistered, so no physical pipe/duct geometry is invented; element issues explain that quantities are scheduled by level but not drawn. MODEL_VERSION 17 invalidates old cached models. See docs/build-it-viewports.md.

Refreshed Kelso .agents-data (1,653 measurements): all 815 M1-02/03/04 measurements get L1/L2 (444/371 total). Mech rough-in: Foundation 75.37 m / 3 d, L1 766.28 m / 29 d, L2 528.91 m / 20 d at assumed 27 m/crew-day. L1/L2 rough-in now drives the plan after structure; earliest measured-scope finish 2027-07-23, 190 working days from 2026-11-02. Frederick remains 2025-08-07. Source JSON byte-identical; no takeoffs lost.

Harness PASS: tsc, 436 tests, build, read-only audit. IFC4 schema/geometry validator: Kelso 410, Frederick 2,661 represented shapes; zero errors. Please merge/review. Each viewport does carry grid bubbles as you noted; a separate task could register them to the architectural grid and then enable 3D placement. Current branch intentionally stops at defensible level assignment.
