pub mod diagnostic;
pub mod model;
pub mod parser;
pub mod resolve;
pub mod source;
pub mod validate;
pub mod view;

use diagnostic::Diagnostic;
use model::{ResolvedView, ViewKey};
use source::SourceFile;

pub fn compile_view(source: &SourceFile, key: &ViewKey) -> Result<ResolvedView, Vec<Diagnostic>> {
    let parsed = parser::parse(source)?;
    let workspace = resolve::resolve(&parsed)?;
    let errors = validate::validate(&workspace);
    if !errors.is_empty() {
        return Err(errors);
    }
    view::project(&workspace, key)
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
        assert_eq!(view.elements.len(), 6);
        assert_eq!(view.boundaries.len(), 2);
        assert_eq!(view.relationships.len(), 8);
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
}
