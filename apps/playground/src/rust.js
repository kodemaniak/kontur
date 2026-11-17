import { parsePreviewJson } from '../../preview/src/contract';
import { mountPreview } from '../../preview/src/presenter';
import { compileWithWasm } from './wasm.js';

const editor = document.querySelector('#dsl');
const preview = mountPreview(document.querySelector('#app'));
let revision = 0;
let wasm;

async function compile() {
  const current = ++revision;
  preview.markPending(current);
  try {
    const result = parsePreviewJson(compileWithWasm(wasm, editor.value));
    await preview.applyResult(current, result);
  } catch (error) {
    preview.showHostError(current, error.message);
  }
}

try {
  const response = await fetch(new URL('./kontur_cli.wasm', import.meta.url));
  if (!response.ok) throw new Error(`WASM konnte nicht geladen werden (HTTP ${response.status}).`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  wasm = instance.exports;
  const example = await fetch(new URL('./workspace.dsl', import.meta.url));
  if (!example.ok) throw new Error(`Das Beispiel konnte nicht geladen werden (HTTP ${example.status}).`);
  editor.value = await example.text();
  editor.disabled = false;
  editor.addEventListener('input', compile);
  await compile();
} catch (error) {
  preview.showHostError(++revision, error.message);
}
