import type { FolderApi } from './folderSync';

/** The desktop app's extras (electron/preload.cjs). */
export interface DesktopApi extends FolderApi {
  platform: string;
  revealProject(dir: string): Promise<void>;
  /** Where projects go by default: iCloud Drive › Takeoff AI when iCloud Drive is set up. */
  getDefaultFolder(): Promise<{ path: string; iCloud: boolean }>;
  useDefaultFolder(): Promise<string>;
  /** A folder chosen before that can't be found now. */
  getMissingFolder(): Promise<string | null>;
  /** Runs `finish` when the window is closing; the window waits for it. */
  onFlush(finish: () => Promise<void>): void;
  /** Saves an exported file in a project's Exports folder; resolves to its path. */
  writeExport?(dir: string, filename: string, data: ArrayBuffer): Promise<string>;
  /** Shows a file in Finder or Explorer. */
  showFile?(file: string): Promise<void>;
  /** Posts to an embeddings service with the user's key, from the app (no browser CORS). */
  embed?(url: string, key: string, body: unknown): Promise<{ status: number; body: string }>;
  /** The MCP server AI apps connect to (electron/mcp.cjs); absent in older builds. */
  mcp?: McpBridge;
}

export interface McpInfo {
  enabled: boolean;
  running: boolean;
  port: number;
  url: string;
  token: string;
  /** How a command-based AI app (Claude Desktop, Codex) starts it. */
  stdio: { command: string; args: string[]; env: Record<string, string> };
  claudeDesktopConfig: string;
  inClaudeDesktop: boolean;
}

export interface McpBridge {
  register(tools: unknown[]): void;
  onCall(run: (name: string, args: Record<string, unknown>) => Promise<unknown>): void;
  readPdf(file: string): Promise<{ name: string; data: ArrayBuffer }>;
  info(): Promise<McpInfo>;
  addToClaudeDesktop(): Promise<string>;
  setEnabled(on: boolean): Promise<boolean>;
  newToken(): Promise<string>;
}

/** The desktop app's extras, or null in a browser. */
export const desktopApi: DesktopApi | null = (globalThis as { takeoffDesktop?: DesktopApi }).takeoffDesktop ?? null;

/** A projects folder path as people know it: "iCloud Drive › Takeoff AI". */
export function folderLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const cloud = parts.findIndex((p) => p === 'com~apple~CloudDocs' || p === 'iCloudDrive');
  if (cloud >= 0) return ['iCloud Drive', ...parts.slice(cloud + 1)].join(' › ');
  return parts.slice(-2).join(' › ');
}
