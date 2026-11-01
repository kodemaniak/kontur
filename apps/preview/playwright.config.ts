import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const repoRoot = resolve(import.meta.dirname, '../..');
const appRoot = resolve(repoRoot, 'apps/preview');
const fixturePath = resolve(appRoot, 'test-results/orders-payments.dsl');
mkdirSync(resolve(appRoot, 'test-results'), { recursive: true });
copyFileSync(resolve(repoRoot, 'examples/orders-payments/workspace.dsl'), fixturePath);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium' },
  webServer: {
    command: 'node scripts/dev.mjs',
    cwd: appRoot,
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, KONTUR_DSL_PATH: fixturePath, KONTUR_VIEW_KEY: 'orders-payments' },
  },
});
