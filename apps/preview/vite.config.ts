import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { konturDevBridge } from './scripts/devBridge.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = 5173;

export default defineConfig({
  plugins: [konturDevBridge({
    cliPath: process.env.KONTUR_CLI_PATH ?? resolve(repoRoot, 'target/debug/kontur'),
    dslPath: resolve(repoRoot, process.env.KONTUR_DSL_PATH ?? 'examples/orders-payments/workspace.dsl'),
    viewKey: process.env.KONTUR_VIEW_KEY ?? 'orders-payments',
    port,
  })],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'] },
});
