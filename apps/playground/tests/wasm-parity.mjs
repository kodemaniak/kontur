import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { compileWithWasm } from '../src/wasm.js';

const root = new URL('../../../', import.meta.url);
const example = await readFile(new URL('examples/orders-payments/workspace.dsl', root), 'utf8');
const wasm = await readFile(new URL('../dist/kontur_cli.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasm);
const documentUri = 'workspace.dsl';
const texts = [example, example.replace('Order Hub', 'Bücher 📚'), 'workspace "broken'];
const requests = texts.map((text, index) => JSON.stringify({
  schemaVersion: 1, revision: index + 1, documentUri, text,
}));
const native = execFileSync('cargo', ['run', '--locked', '--quiet', '-p', 'kontur-cli', '--', 'preview-service'], {
  cwd: root, input: requests.join('\n') + '\n', encoding: 'utf8',
}).trim().split('\n').map((line) => JSON.parse(line).result);

assert.deepEqual(native.map(({ status }) => status), ['ok', 'ok', 'error']);
for (const [index, text] of texts.entries()) {
  assert.deepEqual(JSON.parse(compileWithWasm(instance.exports, text)), native[index]);
}
console.log('WASM and native preview agree on the shared example, Unicode and syntax diagnostics.');
