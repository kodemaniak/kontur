## Context

The repository currently contains planning documentation and OpenSpec scaffolding, without an application toolchain. The README proposes a two-day visualization experiment before implementing the Rust core. Its audience is the maintainer choosing a renderer for local VS Code modeling and eventual browser reuse.

## Goals / Non-Goals

**Goals:**
- Evaluate nested C4 rendering, labeled edge routing, update stability and responsiveness with React Flow + ELK.js.
- Demonstrate the same viewer offline in a browser and VS Code, including bidirectional source navigation.
- Produce reproducible evidence and distributable license notices sufficient to make a follow-up decision.

**Non-Goals:**
- Rust parser, LSP, real DSL validation, MCP, federation or production extension publishing.
- Graphical editing of the semantic model, a generic renderer abstraction or exhaustive framework comparisons.
- Guaranteed incremental layout for arbitrary graphs; this is a hypothesis to evaluate.

## Decisions

### One isolated TypeScript package

Use `spikes/visualization/` with npm and a committed lockfile, React, TypeScript, React Flow and ELK.js. Use Vite for the browser/viewer bundle and a small extension-host build with esbuild. Record the actual supported Node version and commands in the spike README. Keep the viewer reusable through props/callbacks; do not introduce a monorepo or production package boundaries for this experiment.

Alternative: starting the Rust workspace would tie visualization feedback to unrelated parser work. Fixtures provide the needed input much sooner.

### Small semantic fixture, separate presentation state

Use JSON records for nodes (stable ID, kind, parent ID, title, description/technology), relationships (stable ID, endpoints, label), and fixture-relative source ranges. Supply a small representative fixture and a deterministic approximately 100-node fixture. Source ranges point to bundled fixture source files; their accuracy is maintained by the fixture data, not a DSL parser.

Keep positions, dimensions, routes, viewport and selection outside the semantic records. Scripted mutations retain IDs on rename and remove incident edges when deleting nodes. A fixture reset makes every evaluation repeatable. The fixture contract is internal to the spike, not the future Rust API.

### ELK computes geometry; React Flow presents it

Use ELK Layered with hierarchical layout enabled for cross-boundary relationships. Measure node and edge-label dimensions before layout, map parent-relative coordinates correctly, and render returned edge sections and label positions through custom React Flow edges. Do not replace computed routes with default curves. Parent nodes precede children in React Flow input.

Run layout in a bundled worker. Keep the current diagram visible during layout and apply only the newest requested revision; a late result must not overwrite newer state. Report layout failures while preserving the last valid diagram.

Alternatives: Dagre has documented nested/cross-boundary limitations; Mermaid adds another diagram language and less direct interaction control. Sprotty offers a stronger diagram framework but is a follow-up candidate rather than a second implementation inside this timebox.

### Explicit update policy

For text changes that leave measured dimensions unchanged, retain geometry exactly. For size or topology changes, run ELK and measure displacement instead of claiming existing positions are fixed. Preserve viewport and surviving selection; clear selection when its element is removed. Offer an explicit re-layout action without automatic fit-to-screen on every update. Simulate invalid input through a control that marks the retained view stale; clear that state after the next successful valid update.

### Thin VS Code host

Load the built viewer and assets locally using webview resource URIs and a restrictive CSP. Load the single-file worker using a blob URL permitted by that CSP. No CDN, account, server or network connection is required at runtime.

Use a small validated message contract for view revisions, selection and reveal-source requests. The host resolves stable IDs against known fixture mappings; it must not open arbitrary paths received from the webview. Send model updates through messages rather than replacing webview HTML. A browser callback displays the same source reference; the extension opens the file/range and forwards editor selection back to the viewer without feedback loops.

### Evidence determines adoption

Capture initial and updated screenshots, geometry displacement of surviving nodes in absolute coordinates, and layout and request-to-render timings. Run each fixture's initial layout and scripted updates five times, recording all samples, median/max, graph counts and machine/runtime versions. Assess pan/zoom while layout is running, keyboard selection, light/dark themes, and offline extension operation.

There is no invented production latency SLA. The decision report states observed behavior, failures, integration effort and remaining uncertainty. An adopt recommendation requires readable representative diagrams, correct navigation, offline operation, exact geometry preservation for non-geometric updates and acceptable observed interaction. Reject or further-investigation is a valid spike outcome; unfinished checks must be listed as blockers, never passes. Stop at two development days rather than expanding into custom layout-engine development.

### License obligations travel with the artifact

Verify the pinned packages, select ELK.js's EPL-2.0 option, and record versions, licenses and corresponding-source URLs in `THIRD_PARTY_NOTICES.md`. Include required license texts/notices and this file in the extension package, including relevant transitive dependencies. If ELK is modified, supply the modified corresponding source under EPL-2.0. Kontur-owned integration code remains MIT; the complete bundle must not be described as MIT-only.

## Risks / Trade-offs

- [Nested routing and label placement require substantial glue] → Exercise cross-boundary and parallel edges first; stop and document if the timebox is consumed.
- [ELK reorders unrelated nodes on structural edits] → Measure movement and document the explicit re-layout policy; animation is not proof of stability.
- [Browser success hides worker/CSP failures] → Test the packaged webview early with network access disabled.
- [Fixture source navigation overstates product capability] → Clearly label it as a mapped fixture experiment without DSL parsing or unsaved-text support.
- [Two days is insufficient for every check] → Record incomplete checks and choose further-investigation rather than silently extending scope.

## Migration Plan

No existing runtime or data needs migration. The spike is opt-in and isolated; rejection leaves its evidence as a reference without adopting dependencies into production. Adoption requires a subsequent change defining the production boundary with the Rust core.

## Open Questions

- Is ELK's structural-update movement acceptable for real modeling workflows?
- Is the routing/label adapter small enough to maintain compared with Sprotty's framework integration?
- Do measured timings and webview behavior justify proceeding to a Rust-backed prototype?
