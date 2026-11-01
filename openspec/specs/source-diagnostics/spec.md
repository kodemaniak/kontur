# Source Diagnostics

## Purpose

Define shared source identity, checked text spans, human-readable locations, and stable structured diagnostics for the Rust core.

## Requirements

### Requirement: Shared source and diagnostic contract
The Rust core SHALL provide source text identified by `SourceId`, checked half-open UTF-8 byte spans, and structured diagnostics with category code, severity, message, optional primary span and related spans. The source/diagnostic modules SHALL own these types and checked location operations; they SHALL depend on neither the model/parser nor hosts/renderers and SHALL perform no file or output I/O. Source-derived errors SHALL identify the offending range; host failures without source text SHALL remain representable without a span.

#### Scenario: Diagnostic survives a host boundary
- **WHEN** a parser or semantic stage reports an error against a known source span
- **THEN** a caller can inspect its code and original source identity/range without parsing a formatted message or depending on that stage's private types

#### Scenario: Source-free failure
- **WHEN** the CLI cannot read the configured file
- **THEN** it can represent an I/O diagnostic without inventing a source range

### Requirement: Correct and checked source locations
Source operations SHALL accept only spans belonging to the source and bounded on UTF-8 character boundaries, returning an explicit error for invalid ranges. Human-facing locations SHALL use 1-based lines and Unicode-scalar columns and SHALL handle LF, CRLF and end-of-file ranges without panic. These location rules SHALL be independent of future LSP UTF-16 conversion.

#### Scenario: Unicode and CRLF input
- **WHEN** an error follows non-ASCII text and CRLF line endings
- **THEN** its byte span selects the original text and its displayed line/column identifies that text according to the documented coordinate rules

#### Scenario: Invalid span
- **WHEN** a caller requests a span outside the text, in reverse order, for another source or through a multi-byte character
- **THEN** the operation returns a checked error rather than slicing or panicking

### Requirement: Distinguishable error categories
Diagnostics SHALL distinguish syntax, unsupported-feature, duplicate-identifier, unknown-reference, semantic/view and host/transport failures with stable codes. Multiple diagnostics SHALL be ordered deterministically by source/range and code rather than unordered collection iteration. Rendering diagnostics SHALL remain host concerns, not dependencies of the Rust source modules.

#### Scenario: Unsupported syntax differs from a typo
- **WHEN** otherwise comparable inputs contain an unsupported `!include` statement and an unknown relationship endpoint respectively
- **THEN** callers receive different category codes with source locations even if the human messages are later reworded
