use std::collections::HashMap;

use crate::diagnostic::{Diagnostic, DiagnosticCode, sort_diagnostics};
use crate::model::{
    Element, ElementId, ElementKind, LayoutDirection, Relationship, RelationshipId, ViewDefinition,
    ViewKey, Workspace,
};
use crate::parser::{IdentifierRef, ParsedElementKind, ParsedWorkspace};
use crate::source::SourceSpan;

pub fn resolve(parsed: &ParsedWorkspace) -> Result<Workspace, Vec<Diagnostic>> {
    let mut declarations: HashMap<String, SourceSpan> = HashMap::new();
    let mut errors = Vec::new();
    for (id, span) in parsed
        .elements
        .iter()
        .map(|element| (&element.id, &element.span))
        .chain(
            parsed
                .relationships
                .iter()
                .map(|relationship| (&relationship.id, &relationship.span)),
        )
    {
        if let Some(previous) = declarations.get(&id.value) {
            errors.push(
                Diagnostic::error(
                    DiagnosticCode::DuplicateIdentifier,
                    format!("Identifier `{}` is declared more than once.", id.value),
                    Some(id.span.clone()),
                )
                .with_related("First declaration is here.", previous.clone()),
            );
        } else {
            declarations.insert(id.value.clone(), span.clone());
        }
    }
    if !errors.is_empty() {
        sort_diagnostics(&mut errors);
        return Err(errors);
    }

    let elements_by_name: HashMap<_, _> = parsed
        .elements
        .iter()
        .map(|element| {
            (
                element.id.value.clone(),
                ElementId(element.id.value.clone()),
            )
        })
        .collect();
    let mut workspace = Workspace::default();

    for parsed_element in &parsed.elements {
        let parent_id = parsed_element.parent.as_ref().and_then(|parent| {
            match elements_by_name.get(&parent.value) {
                Some(id) => Some(id.clone()),
                None => {
                    errors.push(unknown_reference(&parent.value, &parent.span));
                    None
                }
            }
        });
        workspace.elements.push(Element {
            id: ElementId(parsed_element.id.value.clone()),
            kind: match parsed_element.kind {
                ParsedElementKind::Person => ElementKind::Person,
                ParsedElementKind::SoftwareSystem => ElementKind::SoftwareSystem,
                ParsedElementKind::Container => ElementKind::Container,
            },
            name: parsed_element.name.clone(),
            description: parsed_element.description.clone(),
            technology: parsed_element.technology.clone(),
            tags: parsed_element.tags.clone(),
            parent_id,
            source: parsed_element.span.clone(),
        });
    }

    for parsed_relationship in &parsed.relationships {
        let Some(source_id) =
            resolve_element(&parsed_relationship.source, &elements_by_name, &mut errors)
        else {
            continue;
        };
        let Some(target_id) =
            resolve_element(&parsed_relationship.target, &elements_by_name, &mut errors)
        else {
            continue;
        };
        workspace.relationships.push(Relationship {
            id: RelationshipId(parsed_relationship.id.value.clone()),
            source_id,
            target_id,
            description: parsed_relationship.description.clone(),
            technology: parsed_relationship.technology.clone(),
            source: parsed_relationship.span.clone(),
            source_endpoint: parsed_relationship.source.span.clone(),
            target_endpoint: parsed_relationship.target.span.clone(),
        });
    }

    for parsed_view in &parsed.views {
        let scope_id = resolve_element(&parsed_view.scope, &elements_by_name, &mut errors);
        let mut includes = Vec::with_capacity(parsed_view.includes.len());
        for include in &parsed_view.includes {
            if let Some(id) = resolve_element(include, &elements_by_name, &mut errors) {
                includes.push(id);
            }
        }
        if let Some(scope_id) = scope_id {
            workspace.views.push(ViewDefinition {
                key: ViewKey(parsed_view.key.value.clone()),
                scope_id,
                includes,
                include_sources: parsed_view
                    .includes
                    .iter()
                    .map(|include| include.span.clone())
                    .collect(),
                scope_source: parsed_view.scope.span.clone(),
                layout_direction: parsed_view
                    .layout_direction
                    .as_ref()
                    .map(|_| LayoutDirection::LeftToRight),
                source: parsed_view.span.clone(),
            });
        }
    }

    if errors.is_empty() {
        Ok(workspace)
    } else {
        sort_diagnostics(&mut errors);
        Err(errors)
    }
}

fn resolve_element(
    reference: &IdentifierRef,
    elements: &HashMap<String, ElementId>,
    errors: &mut Vec<Diagnostic>,
) -> Option<ElementId> {
    match elements.get(&reference.value) {
        Some(id) => Some(id.clone()),
        None => {
            errors.push(unknown_reference(&reference.value, &reference.span));
            None
        }
    }
}

