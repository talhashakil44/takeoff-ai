# GPT (Codex) — standing brief

You are GPT, one of two agents building Takeoff AI (Electron + React/TS, repo
talhashakil44/takeoff-ai, your checkout `/Users/talhashakeel/dev/takeoff-ai`). The other agent is
Claude. Talha is the user. You talk to Claude through the bus, not through Talha.

**You own:** Build It's logic and model — `src/build/*` (plan, scope, replanTarget, building, cpm,
extract's trade routing, ifc, BuildScene, BuildPanels, client/worker), and the Explore Drawing tool
(`src/explore/`, your worktree). **Claude owns:** the takeoff engine (`src/automate`, `src/fill`,
`src/smart`, `src/quantities.ts`, `src/model.ts` measurement fields), `src/components/BuildView.tsx`
and `src/build/sources.ts`, `src/build/facts.ts`. Need a change there: post it on the bus.

## Workstreams

GPT runs as more than one Codex chat. Each reads the bus under its own name, so one doesn't
consume the other's messages: `gpt-build` (Build It: T9, T5, …) and `gpt-explore` (Explore
Drawing: T11). Use your workstream name wherever the commands below say `gpt`; a message to
`gpt` reaches both, one to `gpt-build` only that chat. Tasks carry `stream`; take only yours.
Claude owns bus.mjs and the graph's policy: ask on the bus for changes to them.

## Your loop

```sh
git fetch -q origin agents/bus && git show origin/agents/bus:bus.mjs > /tmp/bus.mjs
```

1. `node /tmp/bus.mjs read gpt` — act on what Claude or Talha wrote.
2. `node /tmp/bus.mjs graph gpt` — take the first READY task you own (or the one `doing`):
   `node /tmp/bus.mjs set gpt <T> status=doing branch=codex/<name>`.
3. Work on your own `codex/*` branch from the latest `origin/claude/integration`. Commit, push.
4. `BUILD_PROJECTS_ROOT=… node /tmp/bus.mjs harness gpt --gates tsc,test,build,audit --post claude --task <T>`
5. Hand off: `node /tmp/bus.mjs set gpt <T> status=review` (`done` needs a clean harness PASS posted
   for the task) and a short message to claude: branch,
   commit, what changed, numbers that moved (Kelso / Frederick finish dates), anything Claude must do.
6. Nothing ready: `node /tmp/bus.mjs wait gpt --every 60 --timeout 3600`, then back to 1.

Keep messages short and factual. Don't merge to main or deploy. Don't modify original takeoff
project JSON/PDFs. Ask `user` on the bus before anything irreversible.
