## ADDED Requirements

### Requirement: Resolved view projection API
Projection SHALL expose `project(&Workspace, &ViewKey) -> Result<ResolvedView, Vec<Diagnostic>>` for an already resolved and validated workspace. The projector SHALL depend only on model and shared source/diagnostic types, not on parser syntax, validation implementation, host I/O or rendering. It SHALL own membership calculation, leave the input unchanged, and return a diagnostic for a missing key or invalid selection input rather than panic. The public `compile_view` facade SHALL validate before invoking projection.

#### Scenario: Unknown selected key
- **WHEN** a caller requests a view key absent from the workspace
- **THEN** projection returns a view-not-found diagnostic instead of silently rendering another view

### Requirement: Exact explicit selection and parent boundaries
A resolved view SHALL contain exactly the explicitly selected people/containers, deduplicated by stable ID, and a separate software-system boundary for each selected container's parent. Boundaries SHALL NOT act as independently selected diagram nodes or implicitly include unselected siblings. Metadata, source locations, scope and view key SHALL be preserved without geometry or Mermaid syntax.

#### Scenario: Omit a sibling container
- **WHEN** one container is selected and another container in the same software system is not
- **THEN** the resolved view contains the selected container and required system boundary but not the sibling, while the complete workspace retains both

#### Scenario: Two systems' containers
- **WHEN** the selected view explicitly includes Orders and Payment containers
- **THEN** projection supplies both original parent boundaries and retains each container's stable parent ID

### Requirement: Selected relationship closure
Projection SHALL include each declared relationship exactly once if and only if both of its endpoint elements are selected. It SHALL preserve direction, ID, label, technology and source range, including distinct parallel relationships. It SHALL NOT synthesize aggregate/implied edges or output relationships to omitted elements. Output ordering SHALL be deterministic and based on declaration order, not hash iteration.

#### Scenario: Remove an endpoint from the view
- **WHEN** an included container is removed from the include list without changing model relationships
- **THEN** its incident relationships disappear from the resolved view while remaining in the complete model

#### Scenario: Retain parallel edges and repeat projection
- **WHEN** a view selects both endpoints of two named parallel relationships and is projected twice
- **THEN** each projection preserves both relationship IDs/labels and produces the same ordered result without modifying the workspace