fn unknown_reference(value: &str, span: &SourceSpan) -> Diagnostic {
    Diagnostic::error(
        DiagnosticCode::UnknownReference,
        format!("Unknown identifier `{value}`."),
        Some(span.clone()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostic::DiagnosticCode;
    use crate::parser::parse;
    use crate::source::SourceFile;

    fn compile(dsl: &str) -> (SourceFile, Workspace) {
        let source = SourceFile::new("test", "test.dsl", dsl);
        let parsed = parse(&source).expect("DSL parses");
        let workspace = resolve(&parsed).expect("references resolve");
        (source, workspace)
    }

    const BASIC: &str = r#"workspace "Test" {
    !impliedRelationships false
    model {
        first = source -> target "first label"
        second = source -> target "second label"
        source = person "User" "Description"
        target = softwareSystem "System" "System description" {
            app = container "Application" "App description" "Rust"
        }
    }
    views {
        container target "view" {
            include source app
        }
    }
}"#;

    #[test]
    fn forward_references_resolve_independent_of_declaration_order() {
        let (_, workspace) = compile(BASIC);
        assert_eq!(
            workspace.relationships[0].source_id,
            workspace.elements[0].id
        );
        assert_eq!(
            workspace.relationships[0].target_id,
            workspace.elements[1].id
        );
        assert_eq!(workspace.elements.len(), 3);
        assert_eq!(workspace.relationships.len(), 2);
        assert_eq!(workspace.views[0].includes.len(), 2);
    }

    #[test]
    fn identities_survive_display_renames_whitespace_and_comments() {
        let (_, a) = compile(BASIC);
        let changed = BASIC
            .replace("User", "Operator")
            .replace("first label", "first updated");
        let changed = format!(
            "// inserted comment\n{}",
            changed.replace("    model", "\n    model")
        );
        let (_, b) = compile(&changed);
        assert_eq!(
            a.elements.iter().map(|e| &e.id).collect::<Vec<_>>(),
            b.elements.iter().map(|e| &e.id).collect::<Vec<_>>()
        );
        assert_eq!(
            a.relationships.iter().map(|r| &r.id).collect::<Vec<_>>(),
            b.relationships.iter().map(|r| &r.id).collect::<Vec<_>>()
        );
        assert_eq!(a.relationships[0].source_id, b.relationships[0].source_id);
        assert_eq!(b.elements[0].name, "Operator");
        assert_ne!(a.elements[0].source.start, b.elements[0].source.start);
    }

    #[test]
    fn metadata_spans_and_parallel_relationships_are_preserved() {
        let (source, workspace) = compile(BASIC);
        let app = workspace.elements.iter().find(|e| e.id.0 == "app").unwrap();
        assert_eq!(app.technology.as_deref(), Some("Rust"));
        assert!(
            source
                .slice(&app.source)
                .unwrap()
                .starts_with("app = container")
        );
        assert_ne!(workspace.relationships[0].id, workspace.relationships[1].id);
        assert_eq!(workspace.relationships[0].description, "first label");
        assert_eq!(workspace.relationships[1].description, "second label");
    }

    #[test]
    fn duplicate_ids_report_later_and_original_declaration_spans() {
        let dsl = BASIC.replace("app = container", "source = container");
        let source = SourceFile::new("duplicate", "duplicate.dsl", &dsl);
        let parsed = parse(&source).expect("duplicate declarations are syntactically valid");
        let errors = resolve(&parsed).unwrap_err();
        assert_eq!(errors[0].code, DiagnosticCode::DuplicateIdentifier);
        assert!(errors[0].span.as_ref().unwrap().start > errors[0].related[0].span.start);
        assert!(errors[0].message.contains("source"));
    }

    #[test]
    fn missing_endpoint_scope_and_include_ids_are_all_reported_in_source_order() {
        let dsl = r#"workspace "Test" {
    !impliedRelationships false
    model {
        r = person_id -> missing "bad endpoint"
        person_id = person "User"
        system_id = softwareSystem "System" {}
    }
    views {
        container unknown_system "view" {
            include missing_member
        }
    }
}"#;
        let source = SourceFile::new("missing", "missing.dsl", dsl);
        let parsed = parse(&source).unwrap();
        let errors = resolve(&parsed).unwrap_err();
        assert_eq!(errors.len(), 3);
        assert!(
            errors
                .iter()
                .all(|e| e.code == DiagnosticCode::UnknownReference)
        );
        assert!(errors.windows(2).all(
            |pair| pair[0].span.as_ref().unwrap().start < pair[1].span.as_ref().unwrap().start
        ));
        for error in errors {
            assert!(source.slice(error.span.as_ref().unwrap()).is_ok());
        }
    }
}
