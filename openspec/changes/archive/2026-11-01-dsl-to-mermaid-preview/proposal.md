## Why

The visualization experiments established Mermaid and React Flow + ELK as promising candidates, but neither consumes real architecture source. A small end-to-end path through our own Rust core will establish the semantic foundations independently of the renderer and prove that a declared view is not just the entire model rendered as a diagram.

## What Changes

- Initialize a Cargo workspace with one reusable core library and a thin CLI, plus a small TypeScript preview application outside the archived spikes.
- Implement a documented, single-file Structurizr DSL subset for named people, software systems, containers, metadata, labeled relationships and an explicitly named container view.
- Give source diagnostics, parsing, the architecture model, reference resolution, semantic validation and view projection separate specifications and typed APIs. Keep these as cohesive modules, not one crate per specification.
- Return a resolved, renderer-neutral view from Rust; adapt it to Mermaid in TypeScript and reuse the spike's rendering and pan/zoom behavior without importing its whole harness.
- Use the Orders/Payment example, explicit element/relationship identifiers, database tags, useful source locations and explicit diagnostics for invalid or unsupported input.
- Establish Clean Code, Clean Architecture and red-green-refactor TDD as ongoing project rules, with contract tests, an end-to-end browser check and minimal repeatable CI.

**Acceptance:** Start the preview against the example DSL and selected view key, change a displayed name or relationship label, save and reload; the diagram reflects the file. Removing an element from the view removes it from the diagram without deleting it from the model. Errors produce source-located diagnostics instead of an apparently current partial diagram.

**Non-goals:** LSP, automatic/unsaved updates, source navigation, multi-file imports, complete Structurizr compatibility, arbitrary view expressions, implicit relationships, a persistent Rust service, WASM packaging and final renderer adoption.

## Capabilities

### New Capabilities

- `source-diagnostics`: Source text and spans, structured diagnostic codes, and consistent human-readable locations.
- `structurizr-dsl-parsing`: Supported grammar to a source-preserving unresolved syntax representation; syntax and unsupported-feature errors.
- `architecture-model`: Renderer- and syntax-independent model types, stable identities, containment, metadata, relationships and view definitions.
- `reference-resolution`: Deterministic conversion of declarations and symbolic references into the typed workspace; duplicate and unknown-reference diagnostics.
- `model-validation`: Semantic checks on resolved workspaces without parsing, projection or host dependencies.
- `view-projection`: Validated workspace plus view key to the explicit element/relationship selection and required system boundaries.
- `local-mermaid-preview`: Core orchestration, CLI JSON boundary, manual-reload browser host, Mermaid adapter, reproducible setup and acceptance checks.

### Modified Capabilities

None. The existing `visualization-spike` specification remains historical experiment scope.

## Impact

- Add `crates/kontur-core`, `crates/kontur-cli`, `apps/preview`, a real DSL example, subset/API documentation and basic CI.
- Introduce internal typed Rust APIs and a tested CLI-to-TypeScript JSON contract; these are not a stable public SDK yet.
- Pin Rust/Node toolchains and lock dependency resolution. The parser uses `pest` and `pest_derive` internally with our own grammar, syntax representation and diagnostics; the preview uses locally installed Mermaid/Vite. Rust does not use Structurizr libraries or a runtime service.
- Update `AGENTS.md` and OpenSpec rules with permanent development principles; update the root README to distinguish runnable functionality from the longer-term roadmap.
- Preserve original spike sources/screenshots and MIT ownership; retain required third-party notices for any distributed preview bundle.
