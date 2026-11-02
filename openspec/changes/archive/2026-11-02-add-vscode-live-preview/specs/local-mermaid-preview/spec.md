## ADDED Requirements

### Requirement: Single-view core composition
The core SHALL additionally expose `compile_single_view(&SourceFile) -> Result<ResolvedView, Vec<Diagnostic>>`, composing the same parse, resolve, validate and project stages used by `compile_view`. It SHALL select the sole validated view without a caller-supplied key and preserve its actual key, stable identities and source spans. Missing/multiple views and unsupported/invalid source SHALL produce useful existing-category diagnostics with no successful partial view; source rejected by the existing single-view grammar SHALL remain rejected without broadening the DSL. The facade SHALL own orchestration and selection policy, depend only on the existing core modules, and perform no file/process/network, transport serialization or presentation work. The explicit-key facade and CLI SHALL remain compatible.

#### Scenario: Example view is selected without configuration
- **WHEN** the example source is compiled through the single-view facade
- **THEN** the result has the same key, membership, identities and source spans as explicit compilation of `orders-payments`

#### Scenario: Missing or multiple views are not guessed
- **WHEN** a snapshot declares zero views or more than one view
- **THEN** compilation reports the single-view/subset failure and returns no arbitrarily selected view

#### Scenario: A normal core failure remains a core failure
- **WHEN** source has invalid syntax, an unsupported directive, an unknown reference or an invalid view scope
- **THEN** the existing stage-specific diagnostics and source locations are returned without bypassing checks to create a preview

### Requirement: Viewport continuity across live updates
The presenter SHALL retain fit/pan/zoom controls and preserve the current viewport across successful live updates. Equal fitted geometry SHALL preserve the same viewport; changed geometry SHALL preserve relative center and zoom rather than automatically fit. Initial rendering and an explicit Fit action SHALL fit the diagram. This requirement SHALL NOT imply stable Mermaid node positions or preserved diagram state across different document sessions.

#### Scenario: Update after zooming and panning
- **WHEN** the user zooms/pans and a new result renders with unchanged fitted geometry
- **THEN** the viewport remains unchanged instead of resetting to Fit

#### Scenario: Update changes diagram dimensions
- **WHEN** a label or relationship edit changes fitted geometry
- **THEN** the presenter retains relative viewport framing and working pan/zoom controls without promising unchanged node coordinates

## MODIFIED Requirements

### Requirement: Mermaid is a presentation adapter
The TypeScript adapter SHALL consume only `ResolvedViewDto`, produce a Mermaid flowchart and preserve all supplied nodes, system boundaries, relationship directions and labels, including parallel relationships. It SHALL render a container tagged `Database` with appropriate presentation without changing its domain kind, escape untrusted labels, use strict Mermaid security, and support existing fit/pan/zoom interactions. The presentation component SHALL accept checked results/updates independently of their host transport, and SHALL NOT fetch DSL, select a view, infer membership, import spike fixture types or make Mermaid-specific IDs the core identities. The same presentation implementation SHALL be used by the extension webview and browser tests.

#### Scenario: Compare Orders and Payment with the spike
- **WHEN** the DSL example's complete explicit view is rendered
- **THEN** it displays the same one person, two system boundaries, five containers and eight labeled relationships as the small Mermaid spike, with comparable styling but no promise of identical pixel layout

#### Scenario: Hostile display text
- **WHEN** model labels contain quotes, angle brackets, pipes, arrows or Mermaid-like directives
- **THEN** those values remain label text and cannot inject new nodes, links, script execution or external requests

#### Scenario: Different hosts use the same presenter
- **WHEN** the webview and browser test harness supply the same checked resolved view
- **THEN** both render through the shared adapter without a product HTTP endpoint or duplicated model rules

### Requirement: Error and recovery state is honest
Within a preview session, a document edit SHALL immediately mark displayed output as pending/out-of-date. Parse, semantic, transport, process and rendering errors SHALL display useful diagnostics and retain the last successfully rendered diagram visibly marked stale. Only successful rendering of the current revision SHALL replace it and clear stale state; older responses/renders SHALL NOT overwrite newer results, pending state or errors. On initial load with no valid diagram, errors SHALL display without fabricating a preview. Within-session webview restoration SHALL preserve last-valid output as specified by the VS Code host; persistence across closed sessions SHALL NOT be required.

#### Scenario: Invalid then valid unsaved edit
- **WHEN** a valid diagram is followed by an invalid unsaved DSL edit and then a corrected edit
- **THEN** the invalid step retains the old diagram marked stale with a source-located diagnostic and the corrected current revision renders the new view without the stale marker

#### Scenario: First load is invalid
- **WHEN** the preview starts with a file that cannot compile
- **THEN** it shows diagnostics without presenting a partial or empty graph as a successfully resolved view

#### Scenario: Rendering fails after a successful diagram
- **WHEN** the current resolved view cannot be rendered by Mermaid or its returned SVG is unusable
- **THEN** the old SVG remains visible with a rendering error and stale indication, and a later valid render can recover

### Requirement: Reproducible project foundation and test-first delivery
The implementation SHALL retain the two-crate Cargo workspace, locked Rust/npm dependencies, documented and pinned toolchains, real DSL example and supported-subset/API documentation, and add the static preview build and VS Code extension package. CI SHALL cover formatting, linting, core/host/transport tests, browser presentation behavior, package contents and supported-platform installed-extension acceptance, with unavailable desktop checks disclosed. Each new behavior or fix SHALL follow an executed failing test, minimum passing implementation and refactoring; unavailable checks SHALL be disclosed. Spikes SHALL remain comparison material, and generated binaries, dependency trees and caches SHALL NOT be committed. Applicable third-party notices SHALL accompany distributed native and preview assets.

#### Scenario: Fresh setup and verification
- **WHEN** a developer or CI follows the documented locked setup and verification commands
- **THEN** it builds the core/CLI/static preview/VSIX, runs contract and integration checks and documents installation/Open Preview without requiring uncommitted generated files or a Vite runtime

#### Scenario: TDD execution is reported honestly
- **WHEN** a behavior is declared implemented
- **THEN** its focused test and integration coverage are available and the handoff records observed red/green checks or explicitly identifies any unexecuted cycle

## REMOVED Requirements

### Requirement: Saved-file manual reload preview
**Reason**: The supported product preview moves into a document-bound VS Code webview with unsaved-buffer updates and a managed stdio service; a Vite-hosted saved-file HTTP endpoint is no longer needed.
**Migration**: Install the target-specific VSIX and invoke `Kontur: Open Preview` beside a DSL file. Keep `kontur view <file.dsl> --view <key>` for explicit saved-file CLI use. Adapt browser tests to the static presenter harness; leave visualization spikes unchanged.
