// Runs a coding agent the user already pays for (Claude Code on a Claude plan, Codex on a
// ChatGPT plan) to build the open project's 3D model. The agent reaches the app only through
// its MCP server (the same tools Claude Desktop gets), in an empty working folder, with every
// built-in tool that could touch the computer turned off. Its progress streams to the window.
const { app, ipcMain } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AGENTS = {
  claude: { label: 'Claude Code', plan: 'Claude Pro or Max', install: 'curl -fsSL https://claude.ai/install.sh | bash' },
  codex: { label: 'Codex', plan: 'ChatGPT Plus or Pro', install: 'npm install -g @openai/codex' },
};

let running = null; // { child, agent, sender, stopped }
let shellPath = null;

/** The PATH a terminal would have (apps opened from the Dock get a bare one). */
function loginPath() {
  if (shellPath !== null) return Promise.resolve(shellPath);
  if (process.platform === 'win32') return Promise.resolve((shellPath = process.env.PATH || ''));
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return new Promise((resolve) => {
    execFile(shell, ['-lic', 'echo __PATH__$PATH__PATH__'], { timeout: 6000, env: { ...process.env, TERM: 'dumb' } }, (_err, out) => {
      const m = /__PATH__(.*?)__PATH__/.exec(String(out || ''));
      shellPath = m ? m[1] : '';
      resolve(shellPath);
    });
  });
}

async function searchPath() {
  const home = os.homedir();
  const extra = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.codex', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  // Node version managers keep a bin folder per version.
  for (const root of [path.join(home, '.nvm', 'versions', 'node'), path.join(home, '.fnm', 'node-versions')]) {
    const versions = await fs.readdir(root).catch(() => []);
    for (const v of versions.sort().reverse()) extra.push(path.join(root, v, 'bin'), path.join(root, v, 'installation', 'bin'));
  }
  if (process.platform === 'win32') extra.push(path.join(process.env.APPDATA || '', 'npm'));
  const dirs = [...(await loginPath()).split(path.delimiter), ...(process.env.PATH || '').split(path.delimiter), ...extra].filter(Boolean);
  return [...new Set(dirs)];
}

async function which(name, dirs) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const d of dirs)
    for (const ext of exts) {
      const f = path.join(d, name + ext);
      try {
        await fs.access(f, fsSync.constants.X_OK);
        return f;
      } catch {
        // next
      }
    }
  return null;
}

/** Which agents are installed, and where. */
async function detect() {
  const dirs = await searchPath();
  const out = {};
  for (const key of Object.keys(AGENTS)) {
    const bin = await which(key, dirs);
    out[key] = { ...AGENTS[key], installed: !!bin, path: bin };
  }
  return out;
}

/** One line of the agent's output, said for the estimator: a tool it called, or what it wrote. */
function summarise(agent, line) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return line.trim() ? [{ kind: 'text', text: line.trim().slice(0, 400) }] : [];
  }
  const tool = (name) => String(name || '').replace(/^mcp__takeoff__/, '').replace(/^takeoff[.:/]/, '');
  const out = [];
  if (agent === 'claude') {
    if (ev.type === 'assistant')
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'text' && c.text?.trim()) out.push({ kind: 'text', text: c.text.trim() });
        if (c.type === 'tool_use') out.push({ kind: 'tool', text: tool(c.name), detail: c.name === 'mcp__takeoff__add_3d_elements' ? `${c.input?.elements?.length ?? 0} elements` : '' });
      }
    if (ev.type === 'user')
      for (const c of ev.message?.content ?? [])
        if (c.type === 'tool_result' && c.is_error) out.push({ kind: 'error', text: (Array.isArray(c.content) ? c.content.map((x) => x.text || '').join(' ') : String(c.content || '')).slice(0, 300) });
    if (ev.type === 'result') out.push({ kind: ev.is_error ? 'error' : 'result', text: String(ev.result || ev.subtype || '').slice(0, 4000) });
  } else {
    const it = ev.item ?? ev.msg ?? {};
    if (ev.type === 'item.completed' && it.type === 'agent_message' && it.text) out.push({ kind: 'text', text: it.text.trim() });
    if (ev.type === 'item.started' && it.type === 'mcp_tool_call') out.push({ kind: 'tool', text: tool(it.tool), detail: '' });
    if (ev.type === 'item.completed' && it.type === 'mcp_tool_call' && it.status === 'failed') out.push({ kind: 'error', text: `${tool(it.tool)} failed` });
    if (ev.type === 'turn.failed' || ev.type === 'error') out.push({ kind: 'error', text: String(ev.error?.message || ev.message || 'Codex stopped.') });
  }
  return out;
}

