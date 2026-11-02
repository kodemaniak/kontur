## Context

The product currently has two Rust crates and `apps/preview`, with no product VS Code extension. `kontur-core::compile_view` composes parse, resolve, validate and project; `kontur view <file.dsl> --view <key>` reads disk and serializes a version-1 `PreviewResult`. The browser app uses a Vite-only HTTP bridge and manual Reload. Its Mermaid escaping, checked DTO contract, last-valid rendering and relative viewport preservation are reusable.

The grammar already accepts exactly one keyed container view. This change does not broaden that subset to support a view picker. The development host is Linux x86-64. The extension must work after VSIX installation without Cargo, Node.js installed separately, network access or a development server.

Baseline checked before implementation: the active development host is Ubuntu 26.04.1 x86-64 with glibc 2.43, Rust 1.94.1, Node.js 26.12.1 and desktop VS Code 1.144.0. This first package's verified support claim is limited to this Linux x64/glibc baseline and VS Code 1.144.0 or newer; it is not evidence for older Linux distributions or other targets. A desktop session is available for the VS Code smoke. The existing browser E2E baseline could not bind its fixed port 5173 because the developer's preview server already occupies it; leave that process untouched and use an isolated test port/harness for subsequent checks.

## Goals / Non-Goals

**Goals:**
- Preview the active local `.dsl` document beside its editor and follow its unsaved contents.
- Keep all language/model processing in Rust, with a managed persistent process and a small checked stdio contract.
- Reuse presentation code across the webview and its browser tests, preserving honest stale/recovery state and best-effort viewport continuity.
- Ship and test a self-contained `linux-x64` VSIX, replacing the product Vite server/build wiring.

**Non-Goals:**
- LSP, Problems-panel diagnostics, source navigation, multiple views/files, graphical editing, new layout algorithms or guaranteed node positions.
- A supported standalone browser app, HTTP/WebSocket service, WASM, generic transport/renderer framework, automatic crash-restart policy or user-configurable executable path.
- Other platform releases, Marketplace publishing, validated Remote/WSL/container operation, untrusted workspaces, or persistence across VS Code restarts. Unsaved edits to existing local files are included; untitled and non-file documents are deferred.

## Decisions

### 1. Thin workspace extension, separate presentation, existing Rust crates

```text
VS Code TextDocument                         VS Code webview
  URI + unsaved text                             Mermaid / SVG
        |                                             ^
        v                                             | postMessage
apps/vscode: command, session, child process ---------+
        |
        | bounded JSON lines on stdin/stdout
        v
kontur preview-service
  protocol DTOs -> compile_single_view(&SourceFile)
                         |
                  parse -> resolve -> validate -> project
                                    model / source
```

Add `apps/vscode` for the manifest, extension-host code, process/session tests and packaging. Keep `apps/preview` as the small presentation source/build/test package; it supplies browser assets, not an HTTP application. Import the existing contract validation and Mermaid adapter rather than copy them. The existing spikes remain unchanged reference material, not dependencies.

Declare the extension as a workspace extension (`extensionKind: ["workspace"]`) so the process naturally follows the extension host rather than a hard-coded UI-machine address. This is structural compatibility, not a claim of tested remote support. Declare untrusted workspaces unsupported using VS Code's manifest capability rather than invent a trust mechanism. No new Rust crate or generic host trait is required.

Alternative rejected: hosting the webview through Axum. VS Code already loads local resources and carries messages; a listening socket would add port, authorization, readiness and remote-forwarding concerns without serving a current requirement.

### 2. Pure single-view composition, not TypeScript view discovery

The core exposes both:

```rust
compile_view(&SourceFile, &ViewKey) -> Result<ResolvedView, Vec<Diagnostic>>
compile_single_view(&SourceFile) -> Result<ResolvedView, Vec<Diagnostic>>
```

Both reuse the same parse -> resolve -> validate pipeline, stopping on errors before projection. The new entry point selects the sole validated `ViewDefinition` and invokes the existing projector. Zero or multiple views never select a default: the existing grammar can reject those sources first with its source-located subset/syntax diagnostic; a defensive cardinality check in composition handles any otherwise representable case. Do not expand the parser merely to count unsupported views or introduce a new public compilation framework.

