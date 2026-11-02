# kontur

## Product direction

- This is kontur's core repository: open-source C4 architecture-as-code tooling, ultimately a federated architecture repository with a consolidated view across teams' Git repositories.
- Use Rust for the backend/model core. Structurizr DSL is the first input format, not the implementation: build our own parser, architecture model, validation and language server; do not depend on Structurizr server or libraries.
- Git-versioned source files remain authoritative. Visualizations and the future central index are derived views; AI changes must go through source-file edits and the normal Git review workflow, not mutate a separate central truth.
- Kontur's own code is MIT (`LICENSE`); third-party dependencies retain their licenses. Local modeling must work offline without an account, central service or license server.

## Current milestone: local modeling

- Focus on one local workspace (potentially multiple files), usable by an individual or team in VS Code. Do not start with the hosted repository service.
- Implement a documented DSL subset first: people, software systems, containers, relationships, basic metadata and views. Unsupported syntax must produce explicit diagnostics, not silently disappear.
- Provide our own LSP with diagnostics, completion, hover and go-to-definition, plus a local validation CLI using the same checks for CI.
- The current VS Code preview slice supports one local `.dsl` file with one Rust-selected container view on Linux x64. It must reflect unsaved edits, support pan/zoom, and retain the last valid preview marked stale after invalid input; preserve the viewport across edits and webview recreation.
- Current preview acceptance: model systems with containers and labeled relationships, preview locally, edit unsaved text, and verify diagnostics and recovery. LSP, view picking, source navigation and multi-file input remain deferred.

## Architectural boundaries

- Share Rust parsing, reference resolution, model and validation between LSP, CLI and preview, with reuse by the later service in mind. Preserve stable element identities and source locations for diagnostics and navigation.
- Keep the semantic model separate from diagram layout/presentation. Reuse browser-based visualization in the VS Code webview and later web UI; use existing diagram/layout libraries rather than building those engines ourselves.
- Mermaid currently renders the VS Code preview, but the final renderer decision remains open. The extension packages a native Rust service executable for Linux x64; WASM remains an option for future hosts. TypeScript + React Flow + ELK.js was provisional, not an adopted stack.
- The proposed first visualization spike and its acceptance criteria are in `README.md`. For ELK.js, use the EPL-2.0 option; packaged artifacts need third-party notices and corresponding-source instructions, including source for any distributed ELK modifications.

## Development principles

- **Clean Code:** Use clear domain names, small cohesive functions/modules, explicit errors and minimal duplication. Prefer the simplest readable solution; do not introduce abstractions, dependencies or configuration for hypothetical future needs.
- **Clean Architecture:** Dependencies point inward. The architecture model and semantic rules must not depend on DSL syntax, CLI/file/network/process APIs, transport DTOs, Mermaid, layout engines or UI frameworks. Parsing, resolution, validation and view projection have distinct responsibilities and explicit typed APIs; hosts compose them rather than reimplementing their rules.
- Define each core responsibility as a separate OpenSpec capability, documenting its inputs, outputs, errors and dependency direction. Separate specs and modules do not require separate crates, traits or a generic plugin framework. Change API contracts, their callers and their tests together.
- **Test-driven development:** For each new behavior or bug fix, first write a focused failing test and run it to establish the intended failure (red); implement the smallest passing change (green); then refactor with tests passing. Organize implementation tasks in this order and report any test cycle that could not be run.
- Test observable contracts, not private implementation details. Cover normal cases, invalid/unsupported input and identity/source preservation; use integration tests for cross-boundary behavior and the local preview. Tests after implementation alone are not evidence of a red-green cycle.
- Keep validation at trust boundaries, preserve useful diagnostics and source locations, and never present invalid or stale output as current. Run applicable formatting, linting, unit and integration checks before declaring implementation complete; document skipped checks and known limits.

## Later phases, not current scope

- After local modeling: local AI assistance through MCP → references to other teams' Git workspaces at pinned versions → central aggregation, search and web-based exploration. Keep local editing independent of the future central read view.

## Repository status and design source

- Visualization experiments and their npm build/test commands remain under `spikes/visualization/`. The repository has a pinned Rust workspace, DSL/model/validation/CLI, a separate Mermaid preview and a Linux x64 VS Code live-preview VSIX with a bundled stdio service. The VSIX runtime needs no Cargo, separately installed Node.js, server or network. This is a foundation rather than the full local-modeling milestone: LSP, view picker, source navigation and multi-file input remain deferred. Keep the spikes unchanged and do not treat Mermaid as the final renderer decision. The documented binary baseline is Ubuntu 26.04.1 x86-64/glibc 2.43.
- Design basis: [shared planning conversation](https://chatgpt.com/share/6ae60834-e38c-83ed-82d3-2cc1202667d7). Later decisions supersede its early proposals to reuse Structurizr or build the central service first.
