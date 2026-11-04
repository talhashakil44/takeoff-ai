// What the desktop app adds to the page: the shared projects folder. Nothing else of
// the computer is reachable from the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('takeoffDesktop', {
  platform: process.platform,
  getFolder: () => ipcRenderer.invoke('folder:get'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  revealFolder: () => ipcRenderer.invoke('folder:reveal'),
  list: () => ipcRenderer.invoke('folder:list'),
  dirFor: (name, id) => ipcRenderer.invoke('folder:dirFor', name, id),
  read: (dir) => ipcRenderer.invoke('folder:read', dir),
  write: (dir, json, meta) => ipcRenderer.invoke('folder:write', dir, json, meta),
  hasPdf: (dir, docId) => ipcRenderer.invoke('folder:hasPdf', dir, docId),
  readPdf: (dir, docId) => ipcRenderer.invoke('folder:readPdf', dir, docId),
  writePdf: (dir, docId, data) => ipcRenderer.invoke('folder:writePdf', dir, docId, data),
  trash: (dir) => ipcRenderer.invoke('folder:trash', dir),
  rename: (from, to) => ipcRenderer.invoke('folder:rename', from, to),
  revealProject: (dir) => ipcRenderer.invoke('folder:revealProject', dir),
  getDefaultFolder: () => ipcRenderer.invoke('folder:default'),
  useDefaultFolder: () => ipcRenderer.invoke('folder:useDefault'),
  getMissingFolder: () => ipcRenderer.invoke('folder:missing'),
  writeExport: (dir, filename, data) => ipcRenderer.invoke('folder:writeExport', dir, filename, data),
  /** Projects opened from another folder (shared or local), saved back to it. */
  linked: {
    open: () => ipcRenderer.invoke('linked:open'),
    shareTo: (id, name) => ipcRenderer.invoke('linked:shareTo', id, name),
    list: () => ipcRenderer.invoke('linked:list'),
    remove: (id) => ipcRenderer.invoke('linked:remove', id),
    read: (root, dir) => ipcRenderer.invoke('linked:read', root, dir),
    write: (root, dir, json, meta) => ipcRenderer.invoke('linked:write', root, dir, json, meta),
    hasPdf: (root, dir, docId) => ipcRenderer.invoke('linked:hasPdf', root, dir, docId),
    readPdf: (root, dir, docId) => ipcRenderer.invoke('linked:readPdf', root, dir, docId),
    writePdf: (root, dir, docId, data) => ipcRenderer.invoke('linked:writePdf', root, dir, docId, data),
    writeExport: (root, dir, filename, data) => ipcRenderer.invoke('linked:writeExport', root, dir, filename, data),
    reveal: (root, dir) => ipcRenderer.invoke('linked:reveal', root, dir),
  },
  showFile: (file) => ipcRenderer.invoke('shell:showFile', file),
  /** Posts to an embeddings service with the user's key (OpenAI, Voyage). */
  embed: (url, key, body) => ipcRenderer.invoke('ai:embed', url, key, body),
  /** The MCP server AI apps connect to (electron/mcp.cjs). */
  mcp: {
    register: (tools) => ipcRenderer.send('mcp:register', tools),
    /** `run(name, args)` answers each tool call. */
    onCall: (run) => {
      ipcRenderer.on('mcp:call', async (_e, { callId, name, args }) => {
        try {
          ipcRenderer.send('mcp:result', { callId, result: await run(name, args) });
        } catch (err) {
          ipcRenderer.send('mcp:result', { callId, error: err && err.message ? err.message : String(err) });
        }
      });
    },
    readPdf: (file) => ipcRenderer.invoke('mcp:readPdf', file),
    info: () => ipcRenderer.invoke('mcp:info'),
    addToClaudeDesktop: () => ipcRenderer.invoke('mcp:addToClaudeDesktop'),
    setEnabled: (on) => ipcRenderer.invoke('mcp:setEnabled', on),
    newToken: () => ipcRenderer.invoke('mcp:newToken'),
  },
  /** Downloads a sample project file (.takeoff) from the app's release. */
  fetchSample: (file) => ipcRenderer.invoke('samples:fetch', file),
  /** Coding agents on the user's own plan (electron/agent.cjs). */
  agent: {
    detect: () => ipcRenderer.invoke('agent:detect'),
    start: (opts) => ipcRenderer.invoke('agent:start', opts),
    stop: () => ipcRenderer.invoke('agent:stop'),
    signIn: (agent) => ipcRenderer.invoke('agent:signIn', agent),
    running: () => ipcRenderer.invoke('agent:running'),
    onEvent: (fn) => {
      const h = (_e, ev) => fn(ev);
      ipcRenderer.on('agent:event', h);
      return () => ipcRenderer.removeListener('agent:event', h);
    },
  },
  /** Called when the window is closing: finish writing, then the window closes. */
  onFlush: (finish) => {
    ipcRenderer.on('app:flush', async () => {
      try {
        await finish();
      } finally {
        ipcRenderer.send('app:flushed');
      }
    });
  },
});
