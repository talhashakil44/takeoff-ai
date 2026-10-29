// Takeoff AI as a desktop app (Mac and Windows). It runs the same web app, served from
// the built files under an app:// address, and adds one thing a browser can't: keeping
// projects in a folder on disk (iCloud Drive, say) so two computers share them.
const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const folder = require('./folder.cjs');
const mcp = require('./mcp.cjs');

const DIST = path.join(__dirname, '..', 'dist');
// Tests run two copies side by side, as two computers, each with its own profile.
if (process.env.TAKEOFF_USER_DATA) app.setPath('userData', process.env.TAKEOFF_USER_DATA);
const FOLDER_NAME = 'Takeoff AI';

// One copy at a time: a second launch (an AI app opening Takeoff AI, a double-click) brings
// the open window forward instead of starting another, so there is one MCP server.
const firstCopy = app.requestSingleInstanceLock();
if (!firstCopy) app.quit();
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// A standard, secure scheme: the page gets its own origin, so its database (IndexedDB)
// and storage persist between launches like a website's.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
async function writeSettings(s) {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(s, null, 2));
}

/** Where iCloud Drive lives on this computer, if it does. */
function iCloudDrive() {
  const home = os.homedir();
  const candidates =
    process.platform === 'darwin' ? [path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')] : [path.join(home, 'iCloudDrive')];
  return candidates.find((p) => fsSync.existsSync(p)) ?? null;
}

let root = null;
// Quitting (⌘Q) rather than closing one window: after the last writes, quit for real.
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

/** Where projects go unless you pick somewhere else: iCloud Drive › Takeoff AI, else Documents › Takeoff AI. */
const defaultFolder = () => path.join(iCloudDrive() ?? app.getPath('documents'), FOLDER_NAME);

async function useFolder(chosen) {
  await fs.mkdir(chosen, { recursive: true });
  root = chosen;
  await writeSettings({ ...(await readSettings()), projectsFolder: chosen });
  return chosen;
}

function requireRoot() {
  if (!root) throw new Error('No projects folder chosen');
  return root;
}

function registerIpc() {
  ipcMain.handle('folder:get', () => root);
  ipcMain.handle('folder:choose', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose where to keep your projects',
      message: 'Pick iCloud Drive (or another synced folder). Projects go in a "Takeoff AI" folder inside it.',
      defaultPath: iCloudDrive() ?? app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const picked = result.filePaths[0];
    return useFolder(path.basename(picked) === FOLDER_NAME ? picked : path.join(picked, FOLDER_NAME));
  });
  ipcMain.handle('folder:default', () => ({ path: defaultFolder(), iCloud: !!iCloudDrive() }));
  ipcMain.handle('folder:useDefault', () => useFolder(defaultFolder()));
  /** The folder chosen before but missing now (iCloud signed out, drive unplugged), to say so. */
  ipcMain.handle('folder:missing', async () => {
    const saved = (await readSettings()).projectsFolder;
    return saved && !root ? saved : null;
  });
  ipcMain.handle('folder:rename', (_e, from, to) => folder.rename(requireRoot(), from, to));
  ipcMain.handle('folder:revealProject', (_e, dir) => shell.openPath(folder.inside(requireRoot(), dir)));
  ipcMain.handle('folder:list', () => folder.list(requireRoot()));
  ipcMain.handle('folder:dirFor', (_e, name, id) => folder.dirFor(name, id));
  ipcMain.handle('folder:read', (_e, dir) => folder.readProject(requireRoot(), dir));
  ipcMain.handle('folder:write', (_e, dir, json, meta) => folder.writeProject(requireRoot(), dir, json, meta));
  ipcMain.handle('folder:hasPdf', (_e, dir, docId) => folder.hasPdf(requireRoot(), dir, docId));
  ipcMain.handle('folder:readPdf', async (_e, dir, docId) => {
    const data = await folder.readPdf(requireRoot(), dir, docId);
    return data ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null;
  });
  ipcMain.handle('folder:writePdf', (_e, dir, docId, data) => folder.writePdf(requireRoot(), dir, docId, data));
  // Deleted projects go to the Trash (Recycle Bin), not straight away.
  ipcMain.handle('folder:trash', async (_e, dir) => {
    const target = folder.inside(requireRoot(), dir);
    if (fsSync.existsSync(target)) await shell.trashItem(target);
  });
  ipcMain.handle('folder:reveal', () => root && shell.openPath(root));
  // Embeddings for the project map, with the user's own key: asked from here, where the
  // provider's browser rules (CORS) do not apply. Only these two hosts.
  ipcMain.handle('ai:embed', async (_e, url, key, body) => {
    const host = new URL(url).host;
    if (!['api.openai.com', 'api.voyageai.com', 'ai.mongodb.com'].includes(host)) throw new Error('Not an embeddings service');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.text() };
  });
  ipcMain.handle('folder:writeExport', (_e, dir, filename, data) => folder.writeExport(requireRoot(), dir, filename, data));
}

function serveApp() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let file;
    try {
      file = folder.inside(DIST, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, ''));
    } catch {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Takeoff AI',
    backgroundColor: '#f5f5f7',
    // Not throttled behind other windows: an AI drives long takeoffs while the estimator works elsewhere.
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  // Links (help, GitHub) open in the browser, not in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  // Closing waits for the page to finish writing the last changes to the projects folder
  // (at most a few seconds, so a stuck write never keeps the window open).
  let flushed = false;
  win.on('close', (event) => {
    if (flushed) return;
    event.preventDefault();
    const done = () => {
      flushed = true;
      ipcMain.removeListener('app:flushed', onFlushed);
      if (quitting) app.quit();
      else if (!win.isDestroyed()) win.close();
    };
    const onFlushed = (e) => {
      if (e.sender === win.webContents) done();
    };
    ipcMain.on('app:flushed', onFlushed);
    win.webContents.send('app:flush');
    setTimeout(done, 8000);
  });
  // A reload or a crash drops the page's MCP tools until it registers them again.
  win.webContents.on('did-start-navigation', (e) => {
    if (e.isMainFrame && !e.isSameDocument) mcp.windowGone();
  });
  win.webContents.on('render-process-gone', () => mcp.windowGone());
  win.on('closed', () => mcp.windowGone());
  void win.loadURL('app://takeoff/index.html');
  return win;
}

app.whenReady().then(async () => {
  if (!firstCopy) return;
  const saved = (await readSettings()).projectsFolder;
  root = saved && fsSync.existsSync(saved) ? saved : null;
  serveApp();
  registerIpc();
  await mcp.setupMcp({ read: readSettings, write: writeSettings });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => void mcp.stopMcp());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
