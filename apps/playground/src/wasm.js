const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function compileWithWasm(wasm, source) {
  const bytes = encoder.encode(source);
  const input = wasm.preview_input(bytes.length);
  if (!input) throw new Error('Das Modell überschreitet 5 MiB.');
  new Uint8Array(wasm.memory.buffer, input, bytes.length).set(bytes);
  const length = wasm.preview_compile();
  if (!length) throw new Error('Rust konnte das Modell nicht verarbeiten.');
  return decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.preview_output(), length));
}
