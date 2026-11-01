# kontur

**Make architecture visible.**

Kontur is an open-source project for C4-based software architecture as code. Its goal is to make architecture models easy to describe, validate, and explore interactively within the IDE — initially locally for an individual or team, and later across multiple Git repositories.

The repository now includes the first local-modeling foundation: a Rust DSL subset/model/validation pipeline, a JSON CLI, and a manually reloaded local Mermaid preview. LSP and VS Code integration are still future work.

## Vision

Architecture descriptions should be maintained like source code: as text, versioned and reviewed through Git. A shared model provides different views of systems, containers, and their relationships.

Kontur aims to bring together three things:

- **Usability:** Modeling in VS Code with language support, clear diagnostics, and a local live preview.
- **Traceable architecture:** Git-versioned files remain the authoritative source. Diagrams and future central indexes are derived from them.
- **AI assistance:** Assistants should be able to understand and inspect models through MCP and prepare changes. Changes are made to source files and follow the normal Git review workflow.

The long-term goal is a federated architecture repository: teams maintain their models independently, while a consolidated view reveals relationships across teams.

## Core principles

- **Local first:** Modeling and visualization work offline, without an account or central service.
- **Our own Rust core:** The parser, architecture model, reference resolution, validation, and language server are developed in Rust.
- **Structurizr DSL as the first input format:** Kontur uses its own implementation and depends on neither the Structurizr server nor its libraries. Initial support covers a documented language subset; unsupported syntax produces explicit diagnostics.
- **One shared core:** VS Code support, the CLI, and the future service share model processing and validation.
- **Separate model and presentation:** The semantic architecture model remains independent of layout and visualization. Existing libraries will handle rendering and layout.
- **Open source throughout:** Kontur's own code is released under the [MIT license](LICENSE). Third-party dependencies retain their respective licenses.

## Roadmap

| Phase | Goal |
| --- | --- |
| **1. Local modeling** | Describe, validate, and visualize architecture in a local workspace within VS Code. |
| **2. Local AI assistance** | Query models, check consistency, and prepare changes to local files through MCP. |
| **3. Reference external models** | Include other teams' architecture workspaces from Git repositories at pinned versions. |
| **4. Consolidated central view** | Aggregate team models and explore them through search, a web interface, and read-only MCP access. |

## Current focus: local modeling

The first milestone focuses on a local workspace for an individual or team. The initial implementation handles one saved DSL file; multi-file workspaces remain deferred.

Implemented in this slice:

- A documented Structurizr DSL subset for people, software systems, containers, relationships, basic metadata, and an explicitly selected container view.
- The Rust parser, architecture model, reference resolution, semantic validation and view projection shared by the CLI and preview.
- The `kontur view <file.dsl> --view <key>` JSON CLI and a local browser preview with explicit Reload, diagnostics, stale last-valid output, pan and zoom.
- A saved-file acceptance example and CI checks for formatting, linting, Rust/TypeScript contracts, build and browser behavior.

Still planned: an LSP with completion/hover/navigation, VS Code integration, unsaved-buffer updates, source/diagram navigation, multiple files and stable layout across edits. At Fit, the left-to-right Mermaid view is a wide overview with compact labels; zoom is needed at ordinary screen sizes. This matches the Mermaid spike's readability trade-off and does not promise layout parity or stability. See [the supported DSL subset](docs/dsl-subset.md) and [core/CLI contracts](docs/core-api.md).

**Overall milestone acceptance (not yet complete):** A team opens its repository in VS Code, describes two systems with containers and labeled relationships, and visualizes and edits them locally. Diagnostics are clear, and diagram elements link back to their definitions in the source code.

## Getting started

Requirements: Rust `1.94.1` (selected by `rust-toolchain.toml`) and Node.js `22.12` or newer.

```sh
cd apps/preview
npm ci
npm run dev
```

The command builds the native CLI and serves the preview at `http://127.0.0.1:5173`. It initially reads `examples/orders-payments/workspace.dsl` and the `orders-payments` view. Edit and save that file, then click **Reload**. For a different saved file/view, set `KONTUR_DSL_PATH` and `KONTUR_VIEW_KEY` before `npm run dev`. The bridge accepts no browser-provided file or command paths.

