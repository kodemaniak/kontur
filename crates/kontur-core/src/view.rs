use std::collections::HashSet;

use crate::diagnostic::{Diagnostic, DiagnosticCode, sort_diagnostics};
use crate::model::{ElementId, ElementKind, ResolvedView, SystemBoundary, ViewKey, Workspace};

pub fn project(workspace: &Workspace, key: &ViewKey) -> Result<ResolvedView, Vec<Diagnostic>> {
    let mut matches = workspace.views.iter().filter(|view| &view.key == key);
    let Some(view) = matches.next() else {
        return Err(vec![Diagnostic::error(
            DiagnosticCode::ViewNotFound,
            format!("View `{}` was not found.", key.0),
            None,
        )]);
    };
    if let Some(duplicate) = matches.next() {
        return Err(vec![
            Diagnostic::error(
                DiagnosticCode::Semantic,
                format!("Duplicate view key `{}`.", key.0),
                Some(duplicate.source.clone()),
            )
            .with_related("First view with this key is here.", view.source.clone()),
        ]);
    }

    let element_map: std::collections::HashMap<_, _> = workspace
        .elements
        .iter()
        .map(|element| (element.id.clone(), element))
        .collect();
    let mut errors = Vec::new();
    match element_map.get(&view.scope_id) {
        Some(scope) if scope.kind == ElementKind::SoftwareSystem => {}
        Some(_) => errors.push(semantic(
            "A container view scope must be a software system.",
            &view.scope_source,
        )),
        None => errors.push(semantic(
            "A container view scope references an unknown element.",
            &view.scope_source,
        )),
    }

    let mut selected = HashSet::<ElementId>::new();
    let mut parent_systems = HashSet::<ElementId>::new();
    for (index, id) in view.includes.iter().enumerate() {
        let source = view.include_sources.get(index).unwrap_or(&view.source);
        let Some(element) = element_map.get(id) else {
            errors.push(semantic(
                "A view include references an unknown element.",
                source,
            ));
            continue;
        };
        if !matches!(element.kind, ElementKind::Person | ElementKind::Container) {
            errors.push(semantic(
                "A container view can include only people and containers.",
                source,
            ));
            continue;
        }
        if element.kind == ElementKind::Container {
            let Some(parent_id) = &element.parent_id else {
                errors.push(semantic(
                    "A selected container must have a software system parent.",
                    &element.source,
                ));
                continue;
            };
            match element_map.get(parent_id) {
                Some(parent) if parent.kind == ElementKind::SoftwareSystem => {
                    parent_systems.insert(parent_id.clone());
                }
                _ => {
                    errors.push(semantic(
                        "A selected container must have a software system parent.",
                        &element.source,
                    ));
                    continue;
                }
            }
        }
        selected.insert(id.clone());
    }

    if !errors.is_empty() {
        sort_diagnostics(&mut errors);
        return Err(errors);
    }

    let elements = workspace
        .elements
        .iter()
        .filter(|element| selected.contains(&element.id))
        .cloned()
        .collect();
    let boundaries = workspace
        .elements
        .iter()
        .filter(|element| parent_systems.contains(&element.id))
        .map(|element| SystemBoundary {
            id: element.id.clone(),
            name: element.name.clone(),
            description: element.description.clone(),
            source: element.source.clone(),
        })
        .collect();
    let relationships = workspace
        .relationships
        .iter()
        .filter(|relationship| {
            selected.contains(&relationship.source_id) && selected.contains(&relationship.target_id)
        })
        .cloned()
        .collect();

    Ok(ResolvedView {
        key: view.key.clone(),
        scope_id: view.scope_id.clone(),
        elements,
        boundaries,
        relationships,
        layout_direction: view.layout_direction,
    })
}

