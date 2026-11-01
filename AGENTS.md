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
- The VS Code live preview must reflect unsaved edits, support view selection, pan/zoom and source/diagram navigation. On invalid input, retain the last valid preview and mark it stale; avoid unnecessary layout jumps.
- First acceptance scenario: model two systems with containers and labeled relationships, visualize locally, edit them, and verify diagnostics and navigation back to their definitions.

## Architectural boundaries

- Share Rust parsing, reference resolution, model and validation between LSP, CLI and preview, with reuse by the later service in mind. Preserve stable element identities and source locations for diagnostics and navigation.
- Keep the semantic model separate from diagram layout/presentation. Reuse browser-based visualization in the VS Code webview and later web UI; use existing diagram/layout libraries rather than building those engines ourselves.
- Renderer and packaging are not decided. TypeScript + React Flow + ELK.js was a provisional recommendation, not an adopted stack; Mermaid was discussed as a prototype/export option. Native process versus WASM also remains open.
- The proposed first visualization spike and its acceptance criteria are in `README.md`. For ELK.js, use the EPL-2.0 option; packaged artifacts need third-party notices and corresponding-source instructions, including source for any distributed ELK modifications.

## Later phases, not current scope

- After local modeling: local AI assistance through MCP → references to other teams' Git workspaces at pinned versions → central aggregation, search and web-based exploration. Keep local editing independent of the future central read view.

## Repository status and design source

- Still a scaffold: no application source, manifests, tests, CI or established build/lint/test commands. Rust is intended but Cargo and a toolchain are not initialized.
- Design basis: [shared planning conversation](https://chatgpt.com/share/6ae60834-e38c-83ed-82d3-2cc1202667d7). Later decisions supersede its early proposals to reuse Structurizr or build the central service first.
