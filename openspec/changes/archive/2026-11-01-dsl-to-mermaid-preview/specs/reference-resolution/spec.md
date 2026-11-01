## ADDED Requirements

### Requirement: Explicit resolution boundary
The resolver SHALL expose `resolve(&ParsedWorkspace) -> Result<Workspace, Vec<Diagnostic>>`. It SHALL own symbol lookup and syntax-to-domain mapping, depending on parser-owned input types, model-owned output types and shared source/diagnostic types. It SHALL perform no parsing, host I/O, rendering or view-membership projection. Failure SHALL produce diagnostics without a successful partially resolved workspace; semantic rules SHALL remain the validator's responsibility.

#### Scenario: Resolve every identifier occurrence
- **WHEN** a supported parsed workspace contains relationship endpoints, view scope and explicit includes
- **THEN** resolution maps all occurrences to known typed IDs and preserves declaration/use source spans without retaining AST nodes in the output

### Requirement: Deterministic whole-workspace lookup
Resolution SHALL collect declarations before looking up references, use the supported flat identifier namespace, preserve explicit identity values and report duplicate declaration identifiers rather than overwriting them. Independent declaration order SHALL NOT change reference targets. Duplicate view keys SHALL remain available for semantic validation rather than being silently overwritten in a map.

#### Scenario: Forward relationship and view references
- **WHEN** a relationship precedes the referenced element declarations
- **THEN** resolution succeeds with the same endpoint IDs as the equivalent declaration-first source

#### Scenario: Duplicate identifier
- **WHEN** two declarations use the same identifier
- **THEN** resolution fails with a duplicate-identifier diagnostic at the later declaration and a related location for the first

### Requirement: Unknown references identify their use
Unknown relationship endpoints, view scopes and included identifiers SHALL each produce an unknown-reference diagnostic at the unresolved occurrence. The resolver SHALL NOT guess replacements, discard the offending relationship/include or manufacture an element. Multiple references to missing identifiers SHALL be reported deterministically.

#### Scenario: Misspelled endpoint
- **WHEN** a relationship targets `payment_ap` but only `payment_api` is declared
- **THEN** resolution fails at `payment_ap` and no successful relationship or preview view is returned

#### Scenario: Unknown included identifier
- **WHEN** an explicit include list names an undeclared element
- **THEN** resolution reports that include occurrence instead of silently omitting it from the diagram
