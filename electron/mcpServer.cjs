// The MCP server that lets an AI (Claude Desktop, Claude Code, Codex, a local model) drive
// Takeoff AI. It speaks MCP's Streamable HTTP transport, JSON responses only, on this
// computer's loopback address. No Electron here, so tests run it in plain Node; the desktop
// app (electron/main.cjs) hands it the tool list and runs each call in the open window.
//
//   POST http://127.0.0.1:<port>/mcp   Authorization: Bearer <token>   JSON-RPC 2.0
//
// Every request needs the token (kept in the app's settings, shown in Connect AI), comes
// from this computer, and carries no browser Origin, so a web page can't reach it.
const http = require('node:http');
const crypto = require('node:crypto');

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 50 * 1024 * 1024;

const INSTRUCTIONS = [
  'Takeoff AI is a construction quantity takeoff app running on this computer. You work on the project open in its window; the estimator watches and can undo anything you do.',
  'Coordinates are sheet points: PDF points (1/72 in) from the sheet\'s top-left corner. get_sheet_image tells you how its pixels map to sheet points; get_sheet_text gives every text run\'s position.',
  'Typical flow: list_projects / open_project or create_project, add_drawings (PDF paths on this computer), list_sheets, check each plan\'s scale (set_sheet_scale), take_off_whole_set (or run_automation for one tool on one sheet), look at the result with get_sheet_image, fix with add_takeoff / delete_takeoffs, then get_quantities and export_excel.',
  'Takeoffs you add are labelled "AI" until the estimator reviews them. Measure only what the drawings show; say what you could not read rather than guessing.',
].join('\n');

const newToken = () => crypto.randomBytes(24).toString('base64url');

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * Handles one JSON-RPC message. Returns the response, or null for a notification.
 * `tools()`: the tool list ({ name, description, inputSchema }); `call(name, args)`: runs a
 * tool and resolves to an MCP CallToolResult.
 */
async function handleMessage(msg, { tools, call, version }) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request');
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  if (isNotification) return null;
  try {
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'takeoff-ai', title: 'Takeoff AI', version: version ?? '0.0.0' },
            instructions: INSTRUCTIONS,
          },
        };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: await tools() } };
      case 'tools/call': {
        const name = params?.name;
        if (typeof name !== 'string') return rpcError(id, -32602, 'Missing tool name');
        const known = (await tools()).some((t) => t.name === name);
        if (!known) return rpcError(id, -32602, `Unknown tool: ${name}`);
        let result;
        try {
          result = await call(name, params.arguments ?? {});
        } catch (e) {
          result = { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
        }
        return { jsonrpc: '2.0', id, result };
      }
      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: [] } };
      case 'prompts/list':
        return { jsonrpc: '2.0', id, result: { prompts: [] } };
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return rpcError(id, -32603, e instanceof Error ? e.message : String(e));
  }
}

const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** A loopback request with the right token and no browser origin. */
function allowed(req, token) {
  if (!LOCAL_HOSTS.test(req.headers.host ?? '')) return false;
  const origin = req.headers.origin;
  // Any Origin header, "null" included, means a web page or sandboxed frame: never allowed.
  if (origin !== undefined) return false;
  const auth = req.headers.authorization ?? '';
  const given = Buffer.from(auth.replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(token);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

/**
 * Starts the server on the first free port from `port` (trying the next nine). Resolves to
 * { port, close }.
 */
function startServer({ port = 47821, token, tools, call, version, host = '127.0.0.1' }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/mcp') return send(res, 404, { error: 'Not found' });
    if (!allowed(req, token)) return send(res, 401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    if (req.method === 'GET') return send(res, 405, { error: 'No event stream; POST JSON-RPC instead' }, { Allow: 'POST, DELETE' });
    if (req.method === 'DELETE') return send(res, 200, {});
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        send(res, 413, rpcError(null, -32600, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(res, 400, rpcError(null, -32700, 'Parse error'));
      }
      const ctx = { tools, call, version };
      if (Array.isArray(msg)) {
        const out = (await Promise.all(msg.map((m) => handleMessage(m, ctx)))).filter(Boolean);
        return out.length ? send(res, 200, out) : send(res, 202);
      }
      const out = await handleMessage(msg, ctx);
      return out ? send(res, 200, out) : send(res, 202);
    });
  });
  return new Promise((resolve, reject) => {
    let tryPort = port;
    const attempt = () => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && tryPort < port + 9) {
          tryPort++;
          attempt();
        } else reject(e);
      });
      server.listen(tryPort, host, () => resolve({ port: tryPort, close: () => new Promise((r) => server.close(() => r())) }));
    };
    attempt();
  });
}

module.exports = { startServer, handleMessage, newToken, PROTOCOL_VERSIONS, INSTRUCTIONS };
