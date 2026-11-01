## ADDED Requirements

### Requirement: Shared core orchestration and CLI contract
The core SHALL expose `compile_view(&SourceFile, &ViewKey) -> Result<ResolvedView, Vec<Diagnostic>>`, composing parse, resolve, validate and project in order, stopping before later stages when errors occur. The CLI SHALL read `kontur view <file.dsl> --view <key>` and emit one version-1 JSON success or diagnostic document. Success SHALL exit zero; argument, I/O and core failures SHALL exit nonzero without a successful partial view. JSON DTOs and serialization SHALL belong to the CLI boundary, not the model/core modules.

#### Scenario: Successful CLI projection
- **WHEN** the CLI receives the example file and its explicit view key
- **THEN** its output includes the resolved element/boundary/relationship IDs, metadata and source locations with `schemaVersion: 1` and `status: "ok"`

#### Scenario: Failed compilation
- **WHEN** input fails parsing, reference resolution, validation or view lookup
- **THEN** the CLI emits `status: "error"` with typed diagnostics, exits nonzero and does not emit an `ok` view

### Requirement: Checked transport boundary
TypeScript SHALL validate the CLI result's version, discriminated success/error shape, IDs, record types, metadata, available source locations, parents and relationship endpoints before passing a view to the renderer. A contract fixture SHALL exercise actual Rust output against the TypeScript consumer. The adapter SHALL NOT resolve DSL symbols, recompute view membership or repair invalid transport records.

#### Scenario: Malformed or incompatible response
- **WHEN** the host receives truncated JSON, an unsupported schema version or a relationship referencing an absent selected element
- **THEN** it reports a transport diagnostic and does not render a newly accepted diagram

### Requirement: Saved-file manual reload preview
A local development command SHALL start the preview against a configured file and view key, building the native CLI first. Initial loading and an explicit Reload action SHALL reread the saved DSL through the CLI. The development endpoint SHALL bind to loopback, restrict requests to trusted hosts/origins and the configured input, and invoke the executable with argument arrays rather than a shell. Browser input SHALL NOT select arbitrary paths or commands. Runtime rendering SHALL require no external assets, account or service.

#### Scenario: Edit and reload the example
- **WHEN** the example's displayed name or relationship label is edited on disk and Reload is invoked
- **THEN** the newly rendered diagram contains that text, retains semantic IDs and comes from fresh Rust processing rather than a hard-coded fixture

#### Scenario: Attempt arbitrary file or command selection
- **WHEN** a browser request attempts to override the fixed path/key, inject shell syntax or use an untrusted host/origin
- **THEN** the host rejects the request without reading the supplied path or executing the supplied command

### Requirement: Mermaid is a presentation adapter
The TypeScript adapter SHALL consume only `ResolvedViewDto`, produce a Mermaid flowchart and preserve all supplied nodes, system boundaries, relationship directions and labels, including parallel relationships. It SHALL render a container tagged `Database` with appropriate presentation without changing its domain kind, escape untrusted labels, use strict Mermaid security, and support existing fit/pan/zoom interactions. It SHALL NOT import spike fixture types or make Mermaid-specific IDs the core identities.

#### Scenario: Compare Orders and Payment with the spike
- **WHEN** the DSL example's complete explicit view is rendered
- **THEN** it displays the same one person, two system boundaries, five containers and eight labeled relationships as the small Mermaid spike, with comparable styling but no promise of identical pixel layout

#### Scenario: Hostile display text
- **WHEN** model labels contain quotes, angle brackets, pipes, arrows or Mermaid-like directives
- **THEN** those values remain label text and cannot inject new nodes, links, script execution or external requests

### Requirement: Error and recovery state is honest
Within an existing preview session, parse, semantic, transport and rendering errors SHALL display useful diagnostics and retain the last valid diagram visibly marked stale. A successful newer reload SHALL replace it and clear stale state; older requests/renders SHALL NOT overwrite newer results. On an initial load or full browser refresh with no valid diagram, errors SHALL display without fabricating a preview or persisting a previous session.

#### Scenario: Invalid then valid saved edit
- **WHEN** a valid diagram is followed by an invalid DSL edit and Reload, then a corrected edit and Reload
- **THEN** the invalid step retains the old diagram marked stale with a source-located diagnostic and the corrected step renders the new view without the stale marker

#### Scenario: First load is invalid
- **WHEN** the preview starts with a file that cannot compile
- **THEN** it shows diagnostics without presenting a partial or empty graph as a successfully resolved view

### Requirement: Reproducible project foundation and test-first delivery
The implementation SHALL provide a two-crate Cargo workspace, locked Rust/npm dependencies, documented and pinned toolchains, the real DSL example, supported-subset/API documentation, and minimal CI for formatting, linting, tests and the browser acceptance path. Each new behavior or fix SHALL follow an executed failing test, minimum passing implementation and refactoring; unavailable checks SHALL be disclosed. Spikes SHALL remain comparison material, and generated binaries, dependency trees and caches SHALL NOT be committed. Applicable third-party notices SHALL accompany distributed preview assets.

#### Scenario: Fresh setup and verification
- **WHEN** a developer or CI follows the documented locked setup and verification commands
- **THEN** it builds the core/CLI/preview, runs the contract and browser tests and can start the manual-reload example without uncommitted build artifacts

#### Scenario: TDD execution is reported honestly
- **WHEN** a behavior is declared implemented
- **THEN** its focused test and integration coverage are available and the handoff records the observed red/green checks or explicitly identifies any unexecuted cycle
