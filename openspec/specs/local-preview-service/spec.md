# Local Preview Service

## Purpose

Specify the bounded, versioned CLI stdio service for compiling complete in-memory DSL snapshots using the shared Rust core.

## Requirements

### Requirement: In-memory document service boundary
The existing `kontur` executable SHALL provide `kontur preview-service`, accepting document URI, revision and complete DSL text through stdin and returning a resolved-view or diagnostic result through stdout. The service SHALL construct a `SourceFile` from the supplied identity/text and call the shared single-view core facade. It SHALL NOT reread the document from disk, save it, resolve imports, render Mermaid or duplicate parsing, resolution, validation or projection rules. Service DTOs, serialization and process I/O SHALL belong to the CLI host; the core SHALL NOT depend on them. The existing explicit-key `view` command SHALL retain its JSON and exit-status behavior.

#### Scenario: Buffer differs from saved file
- **WHEN** a service request contains a relationship label different from the document saved at its URI
- **THEN** the result reflects the supplied text, leaves the saved file unchanged and preserves the relationship's explicit identity

#### Scenario: Identity is not a file-read instruction
- **WHEN** a request identifies a nonexistent file URI but supplies a valid complete DSL snapshot
- **THEN** compilation succeeds from that snapshot and returned source locations identify the supplied URI

### Requirement: Versioned correlated JSON-line contract
Each request SHALL be one newline-terminated UTF-8 JSON object with exactly `schemaVersion: 1`, a positive JavaScript-safe integer `revision`, a nonempty string `documentUri` and a string `text`. Each response SHALL contain exactly `schemaVersion: 1`, the same `revision` and `documentUri`, and `result` conforming to the existing version-1 `PreviewResult`. The service SHALL process requests sequentially, flush one response for each valid request and reserve stdout for protocol data. The TypeScript consumer SHALL validate envelopes, expected correlation and the existing result schema before accepting a view. Source locations SHALL keep the existing one-based Unicode-scalar convention.

#### Scenario: Chunked transport and multiline source
- **WHEN** two valid requests containing multiline Unicode DSL arrive in split or combined pipe chunks
- **THEN** the service emits two complete correlated JSON-line responses without mistaking source newlines or UTF-8 byte fragments for frame boundaries

#### Scenario: Rust result reaches the TypeScript consumer
- **WHEN** the example is compiled through the actual service and decoded by the TypeScript consumer
- **THEN** the consumer accepts the envelope and resolved view with unchanged element/boundary/relationship identities, membership and source locations

### Requirement: Compilation failures are recoverable results
Syntax, unsupported-feature, reference, semantic and single-view selection failures SHALL return the existing error result with useful diagnostics and no partial view. A failed snapshot SHALL NOT end the process or supply a previous successful view as if it compiled the new text. Subsequent valid requests SHALL be processed normally.

#### Scenario: Valid, invalid and corrected snapshots
- **WHEN** one running service receives a valid example, an unsupported directive edit, and a corrected example
- **THEN** it returns success, a source-located unsupported-feature error without a view, and success in that order without restarting

### Requirement: Bounded protocol failure and stream lifecycle
Encoded request and response frames SHALL be limited to 5 MiB each. Reads SHALL enforce that limit before unbounded accumulation. Malformed JSON, invalid/unknown envelope fields or versions, invalid field values, oversized frames, an oversized result or EOF within an incomplete frame SHALL cause a concise stderr diagnostic and nonzero process exit without a fabricated success response. Clean EOF between frames SHALL terminate successfully. Operational output SHALL NOT include full document text. The extension SHALL treat malformed, oversized, unexpected or uncorrelated output as a transport failure, not repair it or pass it to the renderer.

#### Scenario: Invalid protocol cannot become a diagram
- **WHEN** the service receives invalid JSON, an unsupported envelope version or a frame exceeding the documented size limit
- **THEN** it exits nonzero with an operational reason and emits no successful view for that frame

#### Scenario: Clean shutdown and truncated input differ
- **WHEN** stdin closes after a complete request/response exchange
- **THEN** the service exits successfully; closing stdin within a nonempty unterminated frame instead exits with a protocol failure

#### Scenario: Invalid service output is rejected
- **WHEN** the extension receives a response whose revision/URI does not match its in-flight request, or whose result has an invalid shape or absent relationship endpoint
- **THEN** it reports a transport failure and does not accept a new diagram
