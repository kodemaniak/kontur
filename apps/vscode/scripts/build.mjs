import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const testOut = resolve(root, 'test');
const media = resolve(root, 'media');
const preview = resolve(root, '../preview');
const repoRoot = resolve(root, '../..');
rmSync(dist, { recursive: true, force: true });
rmSync(testOut, { recursive: true, force: true });
rmSync(media, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
mkdirSync(testOut, { recursive: true });
mkdirSync(media, { recursive: true });
copyFileSync(resolve(repoRoot, 'LICENSE'), resolve(root, 'LICENSE'));

const previewBuild = spawnSync('npm', ['run', 'build'], { cwd: preview, stdio: 'inherit' });
if (previewBuild.status !== 0) process.exit(previewBuild.status ?? 1);
for (const asset of ['webview.js', 'preview.css', 'THIRD_PARTY_NOTICES.md']) {
  copyFileSync(resolve(preview, 'dist', asset), resolve(media, asset));
}
const noticesResult = spawnSync(process.execPath, ['scripts/writeRustNotices.mjs'], { cwd: root, stdio: 'inherit' });
if (noticesResult.status !== 0) process.exit(noticesResult.status ?? 1);

const result = spawnSync('npx', [
  'esbuild',
  'src/extension.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node20',
  '--external:vscode',
  '--outfile=dist/extension.cjs',
], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

const testResult = spawnSync('npx', [
  'esbuild',
  'src/test/index.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node20',
  '--external:vscode',
  '--external:playwright-core',
  '--outfile=test/index.js',
], { cwd: root, stdio: 'inherit' });
if (testResult.status !== 0) process.exit(testResult.status ?? 1);

const unitTestResult = spawnSync('npx', [
  'esbuild',
  'src/test/unit.test.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node20',
  '--outfile=test/unit.test.cjs',
], { cwd: root, stdio: 'inherit' });
if (unitTestResult.status !== 0) process.exit(unitTestResult.status ?? 1);