Core ownership and allowed dependencies remain unchanged: source/diagnostics are shared metadata; parsing owns syntax; resolution produces the model; semantic validation owns model invariants; projection owns membership. The composition facade owns ordering and single-view selection. It accepts text through `SourceFile`, returns model records or existing typed diagnostics, and has no filesystem, process, JSON, VS Code or Mermaid dependency.

### 3. One persistent stdio service, no LSP or HTTP

Add `kontur preview-service` to the existing executable. Keep the current file-based `view` command, output schema and exit behavior unchanged. Reuse `protocol.rs` result conversion; service envelopes are host-owned serialization types, not domain types.

Each UTF-8 line is one JSON request or response. Literal newlines in source text are JSON-escaped, so transport chunk boundaries and multiline DSL are unrelated.

```typescript
type PreviewRequest = {
  schemaVersion: 1;
  revision: number;
  documentUri: string;
  text: string;
};
type PreviewResponse = {
  schemaVersion: 1;
  revision: number;
  documentUri: string;
  result: PreviewResult; // Existing version-1 success/error DTO.
};
```

`revision` is a positive, monotonically increasing JavaScript-safe integer assigned by the extension session, not an offset or timestamp. `documentUri` is a nonempty source identity supplied by the extension. Rust treats it as an opaque name/ID and never opens it. Successful view locations and diagnostic locations identify this URI and the supplied snapshot; the existing one-based Unicode-scalar location convention remains unchanged.

The service processes requests sequentially, flushes one correlated response per valid request, and retains no authoritative workspace state between snapshots. Compilation errors are normal `result.status: "error"` responses and do not end the service. Invalid JSON, unknown envelope versions/fields, invalid field types or oversized/incomplete frames are fatal protocol failures: report a concise reason on stderr and exit nonzero without fabricating a correlated success. Clean stdin EOF between frames exits successfully. Stdout contains protocol frames only; stderr contains bounded operational diagnostics, not source dumps.

Use a 5 MiB maximum encoded frame size in each direction and a 30-second response deadline, following the current bridge's resource limits. Enforce frame bounds while receiving and before writing, not after unbounded buffering. An oversized outgoing result is a host failure, not a truncated view. The extension validates the envelope/correlation and the existing nested result contract. No schema generator or JSON-RPC library is needed.

Alternative rejected: spawning per edit. It remains viable, but a single process per preview session matches the requested service lifecycle and provides a direct future host seam. This choice does not pre-decide the LSP transport or implement caching/incremental parsing.

### 4. One document-bound preview session per window

`kontur.openPreview` captures the active local `.dsl` document before creating the side panel. Repeating the command for that document reveals the existing panel. Invoking it for another supported document replaces the session and clears its old diagram/state; switching editor focus alone never retargets the preview. Unsupported/no active documents produce a useful command message without starting a process.

The extension reads `TextDocument.getText()` initially and after `onDidChangeTextDocument`, not filesystem watchers or save events. It neither saves nor rewrites the source. A 200 ms debounce is an initial implementation constant, not a new setting.

On every relevant edit, increment the revision immediately and notify the webview that the shown diagram is no longer current. Allow one in-flight request and retain only the newest pending snapshot; intermediate edits replace that pending work. If a response's URI/revision/session no longer matches, discard it even if newer work has not yet been sent. After completion, send the newest snapshot once its debounce has elapsed. This bounds backlog and prevents briefly accepting an old valid result during an invalid/newer edit.

The extension spawns only the packaged executable using an argument array with no shell. Drain stdout/stderr; cap retained stderr at 64 KiB. Spawn failure, unexpected exit, malformed output, correlation that does not match the in-flight request or timeout terminates the session's process and reports a host/transport error while preserving last-valid output. An expected response to a superseded request is discarded normally, not treated as protocol corruption. Do not loop on automatic restarts. Reinvoking Open Preview after such a failure starts a fresh service and resubmits the current snapshot without clearing an existing last-valid diagram for the same document.

