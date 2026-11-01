import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const appRoot = resolve(repoRoot, 'apps/preview');
const binary = resolve(repoRoot, 'target/debug', process.platform === 'win32' ? 'kontur.exe' : 'kontur');
process.env.KONTUR_CLI_PATH ??= binary;
process.env.KONTUR_DSL_PATH = resolve(repoRoot, process.env.KONTUR_DSL_PATH ?? 'examples/orders-payments/workspace.dsl');
process.env.KONTUR_VIEW_KEY ??= 'orders-payments';

execFileSync('cargo', ['build', '--locked', '-p', 'kontur-cli'], { cwd: repoRoot, stdio: 'inherit' });

const server = await createServer({ root: appRoot, configFile: resolve(appRoot, 'vite.config.ts') });
await server.listen();
server.printUrls();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void server.close().finally(() => process.exit(0)); });
}
