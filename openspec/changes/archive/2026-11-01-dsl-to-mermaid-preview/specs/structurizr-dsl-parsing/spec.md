## ADDED Requirements

### Requirement: Source-preserving parser API
The parser SHALL expose `parse(&SourceFile) -> Result<ParsedWorkspace, Vec<Diagnostic>>`, owning the unresolved syntax types it returns. It SHALL accept text and return declarations, symbolic reference occurrences and spans without filesystem access, identifier lookup, model construction, view projection or rendering. Its only dependencies on other core modules SHALL be shared source/diagnostic types, not the semantic model or host. Any parsing-library tree, rule, span and error types SHALL remain implementation details and SHALL NOT appear in the public API, returned records or diagnostics. Failure SHALL return diagnostics and SHALL NOT expose a successful partial workspace.

#### Scenario: Forward reference remains symbolic
- **WHEN** a supported relationship mentions an identifier declared later in the model
- **THEN** parsing succeeds with the identifier text and occurrence span intact, leaving existence checks to resolution

#### Scenario: Library-independent parse result
- **WHEN** a caller inspects a successful parse result or a parse diagnostic
- **THEN** it uses only our owned syntax/source/diagnostic types, without importing a parsing library or converting that library's parse tree or errors

### Requirement: Explicit supported DSL subset
The parser SHALL accept one workspace containing a model and one explicitly keyed container view; named people, software systems and nested containers; inline descriptions/technologies; container tags; named labeled relationships with optional technology; explicit include lists; and optional `autoLayout lr`. It SHALL require explicit identifiers and `!impliedRelationships false`, use flat identifier syntax, and support `//` and `/* ... */` comments, LF/CRLF, Unicode text and quoted strings with escaped quotes/backslashes. Database records SHALL use container declarations with tags rather than a non-Structurizr `database` keyword. The exact subset SHALL be documented.

#### Scenario: Orders and Payment source
- **WHEN** the real DSL example is parsed
- **THEN** syntax records preserve one person, two software systems, five containers, eight named relationships, metadata and the explicit view's scope/key/includes with source spans

#### Scenario: Text and comments do not become structure
- **WHEN** names or comments contain braces, arrows, Unicode or escaped quotes
- **THEN** parsing retains intended text and does not reinterpret string/comment contents as declarations or relationships

### Requirement: Unsupported and malformed input fails visibly
The parser SHALL reject unsupported constructs including anonymous declarations, hierarchical identifiers, additional view kinds, wildcard/expression selectors, `exclude`, imports, scripts and styles with an unsupported-feature diagnostic. Missing required subset forms, unclosed strings/comments/blocks, unexpected tokens and extra arguments SHALL produce source-located diagnostics. No unconsumed content or disabled implicit-relationship requirement SHALL silently disappear.

#### Scenario: Unsupported directive
- **WHEN** a workspace contains `!include` or an `include *` view selector
- **THEN** parsing fails and explains the unsupported construct at its source location without reading another file or returning a partial model

#### Scenario: Truncated source
- **WHEN** the file ends inside a string, comment or block
- **THEN** parsing returns a syntax diagnostic identifying the unfinished construct or expected closing token, without panicking

#### Scenario: Implicit relationships not disabled
- **WHEN** the workspace omits `!impliedRelationships false` or requests implicit relationships
- **THEN** the diagnostic explains that this subset requires explicit relationships instead of accepting incompatible defaults
