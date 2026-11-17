import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/app.js'],
  outfile: 'dist/app.js',
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});
await copyFile('index.html', 'dist/index.html');
await copyFile('src/styles.css', 'dist/styles.css');

const repo = new URL('../../', import.meta.url);
execFileSync('cargo', [
  'build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
  '-p', 'kontur-cli', '--lib', '--target-dir', fileURLToPath(new URL('target/', repo)),
], { cwd: repo, stdio: 'inherit' });

await build({
  entryPoints: ['src/rust.js'],
  outfile: 'dist/rust.js',
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  logLevel: 'info',
});

await Promise.all([
  copyFile('rust.html', 'dist/rust.html'),
  copyFile('../preview/src/style.css', 'dist/preview.css'),
  copyFile(new URL('examples/orders-payments/workspace.dsl', repo), 'dist/workspace.dsl'),
  copyFile(new URL('target/wasm32-unknown-unknown/release/kontur_cli.wasm', repo), 'dist/kontur_cli.wasm'),
]);