On panel disposal, source-document closure, session replacement or extension deactivation, cancel timers, detach listeners, invalidate callbacks and stop the process. Close stdin, then use bounded termination escalation if necessary (one second before termination, another second before forceful kill on Linux). Do not spawn detached processes or leave child work running behind a closed preview. Hiding a panel is not closing it.

### 5. Static webview resources and a small presentation API

Refactor the current DOM/rendering entry point into presentation operations such as:

```typescript
mountPreview(root: HTMLElement): {
  markPending(revision: number): void;
  applyResult(revision: number, result: PreviewResult): Promise<void>;
  showHostError(message: string): void;
  dispose(): void;
};
```

The concrete module names are implementation details; these responsibilities are not a generic renderer interface. The presenter owns Mermaid conversion, diagnostics, render-generation checks and viewport state. It never parses DSL, chooses view membership or opens documents/processes. The extension host owns document/service revisions; the webview independently rejects obsolete asynchronous renders.

Load `webview.html` once. Use `asWebviewUri` and restricted `localResourceRoots` for packaged assets, `enableScripts` for Mermaid, a restrictive CSP and a private `acquireVsCodeApi()` handle. No source labels are interpolated into the HTML shell. Existing Mermaid strict mode, escaping and safe diagnostic text handling remain required. Validate webview messages; the webview cannot choose executable paths, request arbitrary file access or invoke commands.

Use a small message union: webview-to-host `ready`, and host-to-webview `pending`, `result`, `host-error`, carrying revisions where applicable. The host sends the latest state only after `ready` and replays it after webview recreation. Use `getState`/`setState` for the last successfully rendered view, its document identity and viewport. Restore that view before applying the host's latest pending/result/error state, so even a later Mermaid failure cannot erase the last displayable diagram on hide/reveal. Validate restored state and never restore another document's view. Do not add restart serialization or use `retainContextWhenHidden` as a blanket workaround.

Show pending/stale state from the first unsent edit until a current revision renders successfully. Compilation, transport and Mermaid failures retain the prior SVG; an initial error shows diagnostics with no invented graph. Update the SVG only after a complete successful render. Preserve relative viewport center and zoom using the existing reload calculation; unchanged geometry preserves the same viewport, geometry changes preserve relative framing, and only initial load or explicit Fit fits the diagram. Mermaid can still move nodes on a label/topology change.

### 6. Build-time bundling without a product Vite server

Use a small esbuild-based static build for the extension host and the Mermaid webview assets. `apps/preview` continues to own the presentation source and tests; `apps/vscode` assembles those built assets into the VSIX. Keep the existing separate npm packages/lockfiles rather than introduce a workspace migration or published frontend library.

Remove product `devBridge.ts`, its HTTP-specific tests/configuration, and Vite-specific build/dev wiring once equivalent acceptance coverage is available. Preserve meaningful contract, escaping, browser rendering and ordering tests by adapting their harness. A test-only static server is acceptable; it is not shipped or required by the installed extension. Existing Vitest tests may retain Vite transitively as a development-only test dependency; eliminating that transitive dependency is not the objective.

Alternative rejected: keeping an invisible Vite server inside the VSIX. Static packaged assets make offline installation/runtime and process ownership much simpler.

### 7. Explicit first-platform packaging and release boundary

Build `kontur` in release mode for `x86_64-unknown-linux-gnu`, package with VS Code target `linux-x64`, and place the executable at a fixed extension-relative path with its executable permission preserved. All assets and the binary come from the same source checkout and locked dependencies. Check the extension host OS/CPU and report unsupported environments before spawning; publish no universal package that implies native support everywhere.

The build must record its Linux/glibc baseline and smoke-test installation on that supported baseline. Do not claim Alpine/musl support from an x64 CPU match alone. Users need neither Cargo nor a separately installed Node runtime, and activation never downloads/compiles the binary. VS Code supplies the extension-host runtime.

Future platforms can add native CI builds or cross-compilation plus their matching VSIX targets under the same extension identity/version. `vsce --target` packages and labels an artifact; it does not compile Rust. No matrix is built in this change. Browser-only VS Code cannot run this native process.

