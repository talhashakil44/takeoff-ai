// The desktop app's side of the MCP server (electron/mcpServer.cjs): starts it, keeps its
// token, writes mcp.json for the stdio pipe (electron/mcp-stdio.cjs), runs each tool call in
// the open window (src/mcp/tools.ts does the work there), and can add Takeoff AI to Claude
// Desktop's list of servers.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, newToken } = require('./mcpServer.cjs');

const DEFAULT_PORT = 47821;
const CALL_TIMEOUT_MS = 15 * 60 * 1000;

let server = null;
let tools = null;
const waitingForTools = [];
let nextCall = 1;
const calls = new Map();

const connectionFile = () => path.join(app.getPath('userData'), 'mcp.json');

/** The .app bundle on a Mac, else the program itself: what the pipe opens when the app is closed. */
function appPath() {
  const exe = process.execPath;
  const bundle = exe.split(path.sep).findIndex((p) => p.endsWith('.app'));
  if (process.platform === 'darwin' && bundle >= 0) return exe.split(path.sep).slice(0, bundle + 1).join(path.sep);
  return exe;
}

/** The stdio pipe script: beside the app's resources when installed, beside this file in development. */
function stdioScript() {
  const packaged = path.join(process.resourcesPath ?? '', 'mcp-stdio.cjs');
  return app.isPackaged && fsSync.existsSync(packaged) ? packaged : path.join(__dirname, 'mcp-stdio.cjs');
}

function claudeDesktopConfigPath() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude', 'claude_desktop_config.json');
}

/** How an AI app that runs MCP servers as commands starts this one. */
function stdioCommand() {
  return {
    command: process.execPath,
    args: [stdioScript(), '--connection', connectionFile()],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

function toolsReady() {
  if (tools) return Promise.resolve(tools);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(tools ?? []), 20000);
    waitingForTools.push((t) => {
      clearTimeout(timer);
      resolve(t);
    });
  });
}

function mainWindow() {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
}

/**
 * Recording the window, for a time-lapse of a takeoff: frames of the app window as the app
 * draws it (captured from the window itself, so it records with other apps in front of it),
 * saved as numbered JPEGs with their times, to make a video from.
 */
const RECORD_TOOL = {
  name: 'record_window',
  title: 'Record the window',
  description:
    'Starts or stops recording the Takeoff AI window as numbered JPEG frames (with times.txt), for a time-lapse video of a takeoff. Start before take_off_whole_set (watch: true), stop after. Records even with other apps in front.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['start', 'stop'] },
      folder: { type: 'string', description: 'Where to save the frames (start). Default: ~/Movies/Takeoff AI recordings/<date time>' },
      fps: { type: 'number', description: 'Frames a second (start), 1 to 10. Default 4.' },
    },
    required: ['action'],
  },
};
const recorder = { timer: null, dir: null, frames: 0, busy: false, times: [] };

async function recordWindow(args) {
  const win = mainWindow();
  if (args.action === 'stop') {
    if (!recorder.timer) return { content: [{ type: 'text', text: 'Not recording.' }] };
    clearInterval(recorder.timer);
    recorder.timer = null;
    while (recorder.busy) await new Promise((r) => setTimeout(r, 50));
    await fs.writeFile(path.join(recorder.dir, 'times.txt'), recorder.times.join('\n'));
    return { content: [{ type: 'text', text: `Stopped. ${recorder.frames} frames in ${recorder.dir}` }] };
  }
  if (!win) throw new Error('The Takeoff AI window is closed.');
  if (recorder.timer) return { content: [{ type: 'text', text: `Already recording to ${recorder.dir}` }] };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dir = path.resolve((typeof args.folder === 'string' && args.folder.trim() ? args.folder : path.join(os.homedir(), 'Movies', 'Takeoff AI recordings', stamp)).replace(/^~(?=$|[\\/])/, os.homedir()));
  await fs.mkdir(dir, { recursive: true });
  Object.assign(recorder, { dir, frames: 0, busy: false, times: [] });
  // Keep drawing while behind other windows.
  win.webContents.setBackgroundThrottling(false);
  const fps = Math.min(10, Math.max(1, Number(args.fps) || 4));
  recorder.timer = setInterval(async () => {
    if (recorder.busy) return;
    recorder.busy = true;
    try {
      const img = await win.webContents.capturePage();
      const name = `f_${String(recorder.frames).padStart(6, '0')}.jpg`;
      const size = img.getSize();
      // Full HD at most: a Retina window's frames are four times the size.
      const out = size.width > 1920 ? img.resize({ width: 1920, quality: 'good' }) : img;
      await fs.writeFile(path.join(dir, name), out.toJPEG(85));
      recorder.times.push(`${Date.now()} ${name}`);
      recorder.frames++;
    } catch {
      // A frame missed (window reloading): the next one comes.
    } finally {
      recorder.busy = false;
    }
  }, Math.round(1000 / fps));
  return { content: [{ type: 'text', text: `Recording to ${dir} at ${fps} frames a second. Call record_window with action stop to end it.` }] };
}

/** Runs a tool in the window and waits for its result. */
async function callInWindow(name, args) {
  await toolsReady();
  const win = mainWindow();
  if (!win) throw new Error('The Takeoff AI window is closed. Open it from the Dock or taskbar, then try again.');
  const callId = nextCall++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      calls.delete(callId);
      reject(new Error(`${name} took longer than 15 minutes and was stopped waiting for.`));
    }, CALL_TIMEOUT_MS);
    calls.set(callId, { resolve, reject, timer, sender: win.webContents });
    win.webContents.send('mcp:call', { callId, name, args });
  });
}

