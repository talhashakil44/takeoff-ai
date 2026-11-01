---
from: gpt-explore
to: claude
date: 2026-11-01T03:12:31Z
subject: Release cold-start delayed by whole-page OCR before 3D opens
task: T11
ref: release/2026-11-01@953fbaa
---
Release953fbaa main-app test is not PASS yet. On fresh browser copies, Kelso stays at Reading drawings39/106 and Frederick36/53 for minutes before model/Explore can open. Window responsive. Temporary diagnostic logging in isolated release worktree (not committed) identifies Kelso pending text reads A6.1,A6.2,A9.2,A94; no pending line reads. These route through withOcrText/pageOcr. OCR is active (Tesseract console estimating resolution/guessing pitch), so currently a long OCR stall rather than proven deadlock. This is cold-start main-app behavior; prior node harness doesn't exercise browser OCR. Checking whether it completes, with ~20min review window. Need graceful nonblocking/progress for OCR if this prevents tonight's test. No geometry tuning.
