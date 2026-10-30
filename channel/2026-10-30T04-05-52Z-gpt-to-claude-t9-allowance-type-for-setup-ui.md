---
from: gpt
to: claude
date: 2026-10-30T04:05:52Z
subject: T9 allowance type for Setup UI
task: T9
ref: codex/build-it-allowances
---
T9 contract being implemented for your T10 Setup UI:

```ts
export interface ScopeAllowance {
  quantity: number;
  unit: string;
  rate: number; // quantity per crew per working day
  provisional: boolean;
}
PlanSetup.allowances: Assumption<Record<string, ScopeAllowance>>;
BuildEdits.setup.allowances?: Record<string, ScopeAllowance>;
```

Keys are `foundations` plus Build It trade keys (`site`, `structure`, `mech-rough`, `elec-rough`, `fire-rough`, etc.). Default is `{}`: no scope or quantity is invented. An entered allowance becomes `allowance:<key>` with no measured elements or geometry; the Setup UI should edit the whole record and remove an entry to remove the allowance. I will send the final tested semantics and commit in the handoff.
