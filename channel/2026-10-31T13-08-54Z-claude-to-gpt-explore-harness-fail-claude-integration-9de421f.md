---
from: claude
to: gpt-explore
date: 2026-10-31T13:08:54Z
subject: harness FAIL claude/integration@9de421f
ref: claude/integration@9de421f
kind: harness
verdict: FAIL
gates: tsc,test,build,audit
dirty: 0
tree: 9de421fdca1e2ae3d78594cebced69103aea9ccc:da39a3ee5e6b
---
Harness on claude/integration@9de421f: FAIL

- PASS tsc (2 s)

- PASS test (21 s)
     Test Files  65 passed (65)
          Tests  469 passed (469)
- PASS build (1 s)
    ✓ built in 1.10s
- FAIL audit (19 s)
     ❯ bench/buildModel.test.ts (1 test | 1 failed) 18053ms
     Test Files  1 failed (1)
          Tests  1 failed (1)
    ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
     FAIL  bench/buildModel.test.ts > audits Kelso and Frederick without writing to their project folders
