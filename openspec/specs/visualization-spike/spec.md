# Visualization Spike

## Purpose

Provide a reproducible, timeboxed evaluation of visualization approaches for local C4 architecture modeling. The spike uses fixed fixtures and does not implement the production parser, language server, or renderer.

## Requirements

### Requirement: Reproducible isolated experiment
The spike SHALL live under `spikes/visualization/`, with pinned dependencies, a lockfile and documented setup, browser, extension, build and verification commands. It SHALL use fixed fixtures without requiring Rust, a DSL parser or an LSP.

#### Scenario: Fresh checkout
- **WHEN** a developer follows the documented setup using the specified runtime
- **THEN** they can build and launch the experiment using the committed fixtures and dependency lockfile

### Requirement: Representative architecture fixtures
The experiment SHALL provide a small fixture with a person, two system boundaries, nested containers, a database, long labels, parallel relationships and cross-boundary relationships, plus a deterministic approximately 100-node fixture. Elements SHALL carry stable IDs and valid source mappings. Reset SHALL restore the baseline fixture.

#### Scenario: Repeatable update sequence
- **WHEN** the evaluator resets and runs rename, add and remove actions twice
- **THEN** both runs produce the same semantic states, retained elements keep their IDs, and no relationship refers to a deleted element

### Requirement: Evaluate hierarchical rendering
The viewer SHALL use React Flow and ELK.js to display C4 elements, boundaries and labeled relationships, consuming ELK node geometry, edge routes and label positions. The evaluation SHALL record whether boundaries contain their children and whether labels and endpoints remain readable without manual repair.

#### Scenario: Cross-boundary relationship
- **WHEN** the representative fixture is laid out
- **THEN** the renderer maps parent-relative geometry and ELK edge sections into the displayed graph, and the report records any clipping, overlap or incorrect endpoint with evidence

### Requirement: Predictable model updates
The viewer SHALL preserve viewport and surviving selection across scripted updates and retain geometry exactly for changes that do not alter measured dimensions or topology. It SHALL expose explicit re-layout, measure movement after geometry/topology changes, and apply only the latest requested layout revision.

#### Scenario: Non-geometric rename
- **WHEN** a selected element is renamed without changing measured dimensions
- **THEN** its ID, node positions, viewport and selection remain unchanged

#### Scenario: Removal and structural layout
- **WHEN** the selected element is removed
- **THEN** selection is cleared, the viewport is preserved, and displacement of surviving nodes is available for evaluation

#### Scenario: Out-of-order results
- **WHEN** an older asynchronous layout finishes after a newer revision has been requested
- **THEN** the older result does not replace the current view

### Requirement: Last valid preview
The viewer SHALL retain the last valid diagram and visibly mark it stale on a simulated invalid-model update or layout failure. A successful subsequent valid update SHALL clear that indicator.

#### Scenario: Invalid then valid update
- **WHEN** the evaluator triggers invalid input and then a successful valid update
- **THEN** the previous diagram remains visible while stale and the new valid diagram replaces it without a stale indicator

### Requirement: Offline browser and editor hosts
The same viewer SHALL run in a browser and a minimal VS Code webview using locally bundled scripts, fonts, styles and layout worker. The extension SHALL use a restrictive CSP, validate incoming messages and restrict source navigation to known fixture mappings.

#### Scenario: Offline packaged launch
- **WHEN** the built extension is launched with network access disabled after installation
- **THEN** diagrams and worker-based layout function without a CDN, local development server or account

#### Scenario: Unknown navigation target
- **WHEN** the host receives an unknown element ID or a malformed navigation message
- **THEN** it does not open an arbitrary file or execute a command

### Requirement: Selection and source navigation
The viewer SHALL support pan, zoom and keyboard element selection. In VS Code, activating a node SHALL reveal its mapped fixture source range, and selecting a mapped range in the editor SHALL highlight its node without a navigation loop. In the browser, activation SHALL display the source reference.

#### Scenario: Bidirectional navigation
- **WHEN** the evaluator activates a node and then selects a different mapped source range
- **THEN** the extension first opens the correct file/range and then highlights the second node without repeatedly reopening the editor

#### Scenario: Keyboard and themes
- **WHEN** the evaluator navigates by keyboard in light and dark themes
- **THEN** selectable elements have visible focus and selection, and the evaluation records any unreadable text or inaccessible action

### Requirement: Evidence-based timeboxed decision
The spike SHALL end after at most two development days with an adopt, reject or further-investigation report. It SHALL record before/after screenshots, node movement, integration effort, readability and offline/keyboard/theme checks. Initial layout and scripted-update timings SHALL be recorded over five runs for both fixtures with graph sizes, machine/runtime details, individual samples and median/max values; pan/zoom responsiveness during layout SHALL also be assessed. Uncompleted checks SHALL be explicitly marked unverified and block an unconditional adopt recommendation.

#### Scenario: Candidate fails within timebox
- **WHEN** routing, stability or packaging cannot meet the evaluation goals within the timebox
- **THEN** the report records the failure and evidence, recommends rejection or further investigation, and identifies the next experiment instead of declaring success or silently extending scope

#### Scenario: Automated mapping check
- **WHEN** the spike's verification command runs
- **THEN** automated checks cover nested coordinate mapping and preservation of stable IDs/source mappings through layout conversion, with failures returning a nonzero exit status

### Requirement: Distributed licensing information
The spike SHALL keep kontur-owned code MIT-licensed, retain third-party licenses/notices, and select the EPL-2.0 option for the verified ELK.js version. The packaged artifact SHALL include `THIRD_PARTY_NOTICES.md`, required license texts and copyright notices, exact bundled dependency versions and corresponding-source access instructions. Transitive dependencies SHALL be checked before packaging; any distributed ELK modifications SHALL have their corresponding source available under EPL-2.0.

#### Scenario: Package inspection
- **WHEN** the evaluator inspects the built extension package
- **THEN** the notices and required license texts are present, source-access instructions identify the bundled ELK version and any modifications, and the bundle is not described as exclusively MIT
