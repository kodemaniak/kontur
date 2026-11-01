## 1. Minimal project foundation

- [x] 1.1 Initialize the Cargo workspace with `kontur-core` and `kontur-cli`, lock a supported Rust toolchain/dependencies including compatible `pest`/`pest_derive` versions, and add compileable API/type shells from `design.md` without behavioral implementation or extra crates.
- [x] 1.2 Initialize `apps/preview` with locked Node/npm requirements, TypeScript/Vite/Mermaid and a runnable unit-test harness; leave spike packages unchanged and ignore generated output.
- [x] 1.3 Translate the small Orders/Payment fixture into real `examples/orders-payments/workspace.dsl`, preserving one person, two systems, five containers and eight named relationships, with database tags, explicit no-implied-relationships mode and explicit view includes.

## 2. Source and diagnostics contract

- [x] 2.1 Red: Add focused tests for byte spans, Unicode/CRLF human locations, invalid span errors and structured diagnostic categories; run them and confirm the intended behavior failures.
- [x] 2.2 Green: Implement the minimal checked source/diagnostic operations with no I/O until those tests pass.
- [x] 2.3 Refactor: Keep shared types independent of parser/model/hosts and rerun the focused tests, recording any unexecuted red/green checks.

## 3. DSL syntax boundary

- [x] 3.1 Red: Add parser contract cases for supported declarations/view syntax, unresolved forward references, source spans, comments/escaped text, statement boundaries under LF/CRLF, keyword prefixes/ordered-choice cases, missing required forms, unsupported constructs, trailing tokens and truncated input; establish each focused failure before implementing it.
- [x] 3.2 Green: Implement the minimal `parser.pest` grammar using `pest`/`pest_derive` per failing case, lower the parse tree into our owned `ParsedWorkspace`/`SourceSpan` types, and translate errors into readable categorized diagnostics without semantic lookup, unconsumed input or successful partial output.
- [x] 3.3 Refactor: Keep Pest tree/rule/span/error types private behind the unchanged parser API, keep syntax types independent of `model`, rerun parser/source contract cases and document the supported grammar and restrictions in `docs/dsl-subset.md`.

## 4. Domain types and reference resolution

- [x] 4.1 Red: Add resolver/model contract tests for declaration-order independence, display-rename/comment identity stability, metadata/source preservation, distinct parallel edges, duplicate declarations and unknown endpoint/view/include references; run the focused failures.
- [x] 4.2 Green: Implement the model-owned records and resolver mapping required by those cases, keeping AST types out of the workspace and preserving view definitions for later validation.
- [x] 4.3 Refactor: Separate symbol lookup from semantic validation, preserve deterministic ordering/diagnostics, and rerun source/parser/resolver tests.

## 5. Semantic validation boundary

- [x] 5.1 Red: Construct workspaces without parsing and test valid invariants, wrong/missing container parents, dangling references, wrong-kind view scopes/members, duplicate view keys and allowed cross-system container includes; run the focused failures.
- [x] 5.2 Green: Implement `validate` as a pure model operation returning diagnostics without mutation, parsing, projection or inferred repairs.
- [x] 5.3 Refactor: Remove duplicated resolver/validator responsibility and verify validation tests need neither AST nor host dependencies.

## 6. Explicit view projection

- [x] 6.1 Red: Test selected versus unselected siblings, required boundaries for both systems, deduplicated includes, retained parallel edges, endpoint closure, unchanged full model, deterministic output and missing-view errors; run focused failing tests.
- [x] 6.2 Green: Implement `project` to return only the selected view, copied stable IDs/metadata/source and required parent boundaries, with no geometry or Mermaid syntax.
- [x] 6.3 Refactor: Keep projector dependencies limited to model/source/diagnostics and rerun the core contracts, including model retention after view exclusion.

## 7. Core orchestration and CLI transport

- [x] 7.1 Red: Add facade/CLI tests for the real example, view-key selection, each stage's error path, file/argument failures, versioned exclusive success/error JSON and process exit status; run the focused failures.
- [x] 7.2 Green: Implement `compile_view` with ordered short-circuiting and the thin `kontur view <file> --view <key>` CLI, with DTO serialization and human-location formatting only at the host boundary.
- [x] 7.3 Red: Capture actual Rust output for a TypeScript contract test and add consumer failures for malformed JSON, unsupported versions, invalid record shapes, duplicate IDs, missing parents/endpoints and inconsistent result shapes; run focused failing tests.
- [x] 7.4 Green: Implement minimal runtime transport checks and the shared contract fixture without code generation or domain logic in TypeScript.
- [x] 7.5 Refactor: Document signatures, type ownership, input/output/error shape and dependency directions in `docs/core-api.md`; rerun core/CLI/consumer tests.

## 8. Local host and Mermaid adapter

- [x] 8.1 Red: Test the fixed-path/key development endpoint, argument-array invocation, fresh saved-file reads, process/protocol failure handling and rejection of untrusted host/origin or arbitrary file/command overrides; run focused failures.
- [x] 8.2 Green: Add the minimal loopback Vite development bridge and start command that builds/invokes the native CLI; no persistent Rust server, watchers or browser-selected paths.
- [x] 8.3 Red: Test resolved-view-to-Mermaid conversion for both boundaries, all selected nodes/parallel labels, tagged databases and hostile quotes/HTML/pipes/directive-like text; establish the intended failures.
- [x] 8.4 Green: Implement the renderer adapter and selectively reuse spike rendering/viewport behavior with strict Mermaid security; do not import spike fixture types or change Rust view semantics.
- [x] 8.5 Red: Test initial errors, stale last-valid retention, valid recovery and rejection of superseded responses/renders; run focused failures.
- [x] 8.6 Green: Implement explicit Reload, diagnostics and honest current/stale states; preserve fit/pan/zoom without adding live updates or cross-session persistence.
- [x] 8.7 Refactor: Separate process/transport, Mermaid generation and UI responsibilities and rerun their tests, including hostile-input cases.

## 9. Actual end-to-end acceptance

- [x] 9.1 Red: Add a browser test that invokes the real Rust CLI on a temporary copy of the DSL example, edits a name/relationship label and reloads, removes a view member without removing the model record, and checks invalid/stale/recovered states plus pan/zoom; run it and identify any acceptance failures.
- [x] 9.2 Green: Make only the missing cross-boundary fixes required for the acceptance test to pass; do not substitute hard-coded fixture responses or bypass Rust.
- [x] 9.3 Refactor: Rerun all contract/integration/browser cases, compare the initial example visually with the small Mermaid spike, and record evidence/remaining readability limits without promising identical layout or adopting Mermaid permanently. Visual review confirms the selected view/boundaries/labels render similarly; fit produces a wide overview with compact labels, so zoom is needed (also recorded in README).

## 10. Reproducibility, CI and handoff

- [x] 10.1 Add minimal CI using the selected pinned toolchains and locked installs for `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, preview typecheck/unit tests/build and the browser acceptance test.
- [x] 10.2 Document exact clean setup/start/reload/test commands, the supported subset/API contract and deferred behavior; update root README/AGENTS status and include applicable third-party license notices for distributed preview assets.
- [x] 10.3 Execute the complete documented checks and inspect the Git diff for generated output or accidental spike changes; report red/green execution evidence, any skipped checks and known limits before marking the change complete.

Behavioral groups above are repeated as small red-green-refactor cycles per case, not one large implementation after a batch of tests. API shells may make tests compile; they must not preimplement the behavior whose test is meant to fail. Pure metadata/configuration changes need no artificial failing test, but their validation/build checks still apply.
