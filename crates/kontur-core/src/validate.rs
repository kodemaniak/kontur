use std::collections::HashMap;

use crate::diagnostic::{Diagnostic, DiagnosticCode, sort_diagnostics};
use crate::model::{ElementId, ElementKind, ViewKey, Workspace};
use crate::source::SourceSpan;

pub fn validate(workspace: &Workspace) -> Vec<Diagnostic> {
    let mut errors = Vec::new();
    let mut elements: HashMap<ElementId, (ElementKind, SourceSpan)> = HashMap::new();
    for element in &workspace.elements {
        if let Some(previous) = elements.get(&element.id) {
            errors.push(
                Diagnostic::error(
                    DiagnosticCode::DuplicateIdentifier,
                    format!("Element identifier `{}` is duplicated.", element.id.0),
                    Some(element.source.clone()),
                )
                .with_related("First element declaration is here.", previous.1.clone()),
            );
        } else {
            elements.insert(element.id.clone(), (element.kind, element.source.clone()));
        }
    }

    for element in &workspace.elements {
        match (element.kind, &element.parent_id) {
            (ElementKind::Container, None) => errors.push(semantic(
                "A container must have exactly one software system parent.",
                &element.source,
            )),
            (ElementKind::Container, Some(parent)) => {
                match elements.get(parent).map(|(kind, _)| kind) {
                    Some(ElementKind::SoftwareSystem) => {}
                    Some(_) => errors.push(semantic(
                        "A container parent must be a software system.",
                        &element.source,
                    )),
                    None => errors.push(semantic(
                        "A container parent references an unknown element.",
                        &element.source,
                    )),
                }
            }
            (_, Some(_)) => errors.push(semantic(
                "People and software systems cannot have a container parent.",
                &element.source,
            )),
            (_, None) => {}
        }
    }

    for relationship in &workspace.relationships {
        if !elements.contains_key(&relationship.source_id) {
            errors.push(semantic(
                "A relationship endpoint references an unknown element.",
                &relationship.source_endpoint,
            ));
        }
        if !elements.contains_key(&relationship.target_id) {
            errors.push(semantic(
                "A relationship endpoint references an unknown element.",
                &relationship.target_endpoint,
            ));
        }
    }

    let mut view_keys: HashMap<ViewKey, SourceSpan> = HashMap::new();
    for view in &workspace.views {
        if view.key.0.trim().is_empty() {
            errors.push(semantic("A view key must be nonempty.", &view.source));
        }
        if let Some(first) = view_keys.get(&view.key) {
            errors.push(
                Diagnostic::error(
                    DiagnosticCode::Semantic,
                    format!("Duplicate view key `{}`.", view.key.0),
                    Some(view.source.clone()),
                )
                .with_related("First view with this key is here.", first.clone()),
            );
        } else {
            view_keys.insert(view.key.clone(), view.source.clone());
        }

        match elements.get(&view.scope_id).map(|(kind, _)| kind) {
            Some(ElementKind::SoftwareSystem) => {}
            Some(_) => errors.push(semantic(
                "A container view scope must be a software system.",
                &view.scope_source,
            )),
            None => errors.push(semantic(
                "A container view scope references an unknown element.",
                &view.scope_source,
            )),
        }

        for (index, include) in view.includes.iter().enumerate() {
            let source = view.include_sources.get(index).unwrap_or(&view.source);
            match elements.get(include).map(|(kind, _)| kind) {
                Some(ElementKind::Person | ElementKind::Container) => {}
                Some(_) => errors.push(semantic(
                    "A container view include must reference a person or container.",
                    source,
                )),
                None => errors.push(semantic(
                    "A container view include references an unknown element.",
                    source,
                )),
            }
        }
    }

    sort_diagnostics(&mut errors);
    errors
}

