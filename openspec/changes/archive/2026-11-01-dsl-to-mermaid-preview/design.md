## Context

Only the visualization spikes currently run. Their JSON fixtures mix model records with a preselected view; `small.arch` is not Structurizr DSL. The Mermaid spike's generation/rendering code is useful reference material, but the product must not depend on its fixture types or the whole comparison package.

This change is the first product foundation. It follows Clean Code and Clean Architecture through small cohesive modules and inward dependencies, with TDD at each API boundary. Separate specifications express responsibilities, not a mandate for many crates.

## Goals / Non-Goals

**Goals:**
- Read one real DSL file through our Rust implementation, resolve and validate it, project an explicitly selected container view, and render that view locally with Mermaid.
- Preserve explicit identities and source ranges, distinguish failure categories, and prove that view membership is independent of model existence.
- Establish documented module APIs, a minimal host contract, locked builds, contract tests and basic CI that later LSP/CLI work can reuse.

**Non-Goals:**
- LSP, unsaved edits, watching, source navigation, multi-file includes, full Structurizr support, implicit relationships, arbitrary selectors, production packaging, a service architecture or final renderer adoption.
- A lossless syntax tree, incremental parsing, a generic parser/renderer plugin system, generated SDKs or a separate crate for every module.

## Decisions

### 1. Two Rust crates and a small browser app

```text
Cargo.toml / Cargo.lock / rust-toolchain.toml
crates/kontur-core/src/
  lib.rs                 compile_view composition entry point
  source.rs              source text and spans
  diagnostic.rs          source-diagnostics capability
  parser.rs              structurizr-dsl-parsing capability
  parser.pest            parser-private Structurizr subset grammar
  model.rs               architecture-model capability
  resolve.rs             reference-resolution capability
  validate.rs            model-validation capability
  view.rs                view-projection capability
crates/kontur-cli/src/
  main.rs                file/process boundary and CLI arguments
  protocol.rs            JSON DTOs, serialization and line/column mapping
apps/preview/            Vite + TypeScript + Mermaid, own npm lockfile
examples/orders-payments/workspace.dsl
docs/dsl-subset.md
docs/core-api.md
.github/workflows/ci.yml
```

Start with modules and free functions. Extract crates or introduce traits only when an actual dependency or substitution requires them. The preview needs no React framework and does not import code from `spikes/`. Selectively adapt Mermaid rendering, escaping and viewport behavior, leaving the comparison harness unchanged.

Alternative rejected: grow the spike npm package into the product. That would retain unrelated candidates and make experimental fixture shapes the semantic API.

### 2. Explicit ownership and dependency direction

The following signatures are the initial contracts to implement and document; changing them requires matching spec, caller and contract-test updates. They are not a promise of public semver stability.

| Module | Entry point / owned types | Allowed local dependencies |
| --- | --- | --- |
| `source`, `diagnostic` | `SourceFile`, `SourceId`, `SourceSpan`, `Diagnostic` | No parser, model, host or renderer dependencies |
| `model` | `Workspace`, `ElementId`, `RelationshipId`, `ViewKey`, `Element`, `Relationship`, `ViewDefinition`, `ResolvedView` | Source metadata types only |
| `parser` | `parse(&SourceFile) -> Result<ParsedWorkspace, Vec<Diagnostic>>`; owns unresolved syntax types | Source and diagnostics only |
| `resolve` | `resolve(&ParsedWorkspace) -> Result<Workspace, Vec<Diagnostic>>` | Parser, model, source and diagnostics |
| `validate` | `validate(&Workspace) -> Vec<Diagnostic>` | Model, source and diagnostics; not parser or projector |
| `view` | `project(&Workspace, &ViewKey) -> Result<ResolvedView, Vec<Diagnostic>>` | Model, source and diagnostics; not parser, host or Mermaid |
| `lib` facade | `compile_view(&SourceFile, &ViewKey) -> Result<ResolvedView, Vec<Diagnostic>>` | Composes the stages above |
| CLI protocol adapter | `PreviewResult` DTO and domain-to-DTO conversion | Core and JSON serialization; core never imports the adapter |

`parse` returns owned syntax records with spans and unresolved identifier occurrences; it does not look up names. `resolve` maps those declarations/references to model-owned types, never leaking AST nodes into `Workspace`. Validation checks model meaning rather than token grammar or symbol lookup. Projection consumes an already resolved and validated workspace; the facade enforces this order and calls no later stage after an error. The projector diagnoses a missing view key and rejects invalid selection inputs rather than panicking; callers bypassing the facade must validate first.

```text
CLI / preview host → compile_view
                       │
                 parse → resolve → validate → project
                            │          │          │
                            └──────── model ──────┘
                                   │
                              source metadata

TypeScript → JSON transport contract, never AST internals
```

The core receives text, performs no filesystem/network/process operations, writes no stdout/stderr and imports no UI, serialization or layout engine. Diagnostic formatting and JSON DTOs stay at the host boundary. No generic repository/port abstraction is needed because the core has no I/O to abstract.

### 3. Narrow, explicit Structurizr subset

