## ADDED Requirements

### Requirement: Document-bound preview command
The extension SHALL register `kontur.openPreview` with title `Kontur: Open Preview` for an active local file-backed `.dsl` document. It SHALL open one preview beside that document and bind the session to its URI. Repeating the command for the bound document SHALL reveal the existing preview without adding a process. Opening another supported document explicitly SHALL replace the session and clear the prior document's presentation; editor focus changes alone SHALL NOT retarget it. Missing/unsupported documents SHALL produce a useful message without spawning Rust. The extension SHALL NOT modify source files.

#### Scenario: Open beside the selected source
- **WHEN** a supported DSL document is active and the command is invoked
- **THEN** a side-by-side preview displays that document's sole view, and invoking the command again reuses it

#### Scenario: Focus is not document selection
- **WHEN** a bound preview exists and focus moves to another editor or the webview
- **THEN** the preview continues to follow its original document until an explicit Open Preview command selects another supported document

#### Scenario: Unsupported command context
- **WHEN** the command is invoked without an active local `.dsl` document
- **THEN** it explains the supported input and creates neither a preview session nor a native process

### Requirement: Unsaved snapshot updates with bounded pending work
The extension SHALL read the bound `TextDocument` initially and on relevant content changes, including unsaved changes. It SHALL debounce edits for a short fixed delay, without requiring a save, filesystem watcher, manual reload or view-key configuration. It SHALL invalidate the displayed revision immediately on an edit, allow at most one service request in flight, and retain only the newest pending snapshot. Intermediate edits SHALL NOT create an unbounded request queue. Changes to unrelated documents SHALL NOT trigger compilation.

#### Scenario: Unsaved relationship update
- **WHEN** the example's relationship label is edited and the debounce elapses without saving
- **THEN** the preview displays the new label and the on-disk file still contains its previous text

#### Scenario: Rapid edits coalesce
- **WHEN** several changes occur while a request is in flight
- **THEN** the old request completes without spawning more processes and only the newest remaining snapshot is subsequently submitted

### Requirement: Newest revision controls visible output
The extension SHALL correlate responses to the active session, document URI and requested revision, and discard superseded responses. The presenter SHALL invalidate pending renders on newer updates or host failures and check render generation before committing an SVG. A response that was current when sent but obsolete after an unsent newer edit SHALL NOT be accepted. Old successes and errors SHALL NOT overwrite the current session's status or diagram.

#### Scenario: Older valid result arrives before a newer invalid request is sent
- **WHEN** an edit creates a newer document revision while a previous valid compilation is still running
- **THEN** the previous result does not clear pending/stale state or become current, and the newer snapshot's eventual diagnostic determines the error state

#### Scenario: Slow rendering finishes late
- **WHEN** an older Mermaid render completes after a newer result or host failure has been received
- **THEN** it does not replace the diagram or clear the newer status

### Requirement: Webview readiness and session restoration
The extension SHALL initialize the HTML shell once and deliver updates through validated messages. It SHALL wait for a webview-ready message before delivering presentation state and restore the session's last-valid diagram, current pending/error status and viewport when the webview is recreated within the same open panel. Hiding the preview SHALL NOT dispose its session. Closing/replacing the session SHALL NOT leak its diagram into another document. Persistence across VS Code restarts SHALL NOT be required.

#### Scenario: Initial compilation beats webview startup
- **WHEN** Rust finishes before the webview announces readiness
- **THEN** the latest session state is delivered after readiness and the preview does not remain empty from a lost message

#### Scenario: Hidden stale preview is revealed
- **WHEN** a valid zoomed/panned preview encounters an error and is then hidden and revealed
- **THEN** the prior valid diagram and viewport are restored with the current stale/error indication rather than an empty or apparently current diagram

### Requirement: Managed native-process lifecycle
The extension SHALL start exactly one bundled `kontur preview-service` child per active preview session using an argument array and no shell. It SHALL enforce a 30-second response deadline and bound retained stderr to 64 KiB while draining both streams. Spawn failure, unexpected exit, protocol failure or timeout SHALL stop the child and produce an actionable preview error without losing last-valid output. A repeated Open Preview command for the same document after a service failure SHALL explicitly restart processing of the latest buffer without a restart loop. Panel disposal, document closure, session replacement and extension deactivation SHALL cancel work/listeners and terminate the child within a bounded shutdown period; callbacks from disposed sessions SHALL have no effect.

#### Scenario: Close while compilation is running
- **WHEN** the preview closes with an active request or queued debounce
- **THEN** its child terminates, timers/listeners are released and late callbacks neither recreate the preview nor update another session

#### Scenario: Service fails and the user retries
- **WHEN** the service crashes or exceeds the response deadline after a valid diagram, and the user invokes Open Preview again
- **THEN** the failure leaves that diagram visibly stale and the explicit retry starts one replacement service with the current text

### Requirement: Restricted webview and process capabilities
The webview SHALL load only packaged required resources through VS Code resource URIs and restricted local resource roots under a restrictive content security policy. It SHALL use validated message passing rather than direct filesystem/process access or a local HTTP API. Messages or DSL content SHALL NOT select executable paths, issue arbitrary commands, read arbitrary files or inject executable HTML/script. The initial extension SHALL declare untrusted workspaces unsupported, letting VS Code prevent activation there.

#### Scenario: Hostile content or message
- **WHEN** source labels contain script-like content or the webview sends an unknown/file/command request
- **THEN** labels remain inert text and the host rejects the message without launching a command or opening a file

#### Scenario: Restricted workspace
- **WHEN** the repository is opened without workspace trust
- **THEN** VS Code treats the extension as unsupported in Restricted Mode and no Rust process is started