fn semantic(message: &str, source: &crate::source::SourceSpan) -> Diagnostic {
    Diagnostic::error(DiagnosticCode::Semantic, message, Some(source.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostic::DiagnosticCode;
    use crate::model::{
        Element, ElementId, ElementKind, Relationship, RelationshipId, ViewDefinition, ViewKey,
    };
    use crate::source::{SourceFile, SourceSpan};

    fn span() -> SourceSpan {
        SourceFile::new("test", "test.dsl", "x").span(0, 1).unwrap()
    }

    fn element(id: &str, kind: ElementKind, parent: Option<&str>) -> Element {
        Element {
            id: ElementId(id.into()),
            kind,
            name: id.into(),
            description: None,
            technology: None,
            tags: Vec::new(),
            parent_id: parent.map(|parent| ElementId(parent.into())),
            source: span(),
        }
    }

    fn workspace() -> Workspace {
        let source = span();
        Workspace {
            elements: vec![
                element("user", ElementKind::Person, None),
                element("orders", ElementKind::SoftwareSystem, None),
                element("payments", ElementKind::SoftwareSystem, None),
                element("order_api", ElementKind::Container, Some("orders")),
                element("payment_api", ElementKind::Container, Some("payments")),
            ],
            relationships: vec![Relationship {
                id: RelationshipId("uses".into()),
                source_id: ElementId("user".into()),
                target_id: ElementId("order_api".into()),
                description: "Uses".into(),
                technology: None,
                source: source.clone(),
                source_endpoint: source.clone(),
                target_endpoint: source.clone(),
            }],
            views: vec![ViewDefinition {
                key: ViewKey("orders".into()),
                scope_id: ElementId("orders".into()),
                scope_source: source.clone(),
                includes: vec![ElementId("user".into()), ElementId("payment_api".into())],
                include_sources: vec![source.clone(), source.clone()],
                layout_direction: None,
                source,
            }],
        }
    }

    fn has_error(errors: &[Diagnostic], code: DiagnosticCode, message: &str) -> bool {
        errors.iter().any(|error| {
            error.code == code
                && error
                    .message
                    .to_lowercase()
                    .contains(&message.to_lowercase())
        })
    }

    #[test]
    fn validates_model_values_without_a_parser() {
        assert!(validate(&workspace()).is_empty());
    }

    #[test]
    fn reports_invalid_container_parent_and_dangling_relationship_endpoint() {
        let mut model = workspace();
        model.elements[3].parent_id = Some(ElementId("user".into()));
        model.relationships[0].target_id = ElementId("missing".into());
        let before = model.clone();
        let errors = validate(&model);
        assert!(has_error(
            &errors,
            DiagnosticCode::Semantic,
            "software system"
        ));
        assert!(has_error(
            &errors,
            DiagnosticCode::Semantic,
            "relationship endpoint"
        ));
        assert!(errors.iter().all(|error| error.span.is_some()));
        assert_eq!(model, before);
    }

    #[test]
    fn reports_wrong_view_scope_unknown_member_and_duplicate_keys() {
        let mut model = workspace();
        model.views[0].scope_id = ElementId("user".into());
        model.views[0].includes.push(ElementId("missing".into()));
        model.views[0].include_sources.push(span());
        model.views.push(model.views[0].clone());
        let errors = validate(&model);
        assert!(has_error(&errors, DiagnosticCode::Semantic, "scope"));
        assert!(has_error(&errors, DiagnosticCode::Semantic, "include"));
        assert!(has_error(
            &errors,
            DiagnosticCode::Semantic,
            "duplicate view key"
        ));
    }

    #[test]
    fn containers_from_another_system_are_valid_view_members() {
        let model = workspace();
        assert_eq!(model.views[0].scope_id, ElementId("orders".into()));
        assert_eq!(model.views[0].includes[1], ElementId("payment_api".into()));
        assert!(validate(&model).is_empty());
    }

    #[test]
    fn rejects_parent_on_non_container_and_empty_view_key() {
        let mut model = workspace();
        model.elements[0].parent_id = Some(ElementId("orders".into()));
        model.views[0].key = ViewKey("  ".into());
        let errors = validate(&model);
        assert!(has_error(
            &errors,
            DiagnosticCode::Semantic,
            "cannot have a container parent"
        ));
        assert!(has_error(&errors, DiagnosticCode::Semantic, "nonempty"));
    }
}
