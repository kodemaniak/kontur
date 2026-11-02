pub mod diagnostic;
pub mod model;
pub mod parser;
pub mod resolve;
pub mod source;
pub mod validate;
pub mod view;

use diagnostic::Diagnostic;
use model::{ResolvedView, ViewKey, Workspace};
use source::SourceFile;

pub fn compile_view(source: &SourceFile, key: &ViewKey) -> Result<ResolvedView, Vec<Diagnostic>> {
    let workspace = compile_workspace(source)?;
    view::project(&workspace, key)
}

pub fn compile_single_view(source: &SourceFile) -> Result<ResolvedView, Vec<Diagnostic>> {
    let workspace = compile_workspace(source)?;
    match workspace.views.as_slice() {
        [view] => view::project(&workspace, &view.key),
        [] => Err(vec![Diagnostic::error(
            diagnostic::DiagnosticCode::ViewNotFound,
            "No container view is declared.",
            Some(source.span(0, 0).expect("empty source span is valid")),
        )]),
        [_, additional, ..] => Err(vec![Diagnostic::error(
            diagnostic::DiagnosticCode::UnsupportedFeature,
            "The local preview supports exactly one container view.",
            Some(additional.source.clone()),
        )]),
    }
}

fn compile_workspace(source: &SourceFile) -> Result<Workspace, Vec<Diagnostic>> {
    let parsed = parser::parse(source)?;
    let workspace = resolve::resolve(&parsed)?;
    let errors = validate::validate(&workspace);
    if !errors.is_empty() {
        return Err(errors);
    }
    Ok(workspace)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostic::DiagnosticCode;

    const EXAMPLE: &str = include_str!("../../../examples/orders-payments/workspace.dsl");

    #[test]
    fn facade_composes_all_stages_for_the_real_example() {
        let source = SourceFile::new("example", "workspace.dsl", EXAMPLE);
        let view = compile_view(&source, &ViewKey("orders-payments".into())).unwrap();
        assert_eq!(view.elements.len(), 7);
        assert_eq!(view.boundaries.len(), 3);
        assert_eq!(view.relationships.len(), 9);
    }

    #[test]
    fn facade_stops_with_typed_errors_without_a_partial_view() {
        let source = SourceFile::new("invalid", "invalid.dsl", EXAMPLE);
        let errors = compile_view(&source, &ViewKey("missing".into())).unwrap_err();
        assert_eq!(errors[0].code, DiagnosticCode::ViewNotFound);

        let source = SourceFile::new("syntax", "syntax.dsl", "workspace \"broken");
        let errors = compile_view(&source, &ViewKey("x".into())).unwrap_err();
        assert_eq!(errors[0].code, DiagnosticCode::Syntax);
    }

    #[test]
    fn single_view_facade_preserves_the_declared_view_identity_and_sources() {
        let source = SourceFile::new("example", "workspace.dsl", EXAMPLE);
        let explicit = compile_view(&source, &ViewKey("orders-payments".into())).unwrap();
        let inferred = compile_single_view(&source);

        assert!(
            inferred.is_ok(),
            "expected the sole declared view, got {inferred:?}"
        );
        assert_eq!(inferred.unwrap(), explicit);
    }

    #[test]
    fn single_view_facade_rejects_zero_or_multiple_declared_views() {
        const NO_VIEW: &str = r#"workspace "No view" {
    !impliedRelationships false
    model { system = softwareSystem "System" {} }
    views {}
}"#;
        const MULTIPLE_VIEWS: &str = r#"workspace "Multiple views" {
    !impliedRelationships false
    model { system = softwareSystem "System" {} }
    views {
        container system "first" {}
        container system "second" {}
    }
}"#;

        for (name, text) in [("no-view", NO_VIEW), ("multiple-views", MULTIPLE_VIEWS)] {
            let source = SourceFile::new(name, format!("{name}.dsl"), text);
            let errors = compile_single_view(&source).expect_err("view count must not be guessed");
            assert!(
                errors.iter().any(|error| matches!(
                    error.code,
                    DiagnosticCode::Syntax | DiagnosticCode::UnsupportedFeature
                )),
                "expected a subset diagnostic, got {errors:?}"
            );
            assert!(
                errors.iter().any(|error| error
                    .span
                    .as_ref()
                    .is_some_and(|span| span.source_id == source.id)),
                "expected a source-located diagnostic, got {errors:?}"
            );
        }
    }

    #[test]
    fn single_view_facade_preserves_stage_specific_failures() {
        const UNSUPPORTED: &str = "workspace \"x\" {\n    !impliedRelationships false\n    !unknownDirective\n    model {}\n    views { container system \"v\" {} }\n}";
        const UNKNOWN_REFERENCE: &str = r#"workspace "Unknown reference" {
    !impliedRelationships false
    model {
        user = person "User"
        system = softwareSystem "System" {}
        broken = user -> missing "broken"
    }
    views { container system "v" { include user } }
}"#;
        const INVALID_SCOPE: &str = r#"workspace "Invalid scope" {
    !impliedRelationships false
    model { user = person "User" }
    views { container user "v" {} }
}"#;

        for (name, text, code) in [
            ("syntax", "workspace \"broken", DiagnosticCode::Syntax),
            (
                "unsupported",
                UNSUPPORTED,
                DiagnosticCode::UnsupportedFeature,
            ),
            (
                "reference",
                UNKNOWN_REFERENCE,
                DiagnosticCode::UnknownReference,
            ),
            ("semantic", INVALID_SCOPE, DiagnosticCode::Semantic),
        ] {
            let source = SourceFile::new(name, format!("{name}.dsl"), text);
            let errors = compile_single_view(&source).expect_err("invalid source must not compile");
            assert!(
                errors.iter().any(|error| error.code == code),
                "expected {code:?}, got {errors:?}"
            );
            assert!(
                errors.iter().any(|error| error
                    .span
                    .as_ref()
                    .is_some_and(|span| span.source_id == source.id)),
                "expected a source-located diagnostic, got {errors:?}"
            );
        }
    }
}