Run the CLI without the browser:

```sh
cargo run --locked -p kontur-cli -- view examples/orders-payments/workspace.dsl --view orders-payments
```

Run all local checks (install Chromium once with `npx playwright install chromium` if needed):

```sh
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cd apps/preview
npm ci
npx playwright install chromium
npm run verify
```

## Technical direction

The Rust core maintains the architecture model, stable element identities, and source locations. The browser-based visualization is separate from the core. Mermaid is used only by this initial local preview; the renderer and final packaging approach remain undecided. Preview bundle notices, including Mermaid's ELK dependency under EPL-2.0, are generated in [`apps/preview/THIRD_PARTY_NOTICES.md`](apps/preview/THIRD_PARTY_NOTICES.md).

The final visualization/layout library and packaging of the local core are still undecided. React Flow with ELK.js remains a candidate; Mermaid currently powers only the small local-preview slice. The spikes remain separate evaluation prototypes.

## Visualization spikes: interactive C4 candidates

**Question:** Can React Flow + ELK.js provide readable nested diagrams and predictable updates in an offline VS Code webview with a small amount of integration code?

Timebox: two development days, ending with a working demonstration and an adopt/reject/further-investigation recommendation. This evaluates the candidate; it does not commit the product to it.

### Scope

- Build an isolated TypeScript/React prototype under `spikes/visualization/`, using a fixed JSON view fixture with stable IDs and source locations. No parser or LSP is needed for this experiment.
- Include one person, two system boundaries, several containers, a database, and labeled relationships within and across boundaries. Include long labels and parallel relationships to expose routing problems.
- Use ELK for nested layout, edge routes and label positions; render those results in React Flow with custom C4 nodes. Keep layout state separate from the semantic fixture.
- Provide pan/zoom, keyboard selection, and scripted rename/add/remove updates. Preserve the viewport and existing positions for changes that do not affect geometry; provide an explicit re-layout action.
- Run the same viewer in a browser and a minimal VS Code webview. Bundle all assets and the layout worker locally. Clicking a node should open its fixture source location; an editor selection should highlight the corresponding node.
- Simulate an invalid-model update to verify that the previous diagram remains visible with a stale indicator. This tests presentation behavior, not DSL validation.

### Decision criteria and deliverables

- Nested boundaries, edge endpoints and relationship labels remain readable without manual repair in the representative fixture.
- Rename/add/remove updates preserve selection and viewport where applicable. Record movement of unchanged nodes and distinguish text-only updates from geometry/topology changes; stable layout must be demonstrated, not assumed.
- Verify keyboard navigation, light/dark themes, and offline operation in VS Code, including worker loading under the webview's content security policy.
- Record initial layout and update timings for the small fixture and an approximately 100-node fixture, with machine details. Check whether pan/zoom stays responsive during layout.
- Leave runnable instructions, before/after screenshots, a small automated check for the nested-layout mapping and source-ID preservation, and a short decision note describing failures and integration effort. If this candidate fails, evaluate Sprotty + ELK against the same fixtures.

### Licensing to include in the spike

- React Flow is MIT-licensed. ELK.js currently declares `EPL-2.0 OR GPL-3.0-or-later`; use its EPL-2.0 option and verify the pinned package's license.
- Include third-party license texts and copyright notices in the distributable, plus instructions for obtaining the corresponding ELK source. Distributed modifications to ELK must also be made available under EPL-2.0; kontur's independent code remains MIT.
- Record exact dependency versions and source links in `THIRD_PARTY_NOTICES.md` alongside the spike, and check transitive dependencies before packaging. Carry these notices into any eventual extension release.
- References: [React Flow license](https://github.com/xyflow/xyflow/blob/main/LICENSE), [ELK.js package declaration](https://github.com/kieler/elkjs/blob/master/package.json), [EPL-2.0 terms](https://www.eclipse.org/org/documents/epl-2.0/EPL-2.0.txt).
