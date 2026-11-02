import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '../..');
const binary = process.env.VSCODE_EXECUTABLE;
const vscodeExecutablePath = binary ?? await downloadAndUnzipVSCode('1.144.0');
const cli = process.env.VSCODE_CLI ?? resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
const scratch = mkdtempSync(resolve(tmpdir(), 'kontur-vsix-'));
const extensions = resolve(scratch, 'extensions');
const debugPort = await reservePort();
const vsix = readdirSync(root).find((file) => file.endsWith('.vsix'));
if (!vsix) throw new Error('No VSIX package found; run npm run package first');

try {
  const install = spawnSync(cli, [
    `--user-data-dir=${resolve(scratch, 'install-user-data')}`,
    `--extensions-dir=${extensions}`,
    '--install-extension',
    resolve(root, vsix),
    '--force',
  ], { stdio: 'inherit' });
  if (install.status !== 0) throw new Error(`VSIX installation failed with status ${install.status}`);
  const installedExtension = readdirSync(extensions).find((name) => name.startsWith('kontur.kontur-vscode-preview-'));
  if (!installedExtension) throw new Error('VS Code did not install the Kontur VSIX');

  process.env.KONTUR_VSCODE_DEBUG_PORT = String(debugPort);
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: resolve(extensions, installedExtension),
    extensionTestsPath: resolve(root, 'test'),
    launchArgs: [
      `--user-data-dir=${resolve(scratch, 'user-data')}`,
      `--extensions-dir=${extensions}`,
      `--remote-debugging-port=${debugPort}`,
      repoRoot,
    ],
  });
} finally {
  delete process.env.KONTUR_VSCODE_DEBUG_PORT;
  rmSync(scratch, { recursive: true, force: true });
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a VS Code debug port.');
  await new Promise((resolveClose) => server.close(resolveClose));
  return address.port;
}