Support one `workspace` with a `model` and one explicitly keyed `container` view. Elements and relationships require explicit identifiers; identifiers use the default flat namespace. Support `person`, `softwareSystem`, nested `container`, inline name/description/technology fields, a container `tags` statement, `source -> target` relationships with description and optional technology, and explicit `include` identifier lists. Support `//` and `/* ... */` comments, UTF-8 text, quoted strings with escaped quotes/backslashes, and LF/CRLF files. The optional view directive `autoLayout lr` maps to a renderer-neutral left-to-right hint; no manual layout is accepted.

Require `!impliedRelationships false` in the example and accepted workspaces: we do not silently accept Structurizr's implicit-relationship default without implementing it. Anonymous declarations, `include *`, expressions, `exclude`, other view kinds, hierarchical identifiers, includes, scripts, styles and other unsupported constructs produce an explicit unsupported-feature diagnostic. Missing required identifiers/directive/view produce a diagnostic explaining the supported form. Unknown tokens, extra arguments and unclosed strings/blocks are not ignored.

Use `pest` and `pest_derive` with our own `parser.pest` PEG grammar instead of a handwritten lexer/recursive-descent parser. Owning the Structurizr implementation means owning its grammar, syntax representation, diagnostics and semantics, not reimplementing general parsing infrastructure. An explicit grammar is reviewable and avoids maintaining separate lexer machinery. Choose compatible versions and lock them during implementation; no dependency is installed as part of this design decision.

Pest is private to the parser module. Lower its parse tree into our owned `ParsedWorkspace` records before returning, converting Pest byte spans into our source-ID-bearing `SourceSpan` values. `Pair`, `Pairs`, generated `Rule` types and Pest errors SHALL NOT appear in public core signatures, syntax records or diagnostics. The existing `parse(&SourceFile) -> Result<ParsedWorkspace, Vec<Diagnostic>>` API and all downstream dependencies remain unchanged; no parser trait or pluggable backend abstraction is introduced.

The grammar must consume the entire input and handle statement line boundaries deliberately rather than treating every newline as ignorable whitespace. Ordered PEG choices and keyword/identifier boundaries need focused tests, alongside comments, escapes, Unicode and LF/CRLF. Map failures into our diagnostic categories and readable messages; recognizing supported versus known unsupported constructs remains our responsibility, not a generic Pest expectation list exposed to the user. Unsupported-syntax handling must not create a successful partial workspace or swallow otherwise unrecognized input.

Alternative rejected: defaulting to a handwritten lexer/parser merely to avoid a parsing dependency. Pest is justified for this grammar-sized responsibility; it does not supply our architecture model or Structurizr semantics. Pest does not automatically provide incremental parsing or multi-error recovery. Those remain deferred and can be evaluated when editor requirements arrive; initial LSP use could still reparse whole documents. Regex-based whole-file extraction and implementing the complete Structurizr grammar remain out of scope.

The example retains the spike's one person, two systems, five containers and eight labeled relationships. Databases are containers tagged `Database`, not a new domain kind. Relationship identifiers distinguish parallel edges. Explicit `include` can select containers from both systems, as supported by Structurizr's multiple-software-system container-view example. The supported subset document must state both supported forms and restrictions with examples.

### 4. Identities, source data and semantic checks

Use explicit DSL identifiers as stable identity values wrapped in the model-owned `ElementId` and `RelationshipId` types; view keys use `ViewKey`. They do not depend on display names, source offsets, encounter indices or random UUIDs. IDs survive display-label changes, whitespace, comments and reordering independent declarations. Renaming an identifier changes identity in this iteration; cross-file identity and rename tracking are deferred.

The parser permits symbolic forward references; resolution builds declaration tables before resolving relationships, scope and include occurrences. Duplicate declarations and unresolved references are resolver errors. Preserve identifier occurrence spans so errors point to the use, with related definition locations for duplicates. Semantic validation owns container-parent kind, container-view scope kind, supported membership kinds and duplicate view keys. It can be tested using model values constructed without the DSL parser.

`SourceSpan` is a source ID plus a half-open UTF-8 byte range on character boundaries. Human locations are 1-based lines and Unicode-scalar columns, including CRLF handling. Future LSP UTF-16 positions will be a boundary conversion, not a change to stored offsets. Source/diagnostic modules own checked span/location operations; invalid ranges return errors rather than indexing panics. Diagnostics have stable category codes, severity, message, an optional primary span and related spans. Source problems carry a primary span; I/O/process failures may lack one.

### 5. View projection is an explicit selection, not model dumping

`Workspace` owns elements, relationships and view definitions without positions or Mermaid text. `ResolvedView` owns the view key/scope, selected people/containers, their relationships and required system boundaries, with copied stable identities, metadata and source spans. It contains no unselected children merely because their parent boundary is present.

The first subset includes people and containers by explicit IDs. Each selected container contributes its owning software system as a boundary, not a second diagram node. Relationships are included exactly once when both endpoints are selected; labels, technology, direction and IDs are preserved. Boundary records do not themselves add relationship endpoints. This avoids implementing ancestor-edge aggregation or implied relationships.