fn semantic(message: &str, source: &crate::source::SourceSpan) -> Diagnostic {
    Diagnostic::error(DiagnosticCode::Semantic, message, Some(source.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostic::DiagnosticCode;
    use crate::model::{
        Element, ElementId, ElementKind, Relationship, RelationshipId, ViewDefinition,
    };
    use crate::source::{SourceFile, SourceSpan};

    fn span() -> SourceSpan {
        SourceFile::new("view", "view.dsl", "x").span(0, 1).unwrap()
    }

    fn element(id: &str, kind: ElementKind, parent: Option<&str>) -> Element {
        Element {
            id: ElementId(id.into()),
            kind,
            name: id.into(),
            description: Some(format!("{id} description")),
            technology: None,
            tags: if id.ends_with("db") {
                vec!["Database".into()]
            } else {
                Vec::new()
            },
            parent_id: parent.map(|parent| ElementId(parent.into())),
            source: span(),
        }
    }

    fn relationship(id: &str, source: &str, target: &str, label: &str) -> Relationship {
        Relationship {
            id: RelationshipId(id.into()),
            source_id: ElementId(source.into()),
            target_id: ElementId(target.into()),
            description: label.into(),
            technology: None,
            source: span(),
            source_endpoint: span(),
            target_endpoint: span(),
        }
    }

    fn workspace() -> Workspace {
        let span = span();
        Workspace {
            elements: vec![
                element("user", ElementKind::Person, None),
                element("orders", ElementKind::SoftwareSystem, None),
                element("order_api", ElementKind::Container, Some("orders")),
                element("order_db", ElementKind::Container, Some("orders")),
                element("payments", ElementKind::SoftwareSystem, None),
                element("payment_api", ElementKind::Container, Some("payments")),
            ],
            relationships: vec![
                relationship("user-api-a", "user", "order_api", "Uses A"),
                relationship("db-edge", "order_api", "order_db", "Stores"),
                relationship(
                    "api-payment",
                    "order_api",
                    "payment_api",
                    "Requests payment",
                ),
                relationship("user-api-b", "user", "order_api", "Uses B"),
                relationship(
                    "payment-order",
                    "payment_api",
                    "order_api",
                    "Returns result",
                ),
            ],
            views: vec![ViewDefinition {
                key: ViewKey("selected".into()),
                scope_id: ElementId("orders".into()),
                scope_source: span.clone(),
                includes: vec![
                    ElementId("payment_api".into()),
                    ElementId("user".into()),
                    ElementId("order_api".into()),
                    ElementId("order_api".into()),
                ],
                include_sources: vec![span.clone(); 4],
                layout_direction: None,
                source: span,
            }],
        }
    }

    #[test]
    fn selects_only_explicit_members_and_required_system_boundaries() {
        let model = workspace();
        let before = model.clone();
        let view = project(&model, &ViewKey("selected".into())).expect("view projection");
        assert_eq!(
            view.elements
                .iter()
                .map(|e| e.id.0.as_str())
                .collect::<Vec<_>>(),
            ["user", "order_api", "payment_api"]
        );
        assert_eq!(
            view.boundaries
                .iter()
                .map(|b| b.id.0.as_str())
                .collect::<Vec<_>>(),
            ["orders", "payments"]
        );
        assert_eq!(
            view.relationships
                .iter()
                .map(|r| r.id.0.as_str())
                .collect::<Vec<_>>(),
            ["user-api-a", "api-payment", "user-api-b", "payment-order"]
        );
        assert!(!view.elements.iter().any(|e| e.id.0 == "order_db"));
        assert_eq!(
            view.elements
                .iter()
                .find(|e| e.id.0 == "order_api")
                .unwrap()
                .parent_id
                .as_ref()
                .unwrap()
                .0,
            "orders"
        );
        assert_eq!(model, before);
    }

    #[test]
    fn repeated_projection_is_deterministic_and_parallel_edges_remain_distinct() {
        let model = workspace();
        let first = project(&model, &ViewKey("selected".into())).unwrap();
        let second = project(&model, &ViewKey("selected".into())).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.relationships[0].id.0, "user-api-a");
        assert_eq!(first.relationships[2].id.0, "user-api-b");
    }

    #[test]
    fn missing_key_and_invalid_membership_are_diagnostics() {
        let mut model = workspace();
        let missing = project(&model, &ViewKey("missing".into())).unwrap_err();
        assert_eq!(missing[0].code, DiagnosticCode::ViewNotFound);

        model.views[0].includes.push(ElementId("orders".into()));
        model.views[0].include_sources.push(span());
        let invalid = project(&model, &ViewKey("selected".into())).unwrap_err();
        assert!(
            invalid
                .iter()
                .any(|error| error.code == DiagnosticCode::Semantic)
        );
        assert!(invalid.iter().all(|error| error.span.is_some()));
    }
}
