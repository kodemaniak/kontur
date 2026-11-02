## Why

Kontur can already compile a saved DSL file and display its resolved view in a browser, but modeling still requires a development server, saving, and manual reloads. The next useful slice is an installable VS Code extension that displays the same architecture directly beside its source and follows unsaved edits without a terminal or browser switch.

## What Changes

- Add `Kontur: Open Preview` for a local DSL document, opening one document-bound preview beside the editor and automatically processing unsaved edits after a short debounce.
- Assume exactly one declared view. Rust selects it and reports missing or multiple views explicitly; no view picker, hard-coded example key, or TypeScript DSL parsing is introduced.
- Extend the existing native executable with a persistent, versioned stdin/stdout preview service. The extension owns its lifecycle; parsing, reference resolution, model validation and view projection remain in the shared Rust core.
- Reuse the current Mermaid presentation and checked JSON contract in an offline webview. Preserve last-valid output on errors, reject superseded results, and retain pan/zoom on updates without promising stable Mermaid layout.
- **BREAKING:** Replace the product preview's Vite development server and saved-file HTTP bridge with extension messaging and a static asset build. The existing browser `npm run dev` workflow is retired; a browser test harness may remain, but a standalone browser application is not a deliverable. Visualization spikes remain unchanged.
- Produce a self-contained `linux-x64` VSIX containing the native executable, browser assets and third-party notices. No runtime compilation, binary download, Vite server, Axum server, account or network access is required.

**Acceptance:** Install the VSIX on the supported development platform, open this repository, select `examples/orders-payments/workspace.dsl`, and run `Kontur: Open Preview`. Change a relationship label without saving: the diagram updates in VS Code. An invalid edit retains the prior diagram with a stale/error indication; correcting it recovers. Closing the preview terminates its Rust process.

**Non-goals:** A language server, completion/hover, Problems-panel integration, source/diagram navigation, multiple views or files, graphical editing, a new renderer, stable node positions, standalone browser hosting, Marketplace publication, a cross-platform release matrix, verified Remote/WSL/container support, untrusted workspaces, and browser-only VS Code support.

## Capabilities

### New Capabilities

- `local-preview-service`: A bounded, versioned Rust stdio host for in-memory document snapshots, correlated results, recoverable compilation errors and explicit process/protocol failure behavior.
- `vscode-live-preview`: Command registration, document binding, unsaved-buffer updates, revision ordering, webview messaging and managed native-process lifecycle.
- `vscode-extension-packaging`: Reproducible platform-specific VSIX packaging, bundled offline resources, supported-platform checks, license delivery and installed-extension acceptance.

### Modified Capabilities

- `local-mermaid-preview`: Add single-view core orchestration while preserving the explicit-key CLI, replace the saved-file HTTP host requirement, and define transport-independent presentation, stale/recovery behavior and viewport preservation for live updates.

Parsing, source diagnostics, architecture modeling, reference resolution, semantic validation and projection remain separate existing capabilities; this change composes them rather than merging their responsibilities or expanding the DSL subset.

## Impact

- Extend `crates/kontur-core/src/lib.rs` with a single-view composition entry point; keep the existing module contracts and domain types independent of transport and rendering.
- Extend `crates/kontur-cli` with the stdio service and reuse its existing result DTO conversion. Preserve `kontur view <file.dsl> --view <key>` and its exit/JSON behavior.
- Add `apps/vscode` for the extension host and packaging. Adapt `apps/preview` into reusable presentation assets and tests, replacing its Vite-specific host/build wiring without changing `spikes/visualization`.
- Add contract, process, webview and VS Code integration tests; update locked build dependencies, CI, README, API/subset documentation and repository status guidance.
- Package a release-mode Rust binary for Linux x86-64 with a documented system baseline. Other OS/CPU combinations require future matching binaries and targeted VSIX packages, not architectural changes.
