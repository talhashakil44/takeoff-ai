# Takeoff AI agents: Prompts → Agents → Harness → Graphs → Loops

Two coding agents build Takeoff AI side by side, and Talha (`user`) steers. This branch,
`agents/bus`, is how they work together without him relaying pastes. It holds no app code and is
never merged.

| Layer | What it is here | Where |
|---|---|---|
| **Prompts** | Each agent's standing brief (role, what it owns, the rules) and each task's prompt | `prompts/*.md`, `graph.json` → `tasks[].prompt` |
| **Agents** | **Claude** (Claude Code, cloud): the takeoff engine (`src/automate`, `src/fill`, `src/smart`, quantities) and the Build screen (`BuildView`). **GPT** (Codex, Talha's Mac): Build It's logic and 3D (`src/build/*` except `BuildView`), the Explore Drawing tool | `prompts/claude.md`, `prompts/gpt.md` |
| **Harness** | The gates every hand-off passes: typecheck, tests, build, and on the Mac the Kelso / 84 Frederick audits | `node bus.mjs harness <me> --gates tsc,test,build[,audit]` |
| **Graphs** | The task graph: who owns what, what waits on what, status, branch | `graph.json`, `node bus.mjs graph <me>` |
| **Loops** | Each agent's loop: read the bus → take the next ready task → work on its own branch → harness → post the result → wait for the bus | `node bus.mjs wait <me>` |

## The channel

Messages are files in `channel/`, one per message, written by `bus.mjs` straight to this branch
with git's plumbing: it never checks anything out, so it is safe mid-work on any branch.

```sh
# get the tool (any checkout of the repo)
git fetch -q origin agents/bus && git show origin/agents/bus:bus.mjs > /tmp/bus.mjs

node /tmp/bus.mjs read gpt                          # new messages to gpt
node /tmp/bus.mjs graph gpt                         # the graph, and what is ready for gpt
node /tmp/bus.mjs set gpt T5 status=doing branch=codex/kelso-recompute
echo "Pushed 1a2b3c. Excavation now ahead of foundations." | node /tmp/bus.mjs say gpt claude "T3 ready for review" --task T3 --ref codex/build-it-earthwork@4fbd6a6
node /tmp/bus.mjs harness gpt --gates tsc,test,build,audit --post claude --task T3
node /tmp/bus.mjs wait gpt --every 60 --timeout 3600   # blocks until claude (or Talha) writes
```

`to` is `claude`, `gpt`, `user` or `all`. Talha can write too (`me` = `user`), or read the whole
thread on GitHub: the `channel/` folder of the `agents/bus` branch.

## Rules both agents keep

- Work on your own branch (`claude/*`, `codex/*`). Never merge to `main` or deploy unless Talha
  says so on the bus or in chat. Integration happens on `claude/integration`, merged by Claude
  after the harness passes.
- Only edit files you own (prompts say which). Need a change in the other's files: post a
  message with the exact change; don't make it.
- Takeoff data is sacred: add, never lose. Never modify an original takeoff project's JSON or PDFs.
- A task is `done` only after its accept gates pass; post the harness result with the hand-off.
- Anything that can't be undone, touches Talha's data or money, or changes scope: ask `user`
  and wait.
