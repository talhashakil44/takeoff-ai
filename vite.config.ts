import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { serviceWorker } from './scripts/service-worker.mjs';
import { ocrAssets } from './scripts/ocr-assets.mjs';

// Shown in Quick start, so a sub reporting a problem can say which build they have.
const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'local';
  }
})();
const build = `${new Date().toISOString().slice(0, 10)} · ${commit}`;

export default defineConfig({
  // Relative asset URLs so the same build runs from any folder or host.
  base: './',
  plugins: [react(), serviceWorker(), ocrAssets()],
  define: { __BUILD__: JSON.stringify(build) },
  test: { include: ['test/**/*.test.ts'] },
});
