import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const repoRoot = resolve(import.meta.dirname, '../..');
const appRoot = resolve(repoRoot, 'apps/preview');
const port = Number(process.env.KONTUR_PREVIEW_PORT ?? 5178);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium' },
  webServer: {
    command: 'node scripts/testServer.mjs',
    cwd: appRoot,
    url: `http://127.0.0.1:${port}/presenter.html`,
    reuseExistingServer: false,
    env: { ...process.env, KONTUR_PREVIEW_PORT: String(port) },
  },
});
