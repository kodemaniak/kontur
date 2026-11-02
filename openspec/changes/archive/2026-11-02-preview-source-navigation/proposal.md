## Why

The live preview shows architecture elements but does not connect them to their DSL definitions, so users must search the source manually. Source locations and stable IDs already cross the Rust preview boundary; making those links interactive is the next step toward a useful local modeling workflow.

## What Changes

- Add bidirectional navigation between the VS Code preview and its bound `.dsl` document.
- A single click selects a visible element without moving the editor. Double-click or keyboard activation navigates to and selects its source declaration.
- Moving the editor cursor within a visible declaration highlights the corresponding diagram element; moving outside mapped declarations clears that highlight. For nested declarations, the most specific visible declaration wins.
- Limit navigation to people, containers and displayed software-system boundaries. Relationship-edge navigation, multi-file workspaces, LSP navigation and editing the model from the diagram remain out of scope.
- Keep the last valid diagram visible after invalid or pending edits, but do not navigate or map editor selections through its stale source locations.

## Capabilities

### New Capabilities
- `preview-source-navigation`: Bidirectional navigation and highlighting between visible preview elements and source declarations in the bound VS Code document.

### Modified Capabilities

## Impact

- Affects the VS Code extension host and preview webview/presenter, plus unit, browser and packaged-extension integration tests.
- Reuses stable IDs and source ranges already present in Rust preview results; no Rust model, service protocol, or JSON schema change is expected.
- Requires conversion from the core's 1-based Unicode-scalar columns to VS Code's UTF-16 positions at the editor boundary. No new dependencies or runtime services are expected.