Projection does not mutate `Workspace`. Deterministic ordering follows declaration order, with duplicate includes deduplicated; collection iteration must not introduce random output ordering. Browser node IDs may use safe renderer-specific tokens, but cannot replace the domain IDs in the contract.

### 6. One JSON contract and manual reload host

The initial CLI operation is `kontur view <file.dsl> --view <key>`. It reads the file, calls `compile_view` and writes exactly one JSON document to stdout:

```text
success: { schemaVersion: 1, status: "ok", view: ResolvedViewDto }
failure: { schemaVersion: 1, status: "error", diagnostics: DiagnosticDto[] }
```

Success exits zero; file, argument, parse, resolution, validation and projection failures exit nonzero without an `ok` view. Stderr may carry a concise human diagnostic but no required machine fields. `ResolvedViewDto` contains `key`, `scopeId`, `elements`, `boundaries`, `relationships` and the optional layout hint. Element kinds are `person` or `container`; system boundaries are separate records. Selected nodes and boundaries carry their original IDs, names, descriptions, tags, technology where applicable and source locations. Relationship records carry ID, endpoint IDs, label, technology and source location. Diagnostic DTOs include code/message/severity and available file/line/column ranges.

The protocol adapter is the only Rust serialization boundary. Keep a Rust-output/TypeScript-consumer contract fixture and runtime checks for schema version, record shapes, unique IDs, known parents/endpoints and success/error exclusivity. TypeScript must reject malformed output rather than relying on a type assertion or inferring view membership. No code generator or transport framework is needed.

A documented development command starts the Vite preview with a fixed file path and view key, building the native CLI before serving. Its development-only `/api/view` endpoint invokes that binary with an argument array, never a shell command assembled from input. Each initial page load or explicit **Reload** reads the current saved file. No watcher or long-lived Rust process is needed. Bind to loopback, accept only the configured file/key, and reject untrusted origins/hosts; browser parameters cannot select arbitrary files or commands. No runtime CDN or external service is used.

The browser adapts only a successful resolved view to Mermaid with strict security settings and escaped labels. A syntax/semantic/transport/render error shows diagnostics; an existing diagram remains visible and stale until a successful reload. On an initial load or full browser refresh there may be no last-valid diagram, in which case show diagnostics alone; no persistence is introduced. Prevent a superseded load/render result from replacing a newer requested result.

Alternative rejected: introduce a production HTTP server or WASM toolchain now. The native CLI plus existing Vite development surface is sufficient, without committing future editor packaging.

### 7. Tests define implementation order

For each behavior, write and run a focused failing test, observe the intended assertion failure rather than a broken test runner, implement the minimum passing behavior, and refactor with green tests. Record red/green commands and any blocked execution in the implementation handoff; do not infer TDD from final coverage alone.

- Unit/contract tests: spans and Unicode locations; parsing versus unsupported syntax; resolver duplicates/forward/missing references; model identity and containment; semantic invalidity; projected membership and endpoint closure.
- Integration tests: CLI JSON output consumed by TypeScript; known error categories and exit status; escaping and hostile label text; fixed-path process invocation.
- Browser acceptance: actual DSL through the CLI into Mermaid, modify saved labels and reload, exclude a node only from the view, invalid edit marks the retained diagram stale, valid recovery clears it, and pan/zoom still work.
- Minimal CI: pinned toolchains, `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, and locked npm install/typecheck/tests/build plus the browser acceptance check. Document the exact runnable commands and keep generated output/caches out of Git.

## Risks / Trade-offs

- [DSL subset mistaken for complete compatibility] → Publish supported syntax, require explicit no-implied-relationships mode, and fail on unsupported input rather than silently losing meaning.
- [PEG choices or whitespace rules hide malformed input] → Test statement boundaries, overlapping alternatives, keyword prefixes and full-input consumption through the public parser contract.
- [Pest adds build dependencies without solving editor recovery] → Lock `pest`/`pest_derive`, keep their types private, and assess actual compile cost and future recovery needs rather than assuming zero cost or automatic incremental parsing.
- [Clean Architecture turns into boilerplate] → One core crate with typed module functions; only the external JSON boundary has DTO conversion.
- [View membership accidentally becomes renderer logic] → Contract tests demonstrate model retention and view exclusion, including an unselected sibling inside a selected system boundary.
- [Mermaid layout changes despite stable semantic IDs] → Guarantee identity and semantic output only; do not promise stable diagram coordinates in this change.
- [Development process bridge becomes an exposed file/command API] → Loopback/fixed inputs, argument-array spawning, origin/host checks and hostile-input tests; no arbitrary path endpoint.
- [Tests written after implementation are labeled TDD] → Explicit red-green-refactor tasks and honest execution notes; a green final suite does not prove the earlier red step.

## Migration Plan

No production data exists to migrate. Add the new workspace/app alongside unchanged spikes, translate the small example to real DSL, and update root instructions. The native development bridge can later be replaced by an editor host or WASM adapter without changing model semantics; neither replacement is part of this change.

## Open Questions

- Final product distribution (native binary versus WASM) and renderer adoption remain open; this change only chooses a development path.
- Precise toolchain/dependency versions will be selected and locked during project initialization using the available supported versions, then recorded in documentation and CI.
