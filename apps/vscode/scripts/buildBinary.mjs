import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '../..');
const target = 'x86_64-unknown-linux-gnu';
const build = spawnSync('cargo', [
  'build', '--locked', '--release', '-p', 'kontur-cli', '--target', target,
], { cwd: repoRoot, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const destination = resolve(root, 'bin');
mkdirSync(destination, { recursive: true });
const binary = resolve(destination, 'kontur');
copyFileSync(resolve(repoRoot, 'target', target, 'release', 'kontur'), binary);
chmodSync(binary, 0o755);