const PROMPT = (projectName) =>
  [
    `Build the 3D model of the project that is open in Takeoff AI ("${projectName}") from its drawings, using the takeoff MCP tools.`,
    'If the project already has a 3D model, call list_3d_model and carry on from where it stands. First call model_3d_instructions and follow it exactly, step by step, through the whole drawing set: shell, openings, glazing, floors, roof, structure, interior walls and doors, stairs, fixtures, services and the site.',
    'Use view_3d_model several times to check your work against the drawings and fix what is wrong.',
    'Do not change any takeoffs, types or sheets. When done, reply with a short summary: what you built, what you assumed, what the drawings left unclear.',
  ].join('\n\n');

async function start(sender, { agent, projectName, mcp }) {
  if (running) throw new Error('A model is already being built.');
  if (!AGENTS[agent]) throw new Error(`Unknown agent ${agent}.`);
  if (!mcp.running) throw new Error('The AI connection is turned off. Turn it on in Connect AI, then try again.');
  const found = (await detect())[agent];
  if (!found.installed) throw new Error(`${found.label} is not installed.`);
  const dirs = await searchPath();
  const env = { ...process.env, PATH: [path.dirname(found.path), ...dirs].join(path.delimiter) };
  delete env.ELECTRON_RUN_AS_NODE;
  // An empty folder to run in, so it has nothing of the computer's to look at.
  const cwd = path.join(app.getPath('userData'), 'agent-workspace');
  await fs.mkdir(cwd, { recursive: true });
  const stdio = mcp.stdio;
  let args;
  if (agent === 'claude') {
    const config = path.join(cwd, 'mcp.json');
    await fs.writeFile(config, JSON.stringify({ mcpServers: { takeoff: stdio } }, null, 2), { mode: 0o600 });
    args = [
      '-p', PROMPT(projectName),
      '--mcp-config', config,
      '--strict-mcp-config',
      '--allowedTools', 'mcp__takeoff',
      '--disallowedTools', 'Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task',
      '--output-format', 'stream-json',
      '--verbose',
    ];
  } else {
    const toml = (v) => JSON.stringify(v);
    const tomlEnv = `{${Object.entries(stdio.env).map(([k, v]) => `${k}=${toml(v)}`).join(',')}}`;
    args = [
      'exec', '--json', '--skip-git-repo-check',
      '--sandbox', 'read-only',
      '-c', 'approval_policy="never"',
      '-c', `mcp_servers.takeoff.command=${toml(stdio.command)}`,
      '-c', `mcp_servers.takeoff.args=[${stdio.args.map(toml).join(',')}]`,
      '-c', `mcp_servers.takeoff.env=${tomlEnv}`,
      '-c', 'mcp_servers.takeoff.default_tools_approval_mode="approve"',
      '-c', 'mcp_servers.takeoff.tool_timeout_sec=900',
      PROMPT(projectName),
    ];
  }
  const child = spawn(found.path, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  running = { child, agent, sender, stopped: false };
  const send = (ev) => {
    if (!sender.isDestroyed()) sender.send('agent:event', ev);
  };
  send({ kind: 'start', text: `${found.label} started` });
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      for (const ev of summarise(agent, line)) send(ev);
    }
  });
  let err = '';
  child.stderr.on('data', (d) => {
    err = (err + d.toString()).slice(-4000);
  });
  child.on('error', (e) => {
    send({ kind: 'error', text: e.message });
  });
  child.on('close', (code) => {
    if (buf.trim()) for (const ev of summarise(agent, buf)) send(ev);
    const stopped = running?.stopped;
    running = null;
    const hint = /log ?in|auth|credential|api key|unauthor/i.test(err) ? ` Sign in first: run "${agent}" in Terminal once and log in with your ${AGENTS[agent].plan} account.` : '';
    send({ kind: 'done', ok: code === 0 && !stopped, text: stopped ? 'Stopped.' : code === 0 ? 'Finished.' : `${AGENTS[agent].label} stopped (code ${code}).${hint}${err.trim() ? `\n${err.trim().split('\n').slice(-6).join('\n')}` : ''}` });
  });
  return true;
}

function stop() {
  if (!running) return false;
  running.stopped = true;
  running.child.kill('SIGTERM');
  const c = running.child;
  setTimeout(() => {
    if (c.exitCode === null) c.kill('SIGKILL');
  }, 4000);
  return true;
}

/** `mcpInfo()` gives the MCP server's state and how to start its pipe. */
function setupAgent(mcpInfo) {
  ipcMain.handle('agent:detect', () => detect());
  ipcMain.handle('agent:start', async (e, opts) => start(e.sender, { ...opts, mcp: await mcpInfo() }));
  ipcMain.handle('agent:stop', () => stop());
  ipcMain.handle('agent:running', () => (running ? running.agent : null));
}

module.exports = { setupAgent, stopAgent: stop, summarise };
