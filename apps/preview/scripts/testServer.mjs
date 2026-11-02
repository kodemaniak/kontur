import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-results/browser');
mkdirSync(output, { recursive: true });
await build({
  entryPoints: [resolve(root, 'tests/presenterHarness.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: resolve(output, 'presenter-test.js'),
});
await build({
  entryPoints: [resolve(root, 'tests/webviewHarness.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: resolve(output, 'webview-api-test.js'),
});
await build({
  entryPoints: [resolve(root, 'src/webview.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: resolve(output, 'webview-test.js'),
});
copyFileSync(resolve(root, 'tests/presenter.html'), resolve(output, 'presenter.html'));
copyFileSync(resolve(root, 'tests/webview.html'), resolve(output, 'webview.html'));
copyFileSync(resolve(root, 'src/style.css'), resolve(output, 'preview.css'));

const contentTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const path = resolve(output, `.${decodeURIComponent(pathname)}`);
  if (!path.startsWith(`${output}${sep}`) || !statSync(path, { throwIfNoEntry: false })?.isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream' });
  response.end(readFileSync(path));
});

const port = Number(process.env.KONTUR_PREVIEW_PORT ?? 5178);
server.listen(port, '127.0.0.1', () => console.log(`Presenter test server listening on ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
