## Context

The Rust preview result already carries stable IDs and source locations for selected people/containers, required software-system boundaries, and relationships. The TypeScript contract validates these locations. The VS Code extension binds one preview session to one local `.dsl` document and sends revisioned snapshots of its unsaved text. The webview currently renders a Mermaid SVG and exchanges only readiness and preview-state messages; it has no diagram-to-editor or editor-to-diagram interaction.

Source locations use 1-based lines and Unicode-scalar columns, while VS Code editor positions use zero-based lines and UTF-16 columns. Element declaration spans can overlap because a software-system declaration encloses nested containers. Preview errors retain the last valid SVG and mark it stale.

## Goals / Non-Goals

**Goals:**
- Let users deliberately navigate from a visible person, container, or system boundary to its declaration in the bound editor.
- Highlight the visible diagram item containing the source editor's active cursor position.
- Keep mappings revision-correct, safe, and accurate for unsaved text and Unicode.
- Preserve renderer independence: stable domain IDs and source ranges remain core data; Mermaid identifiers remain presentation details.

**Non-Goals:**
- Relationship-edge navigation, multi-file source navigation, LSP navigation, source edits from the diagram, or a change to Rust model/service DTOs.
- Navigation through a stale diagram or to a file/path supplied by the webview.

## Decisions

### Reuse the resolved view as the source map

Do not add source ranges to the core or change the preview JSON schema. The extension host derives its navigation map from the already-validated successful result for the active session, keyed by stable element/boundary ID and tagged with that result's revision. The map points only into the session's bound `TextDocument`; the webview sends an ID, not a URI or source range. The host rejects unknown IDs, malformed messages, and requests that do not match the current valid revision. It selects and reveals the mapped declaration without saving or editing the document.

This keeps file access and editor APIs at the VS Code boundary. Adding filesystem/path resolution to the renderer or accepting a webview-provided path would create unnecessary authority and is not needed for the current single-file preview.

### Keep gesture semantics explicit

A single click selects/highlights an item in the diagram but does not move the editor. A double-click requests source navigation; keyboard Enter on a focused item performs the same action. Diagram event handling must distinguish a click gesture from a pan so a drag never navigates. Relationship edges are not interactive in this change.

After source navigation sets the editor selection, the normal editor-selection flow may highlight that item in the diagram. Highlight updates themselves do not change editor state, avoiding a feedback loop.

### Map editor positions to the most specific visible declaration

The host uses the active cursor position in the bound editor and source ranges from the current view. If ranges overlap, select the smallest enclosing visible range so a nested container wins over its enclosing system boundary. If no visible declaration contains the cursor, clear the source-driven highlight. Declarations omitted from the selected view have no diagram target.

Convert the source DTO's 1-based Unicode-scalar columns to VS Code's zero-based UTF-16 positions using the bound document's current unsaved text. Reject a location whose file does not identify the bound document or whose range cannot be represented in that document; do not clamp it to a potentially incorrect target. Keep this conversion in the VS Code host, not the Rust model or Mermaid adapter.

### Keep renderer identifiers behind the preview adapter

The Mermaid adapter already assigns safe generated tokens such as `n0` to semantic IDs. After rendering, the preview layer associates the corresponding SVG node/boundary groups with stable IDs and handles click, double-click and keyboard events through that mapping. It must not interpolate DSL identifiers into Mermaid syntax or treat generated SVG IDs as domain identities. An equivalent renderer can later provide the same ID-based interaction without changing core contracts.

### Treat pending and invalid previews as non-navigable

When an edit starts a newer revision, mark the previous diagram stale as today and immediately make its source map non-actionable. An invalid result keeps the last-valid diagram visible but does not use its old ranges for navigation or cursor highlighting. On a successful current result, replace the mapping and re-evaluate the editor's active cursor so highlighting recovers without requiring the user to move it.

The host and webview both check the relevant revision: the host validates navigation against its current session/map, and the webview applies source-highlight messages only to the corresponding current rendered result. This handles delayed messages and webview recreation without making persisted diagram state authoritative for source navigation.

### Test observable behavior before implementation

Add focused failing tests for gestures, source-range conversion, overlapping declarations, stale/revision rejection and selection clearing before implementing each behavior. Then cover the end-to-end flow in the packaged VS Code extension with unsaved DSL text. Keep the Rust source/DTO contract unchanged unless a test reveals an actual missing source range.

## Risks / Trade-offs

- **Mermaid SVG structure changes can break the ID association.** → Keep association code isolated in the renderer adapter and cover it with tests against the pinned Mermaid renderer; do not expose its SVG IDs outside that layer.
- **Panning can be mistaken for an activation gesture.** → Test that dragging never navigates and distinguish movement from click/double-click in the webview interaction handling.
- **Unicode scalar columns can point at the wrong VS Code character if copied directly.** → Convert at the editor boundary and test supplementary Unicode characters before mapped declarations, as well as multiline/CRLF ranges.
- **Old source ranges can point to unrelated text after an edit.** → Invalidate navigation on pending revisions and require a current valid result before acting.
- **Cursor positions can lie in nested declarations or outside the selected view.** → Prefer the narrowest matching visible range and clear the highlight when no visible range matches.

## Migration Plan

No persisted model or Rust protocol migration is required. The change adds only validated webview/editor interaction messages. Existing preview sessions continue to use the current schema; closing or replacing a session discards its source map with the session.

## Open Questions

None identified for the agreed first slice. Relationship-edge navigation and multi-file source maps remain follow-up decisions.