Generate notices for all distributed Rust and JavaScript dependencies, including license texts and required notices. Carry the existing Mermaid/transitive ELK EPL-2.0 source instructions into the packaged notices, verify the actual locked versions, and include corresponding source for any distributed ELK modifications. Do not describe the whole VSIX as MIT-only. The packaging file allowlist excludes fixtures, test tools, caches, source workspaces and development servers unless a required license/source obligation needs them.

### 8. Test-first boundary checks and installed-artifact acceptance

Each behavioral task starts with a focused failing test, runs to the intended assertion failure, implements the smallest passing behavior, then refactors with green tests. Record observed red/green checks and any blocked execution.

- Core tests: inferred single-view selection, missing/multiple/unsupported input, stage failure behavior, explicit-key CLI compatibility and unchanged IDs/source ranges.
- Process/contract tests: multiple requests in one service, valid -> invalid -> valid recovery, Unicode/multiline/chunked frames, snapshot text differing from disk, correlation, malformed/version/size handling and EOF.
- Extension tests: command/document binding, dirty buffers, debounce/coalescing, response/render races, panel readiness, visibility replay and bounded child-process cleanup, using controllable process/timer seams rather than real sleeps where possible.
- Browser tests: actual Rust results through the shared presenter, escaping/CSP behavior, last-valid output, initial errors, delayed renders, fit/pan/zoom and viewport preservation.
- Installed VSIX smoke: launch real desktop VS Code with an isolated profile/extensions directory, install the built package, open the example, invoke the command, edit without saving, inspect the webview update, exercise invalid/recovery and verify child shutdown. Use Playwright-based UI automation where practical; a manual fallback must record evidence and remain an explicitly unautomated acceptance check, not a passing automated test.
- CI runs Rust formatting/lint/tests, locked npm install/typecheck/tests/static builds, browser tests, package-content checks and the supported-platform VSIX smoke in a desktop-capable environment. Tool downloads belong to build/test setup, never extension activation/runtime.

## Risks / Trade-offs

- [Mermaid relayout moves nodes despite viewport preservation] -> Preserve framing and identity, test both equal-geometry and changed-geometry updates, and state that stable node coordinates remain out of scope.
- [Multiple asynchronous layers admit stale output] -> Invalidate on edit, correlate session/URI/revision, bound queued work, and check render generations before committing an SVG.
- [Webview recreation loses last-valid output or viewport] -> Retain session state in the host, replay after ready, and restore the small viewport state independently of current error state.
- [A bundled executable fails on an older Linux libc] -> Record the build baseline and test the installed release there; do not infer compatibility from `linux-x64` alone.
- [Service failure or disposal leaves a child running] -> No detached children, bounded termination escalation and process-level lifecycle tests, including timeout/crash paths.
- [Replacing Vite accidentally removes useful tests] -> Port contract/render/acceptance cases first; remove only the retired HTTP bridge tests, retaining unchanged spikes.
- [Packaged frontend omits dynamically loaded Mermaid assets or violates CSP] -> Check the exact VSIX contents and exercise the bundled resources/CSP in the actual installed-VSIX smoke. Run the bundled Rust service with network syscalls denied and no external `PATH`; a network namespace around the entire VS Code GUI is optional, not an acceptance gate.
- [Extension integration expands into a language server] -> Show diagnostics in the preview only and reuse Rust checks; defer editor-language features and UTF-16 navigation conversion.

## Migration Plan

1. Add and test the single-view facade and additive stdio command without changing the existing CLI.
2. Decouple presentation from fetch/manual reload, preserving existing test behavior in a static harness.
3. Add extension sessions, packaging and the installed-VSIX acceptance path; then retire the product Vite bridge/workflow.
4. Update root instructions, API/subset docs and repository status to describe the extension as the new preview entry point and list remaining milestone gaps. No user model/source format migration is needed.

If integration fails, retain the additive Rust work and fix the preview integration rather than silently ship a VSIX that needs a dev server. Normal Git review can separate or revert this change; source files are never migrated to another authority.

## Open Questions

- Can the installed-webview smoke run reliably in the repository's CI desktop environment? Establish that early; report any manual-only step and its evidence explicitly rather than substituting browser tests for VS Code acceptance.