/** The PDF at a path the AI gave, for add_drawings: only PDFs, read whole. */
async function readPdfFile(file) {
  if (typeof file !== 'string' || !file.trim()) throw new Error('No file path given.');
  const full = path.resolve(file.replace(/^~(?=$|[\\/])/, os.homedir()));
  if (!/\.pdf$/i.test(full)) throw new Error(`Not a PDF: ${full}`);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat?.isFile()) throw new Error(`No PDF at ${full}`);
  if (stat.size > 1.5e9) throw new Error(`${path.basename(full)} is too large (over 1.5 GB).`);
  const data = await fs.readFile(full);
  return { name: path.basename(full), data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`Could not read ${file}: ${e.message}`);
  }
}

/** Adds (or updates) Takeoff AI in Claude Desktop's config, keeping a backup of the old one. */
async function addToClaudeDesktop() {
  const file = claudeDesktopConfigPath();
  const config = await readJson(file);
  if (fsSync.existsSync(file)) await fs.copyFile(file, `${file}.backup-${Date.now()}`);
  config.mcpServers = { ...(config.mcpServers ?? {}), 'takeoff-ai': stdioCommand() };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2));
  return file;
}

async function inClaudeDesktop() {
  try {
    const config = JSON.parse(await fs.readFile(claudeDesktopConfigPath(), 'utf8'));
    return !!config?.mcpServers?.['takeoff-ai'];
  } catch {
    return false;
  }
}

/**
 * Starts the server (unless turned off in Connect AI) and the IPC the window uses.
 * `settings`: { read(), write(s) } for the app's settings.json.
 */
async function setupMcp(settings) {
  const s = await settings.read();
  const mcp = { enabled: true, port: DEFAULT_PORT, ...(s.mcp ?? {}) };
  if (!mcp.token) mcp.token = newToken();
  await settings.write({ ...s, mcp });

  ipcMain.on('mcp:register', (_e, list) => {
    tools = Array.isArray(list) ? list : [];
    for (const w of waitingForTools.splice(0)) w(tools);
  });
  ipcMain.on('mcp:result', (e, { callId, result, error }) => {
    const c = calls.get(callId);
    if (!c || c.sender !== e.sender) return;
    calls.delete(callId);
    clearTimeout(c.timer);
    if (error) c.reject(new Error(error));
    else c.resolve(result);
  });
  ipcMain.handle('mcp:readPdf', (_e, file) => readPdfFile(file));
  ipcMain.handle('mcp:info', async () => {
    const cur = (await settings.read()).mcp ?? mcp;
    return {
      enabled: cur.enabled !== false,
      running: !!server,
      port: server?.port ?? cur.port,
      url: `http://127.0.0.1:${server?.port ?? cur.port}/mcp`,
      token: cur.token,
      stdio: stdioCommand(),
      claudeDesktopConfig: claudeDesktopConfigPath(),
      inClaudeDesktop: await inClaudeDesktop(),
    };
  });
  ipcMain.handle('mcp:addToClaudeDesktop', () => addToClaudeDesktop());
  ipcMain.handle('mcp:setEnabled', async (_e, on) => {
    const cur = await settings.read();
    await settings.write({ ...cur, mcp: { ...(cur.mcp ?? mcp), enabled: !!on } });
    if (on && !server) await start(await settings.read());
    if (!on && server) {
      await server.close();
      server = null;
    }
    return !!server;
  });
  ipcMain.handle('mcp:newToken', async () => {
    const cur = await settings.read();
    const next = { ...(cur.mcp ?? mcp), token: newToken() };
    await settings.write({ ...cur, mcp: next });
    if (server) {
      await server.close();
      server = null;
      await start(await settings.read());
    }
    return next.token;
  });
  ipcMain.handle('shell:showFile', (_e, file) => shell.showItemInFolder(file));

  if (mcp.enabled !== false) await start(await settings.read());
}

async function start(s) {
  const mcp = s.mcp;
  try {
    server = await startServer({
      port: mcp.port ?? DEFAULT_PORT,
      token: mcp.token,
      version: app.getVersion(),
      tools: async () => [...(await toolsReady()), RECORD_TOOL],
      call: (name, args) => {
        if (name === RECORD_TOOL.name) return recordWindow(args ?? {});
        // Bring the window forward so the estimator sees what the AI is doing.
        const win = mainWindow();
        if (win && win.isMinimized()) win.restore();
        return callInWindow(name, args);
      },
    });
    await fs.writeFile(
      connectionFile(),
      JSON.stringify({ port: server.port, token: mcp.token, app: appPath(), version: app.getVersion(), pid: process.pid }, null, 2),
      { mode: 0o600 },
    );
  } catch (e) {
    server = null;
    console.error('MCP server did not start:', e);
  }
}

async function stopMcp() {
  for (const c of calls.values()) {
    clearTimeout(c.timer);
    c.reject(new Error('Takeoff AI is closing.'));
  }
  calls.clear();
  if (server) await server.close().catch(() => undefined);
  server = null;
}

/** Forget tools registered by a window that reloaded or closed. */
function windowGone() {
  tools = null;
  for (const [id, c] of calls) {
    clearTimeout(c.timer);
    c.reject(new Error('The Takeoff AI window closed while working on that.'));
    calls.delete(id);
  }
}

/** For the agent runner: is the server up, and how its pipe starts. */
function agentInfo() {
  return { running: !!server, stdio: stdioCommand() };
}

module.exports = { setupMcp, stopMcp, windowGone, readPdfFile, agentInfo };
