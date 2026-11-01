## Why

Kontur needs readable, interactive C4 diagrams in an offline VS Code preview, but nested layout, edge labels and stable updates remain unproven. A two-development-day spike will evaluate React Flow + ELK.js before the Rust core or editor integration depends on that choice.

## What Changes

- Add an isolated visualization prototype under `spikes/visualization/` using fixed JSON fixtures instead of a parser or language server.
- Exercise nested C4 boundaries, labeled and parallel cross-boundary relationships, selection, source navigation, and scripted model updates.
- Run the same viewer in a browser and a minimal offline VS Code webview with a locally bundled layout worker.
- Measure layout/update latency and movement of unchanged elements; record readability, accessibility and packaging results with screenshots.
- Include dependency license notices and corresponding ELK source-access instructions in the packaged spike.
- Produce an adopt/reject/further-investigation recommendation. This is an experiment, not production renderer adoption or an implementation of all phase-one functionality.

## Capabilities

### New Capabilities

- `visualization-spike`: Reproducible framework evaluation covering fixtures, rendering, updates, offline editor integration, evidence and licensing.

### Modified Capabilities

None; there are no existing specifications.

## Impact

- Introduces a self-contained TypeScript/React toolchain, React Flow and ELK.js in the spike directory, with a lockfile and documented commands.
- Adds a development-only VS Code extension and fixture-source navigation; no public product API or Rust package is introduced.
- Kontur's original code remains MIT. React Flow retains MIT notices; ELK.js uses its EPL-2.0 option, with bundled notices and access to corresponding source. Exact pinned packages and transitive dependencies must be checked when packaging.
- The outcome informs a subsequent renderer decision; Sprotty + ELK is the next candidate if needed, outside this timebox.
