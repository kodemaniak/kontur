## ADDED Requirements

### Requirement: Pure semantic validation API
The validator SHALL expose `validate(&Workspace) -> Vec<Diagnostic>`, returning an empty list for a valid workspace and semantic diagnostics otherwise. It SHALL depend only on the model and shared source/diagnostic types, not on parser syntax, projection, host APIs or rendering. It SHALL NOT mutate model records, resolve symbolic names or infer extra relationships; callers SHALL be able to test it on directly constructed model values.

#### Scenario: Validate a model without parsing
- **WHEN** a caller constructs a resolved workspace satisfying the documented invariants
- **THEN** validation returns no diagnostics without requiring the original DSL text or parser objects

### Requirement: Enforce containment and resolved-reference invariants
Every container SHALL have exactly one software-system parent; people and software systems SHALL NOT have container parents. Relationship endpoints and view references SHALL identify existing records even in workspaces built without the resolver. Violations SHALL return deterministic source-associated semantic diagnostics rather than panics or repaired data.

#### Scenario: Invalid parent kind
- **WHEN** a directly constructed container names a person as its parent
- **THEN** validation reports the incorrect parent kind and preserves the input unchanged

#### Scenario: Dangling resolved endpoint
- **WHEN** a directly constructed relationship refers to an absent element ID
- **THEN** validation returns an invariant diagnostic rather than passing a dangling edge to projection

### Requirement: Validate explicit container-view semantics
Each supported container view SHALL have a nonempty unique key, a software-system scope and an explicit selection consisting of people and containers. Explicitly selected containers MAY belong to another software system. The validator SHALL reject wrong-kind scopes, unsupported selected kinds and duplicate view keys; it SHALL NOT choose a default view, add wildcard members or calculate rendered membership.

#### Scenario: Scope is a person
- **WHEN** a resolved container view uses a person's ID as its scope
- **THEN** validation reports the invalid scope at the view's scope occurrence

#### Scenario: Include Payment containers in the Orders view
- **WHEN** an Orders-scoped container view explicitly includes containers owned by Payment
- **THEN** validation accepts those references without changing their original parent systems

#### Scenario: Duplicate view key
- **WHEN** directly constructed view definitions share a key
- **THEN** validation reports the duplicate rather than selecting one definition arbitrarily
