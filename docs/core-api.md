# Rust core and CLI contracts

The Rust core accepts source text and returns owned, renderer-neutral records. It performs no filesystem, process, network, stdout or renderer I/O. The CLI owns file access, command arguments, JSON DTOs and human line/column formatting. These are initial internal APIs, not a stable public SDK.

## Module boundaries

| Module | Public contract | Owns | Depends on |
| --- | --- | --- | --- |
| `source` | `SourceFile`, `SourceId`, `SourceSpan`, `SourceLocation`, checked span/location methods | UTF-8 byte ranges and 1-based Unicode-scalar locations | Standard library |
| `diagnostic` | `Diagnostic`, `DiagnosticCode`, `Severity`, `sort_diagnostics` | Stable error categories and related locations | `source` |
| `parser` | `parse(&SourceFile) -> Result<ParsedWorkspace, Vec<Diagnostic>>` | Pest grammar, Pest tree lowering and unresolved syntax records | `source`, `diagnostic` |
| `model` | `Workspace`, typed IDs, `Element`, `Relationship`, `ViewDefinition`, `ResolvedView` | Semantic records, stable explicit IDs, containment, source metadata | `source` |
| `resolve` | `resolve(&ParsedWorkspace) -> Result<Workspace, Vec<Diagnostic>>` | Identifier tables and symbolic-reference lookup | `parser`, `model`, `source`, `diagnostic` |
| `validate` | `validate(&Workspace) -> Vec<Diagnostic>` | Resolved model/view invariants | `model`, `source`, `diagnostic` |
| `view` | `project(&Workspace, &ViewKey) -> Result<ResolvedView, Vec<Diagnostic>>` | Explicit membership, boundaries and relationship closure | `model`, `source`, `diagnostic` |
| core facade | `compile_view(&SourceFile, &ViewKey) -> Result<ResolvedView, Vec<Diagnostic>>` | Ordered parse → resolve → validate → project composition | Core modules above |

`ParsedWorkspace` and its syntax records are owned by `parser`; Pest `Pair`, `Rule`, spans and errors are private. `Workspace` never contains AST nodes, transport DTOs, layout geometry or Mermaid data. The resolver diagnoses duplicate and unknown declarations/references but does not perform semantic validation. The validator can be called with directly constructed model values. Projection expects a validated model; it defensively reports missing keys and invalid selected members rather than panicking.

Identifiers are explicit DSL strings wrapped in `ElementId`, `RelationshipId` and `ViewKey`. Renaming a display name does not change identity; renaming the identifier does. Source spans use half-open UTF-8 byte offsets and retain their `SourceId`. Convert to future LSP UTF-16 positions only at that host boundary.

Stable diagnostic code strings are `syntax`, `unsupported-feature`, `duplicate-identifier`, `unknown-reference`, `semantic`, `view-not-found`, `host` and `transport`. Source-derived diagnostics have a primary span; host diagnostics such as a file-read error may omit it. Diagnostics are ordered by source ID, byte offset and code.

## CLI JSON boundary

```sh
kontur view examples/orders-payments/workspace.dsl --view orders-payments
```

The command writes exactly one JSON document to stdout. Exit code is zero only for success; errors exit nonzero and never include a partial `view`:

```json
{"schemaVersion":1,"status":"ok","view":{"key":"orders-payments","scopeId":"order_hub","elements":[],"boundaries":[],"relationships":[],"layoutDirection":"lr"}}
{"schemaVersion":1,"status":"error","diagnostics":[{"code":"syntax","severity":"error","message":"...","location":{"file":"workspace.dsl","line":1,"column":1,"endLine":1,"endColumn":2}}]}
```

Success views carry selected `person`/`container` nodes, separate required system boundaries, relationships whose two endpoints are selected, and optional `lr` presentation hint. Nodes preserve `id`, `name`, `description`, `technology`, `tags`, nullable `parentId` and source location. Boundaries preserve `id`, `name`, `description` and source. Relationships preserve `id`, `sourceId`, `targetId`, `label`, optional technology and source. Locations use 1-based lines and Unicode-scalar columns; spans are half-open at the core boundary.

Error diagnostics carry a stable `code`, `severity`, `message`, nullable source `location` and optional related locations. File-read and argument errors have a null location. `schemaVersion` changes only with an intentional transport contract update; the TypeScript preview validates it and rejects malformed or inconsistent records before rendering.
