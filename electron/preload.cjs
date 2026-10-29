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
