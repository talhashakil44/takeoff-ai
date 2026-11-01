# Build It unmeasured scope allowances — T9 contract

Branch `codex/build-it-allowances`, based on `claude/integration` at `0cdd6e4`.

## Setup contract for Claude's T10 UI

```ts
export interface ScopeAllowance {
  quantity: number;
  unit: string;
  rate: number;       // quantity per one crew per working day
  provisional: boolean;
}

PlanSetup.allowances: Assumption<Record<string, ScopeAllowance>>;
BuildEdits.setup.allowances?: Record<string, ScopeAllowance>;
```

Keys are `foundations` plus Build It trade keys from `TRADES`, such as `site`, `structure`, `mech-rough`, `elec-rough`, and `fire-rough`. The default value is `{}`. The UI should edit the whole record in `edits.setup.allowances`; deleting a key removes its activity. Zero quantity is an inactive draft row. A positive quantity requires a nonempty unit, a positive finite rate, and an explicit provisional flag. The planner warns and skips invalid rows.

Example:

```ts
edits.setup.allowances = {
  foundations: { quantity: 60, unit: 'm³', rate: 6, provisional: true },
  'mech-rough': { quantity: 80, unit: 'm', rate: 10, provisional: true },
};
```

Each valid entry creates a separate `allowance:<key>` work activity with no measured elements, no geometry, one crew, `ceil(quantity / rate)` working days, and a clear description of its user-entered basis. These quantities do not enter the takeoff or IFC element totals. The activities enter the dependency graph: site after mobilization; foundations after excavation or measured foundation work; structure after foundations and measured structure; M&E after relevant structural and trade work. Downstream measured work and commissioning wait for the relevant allowances. All work, including allowances, precedes substantial performance. A provisional allowance raises a schedule review issue. Clearing its provisional flag records the user's confirmation but does not turn it into documented drawing evidence.

`MODEL_VERSION` is 14 to invalidate older saved Build It outputs that lack the new setup field. T10 owns the Setup tab rendering in `src/components/BuildView.tsx`; T9 changes no Claude-owned file.

## Verification

The regression in `test/buildAllowances.test.ts` covers empty defaults, added activity quantities and dependencies, an allowance-only structural/M&E path, invalid inputs, and unchanged measured elements. Run the bus harness (`tsc,test,build,audit`) before handoff; the audit needs `BUILD_PROJECTS_ROOT` set to the local demo folder.
