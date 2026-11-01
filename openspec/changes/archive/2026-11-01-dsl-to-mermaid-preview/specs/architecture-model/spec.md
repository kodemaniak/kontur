## ADDED Requirements

### Requirement: Independent typed architecture model
The model module SHALL own `Workspace`, typed element/relationship/view identifiers, element and relationship records, view definitions and resolved-view types. Public records SHALL express people, software systems, containers, containment, names/descriptions, technologies, tags and source metadata. Relationships SHALL use typed endpoint IDs; view definitions SHALL express typed scope and included IDs. Model types SHALL depend only on shared source metadata, not on parser syntax, diagnostic formatting, serialization DTOs, host I/O, Mermaid or layout engines.

#### Scenario: Model constructed without DSL
- **WHEN** a test or future input adapter constructs model records directly
- **THEN** it can express the same workspace and view definitions without a parser AST or CLI/renderer dependency

### Requirement: Stable explicit identities
Element and relationship identity values SHALL derive from their explicit DSL identifiers rather than display text, declaration index, byte offsets or random generation. View identity SHALL derive from its explicit key. Display-text changes, whitespace/comments and reordering independent declarations SHALL retain identities and relationship endpoint values. Renaming an identifier SHALL change identity in this iteration and that limit SHALL be documented.

#### Scenario: Rename display text and insert comments
- **WHEN** an otherwise unchanged workspace changes an element name or relationship label and inserts comments before it
- **THEN** recompilation produces the same element/relationship IDs and endpoints while updating display metadata and source positions

#### Scenario: Parallel relationships
- **WHEN** two named relationships connect the same pair of elements
- **THEN** they remain distinct model relationships with their own IDs, labels and source ranges

### Requirement: Semantics and view selection remain separate
The complete model SHALL retain all declared elements and relationships independently of view membership. A database SHALL be represented as a container with a `Database` tag, not a distinct semantic kind. Geometry, Mermaid text and renderer-specific node IDs SHALL NOT be stored as architecture identity or semantic model data. Source metadata SHALL survive syntax-to-model conversion.

#### Scenario: Element excluded from the explicit view
- **WHEN** an element is removed from an include list but not from the model declarations
- **THEN** the model still contains it and its relationships with the same IDs even though projection may omit them

#### Scenario: Database metadata preserved
- **WHEN** a tagged database container is resolved
- **THEN** its domain kind is container and its tags/technology/source remain available to a renderer-independent caller
