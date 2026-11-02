## ADDED Requirements

### Requirement: Deliberate navigation from diagram to source
The VS Code preview SHALL map each currently rendered person, container and software-system boundary to its source declaration using the resolved view's stable ID and source range. A single click SHALL select/highlight the item without moving the editor. Double-clicking the item or activating it with Enter SHALL reveal and select its declaration in the preview's bound `.dsl` document. Relationship edges are not navigation targets in this capability.

The webview SHALL request navigation by stable ID and rendered revision only. The extension host SHALL resolve the ID against the current valid preview result and bound document; it SHALL NOT accept a source path or range from the webview. Malformed messages, unknown IDs, or requests for a non-current revision SHALL be ignored without opening or changing a document.

#### Scenario: Double-click reveals a visible element declaration
- **WHEN** a user double-clicks a current person, container or system boundary in the preview
- **THEN** VS Code reveals the bound DSL document and selects that item's source declaration without saving or changing its text

#### Scenario: Keyboard activation reveals source
- **WHEN** a user focuses a visible diagram item and presses Enter
- **THEN** the preview performs the same source navigation as a double-click

#### Scenario: Single click does not move the editor
- **WHEN** a user single-clicks a visible diagram item
- **THEN** the item is selected/highlighted in the diagram and the editor selection remains unchanged

#### Scenario: Pan gesture is not navigation
- **WHEN** a user drags the diagram to pan across it
- **THEN** the preview does not navigate to source, even if the drag begins over a diagram item

#### Scenario: Invalid navigation request
- **WHEN** the extension host receives a malformed, unknown-ID, stale-revision, or path-bearing navigation message
- **THEN** it ignores the request and opens no document selected by that message

### Requirement: Editor cursor highlights the corresponding visible item
When the bound DSL document has a current valid preview result, the extension SHALL map the editor's active cursor position to a visible element or boundary whose source range contains that position and SHALL send the matching stable ID to the webview. The webview SHALL highlight that item without changing editor state. If multiple visible ranges contain the cursor, the narrowest range SHALL take precedence. If no visible range contains it, the webview SHALL clear the source-driven highlight. Elements omitted from the selected view SHALL NOT be highlighted.

#### Scenario: Cursor inside a visible declaration
- **WHEN** the editor cursor moves inside a visible person's, container's or system boundary's source declaration
- **THEN** the corresponding diagram item is highlighted without rerendering the view or changing the editor selection

#### Scenario: Nested declarations choose the most specific item
- **WHEN** the cursor is inside a container declaration nested within a software-system declaration
- **THEN** the container is highlighted rather than its enclosing system boundary

#### Scenario: Cursor outside a visible declaration clears the highlight
- **WHEN** the editor cursor moves outside every visible declaration range
- **THEN** the source-driven diagram highlight is cleared

#### Scenario: Omitted element has no diagram target
- **WHEN** the cursor is inside a valid DSL declaration for an element omitted from the current view
- **THEN** no diagram item is highlighted

### Requirement: Source locations are converted and validated at the editor boundary
The extension SHALL interpret source locations as 1-based lines and Unicode-scalar columns and convert them to VS Code's zero-based lines and UTF-16 columns using the bound document's current text. It SHALL act only on locations associated with the bound document and valid ranges in that document; it SHALL NOT clamp an invalid location to a different source position.

#### Scenario: Unicode before a declaration
- **WHEN** a visible declaration follows supplementary Unicode characters on its source line
- **THEN** navigation selects the declaration's exact range in VS Code despite the difference between Unicode-scalar and UTF-16 columns

#### Scenario: Location is not valid for the bound document
- **WHEN** a current result contains a location for another document or a range that cannot be represented in the bound document
- **THEN** the extension does not navigate to an unrelated path or select a clamped range

### Requirement: Stale preview mappings are not interactive
When a newer source revision is pending or its result is invalid, the preview SHALL keep showing the last valid diagram as stale but SHALL NOT navigate or map editor cursor positions using that diagram's outdated source ranges. On a successful current result, the extension SHALL replace the source map and SHALL reevaluate the editor's current cursor so navigation and highlighting resume without requiring another cursor movement. Messages from an obsolete revision SHALL NOT change the current highlight or source selection.

#### Scenario: Pending edit disables stale navigation
- **WHEN** a source edit marks the last valid diagram stale while the newer revision is being compiled
- **THEN** the diagram remains visible, but activating one of its old source mappings does not move the editor

#### Scenario: Invalid edit retains but does not use old locations
- **WHEN** the current DSL edit produces diagnostics and the prior diagram remains visible as stale
- **THEN** editor cursor movement does not highlight from the old source map and diagram activation does not navigate through it

#### Scenario: Valid recovery restores mapping for the current cursor
- **WHEN** a later revision compiles successfully while the editor cursor is already inside a visible declaration
- **THEN** the new diagram is current and the corresponding item is highlighted without requiring the cursor to move

#### Scenario: Obsolete selection message is ignored
- **WHEN** an editor-selection message for an older rendered revision arrives after a newer result
- **THEN** the webview keeps the highlight state for the newer result
