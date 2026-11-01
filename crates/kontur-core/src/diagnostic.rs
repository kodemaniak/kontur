use crate::source::SourceSpan;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum DiagnosticCode {
    Syntax,
    UnsupportedFeature,
    DuplicateIdentifier,
    UnknownReference,
    Semantic,
    ViewNotFound,
    Host,
    Transport,
}

impl DiagnosticCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Syntax => "syntax",
            Self::UnsupportedFeature => "unsupported-feature",
            Self::DuplicateIdentifier => "duplicate-identifier",
            Self::UnknownReference => "unknown-reference",
            Self::Semantic => "semantic",
            Self::ViewNotFound => "view-not-found",
            Self::Host => "host",
            Self::Transport => "transport",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RelatedLocation {
    pub message: String,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Diagnostic {
    pub code: DiagnosticCode,
    pub severity: Severity,
    pub message: String,
    pub span: Option<SourceSpan>,
    pub related: Vec<RelatedLocation>,
}

impl Diagnostic {
    pub fn error(
        code: DiagnosticCode,
        message: impl Into<String>,
        span: Option<SourceSpan>,
    ) -> Self {
        Self {
            code,
            severity: Severity::Error,
            message: message.into(),
            span,
            related: Vec::new(),
        }
    }

    pub fn with_related(mut self, message: impl Into<String>, span: SourceSpan) -> Self {
        self.related.push(RelatedLocation {
            message: message.into(),
            span,
        });
        self
    }
}

pub fn sort_diagnostics(diagnostics: &mut [Diagnostic]) {
    diagnostics.sort_by(|a, b| {
        let a_span = a.span.as_ref();
        let b_span = b.span.as_ref();
        (
            a_span.map(|s| &s.source_id.0),
            a_span.map(|s| s.start),
            a.code,
        )
            .cmp(&(
                b_span.map(|s| &s.source_id.0),
                b_span.map(|s| s.start),
                b.code,
            ))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::{SourceFile, SourceId};

    #[test]
    fn diagnostic_codes_are_stable_and_categories_are_distinct() {
        assert_eq!(DiagnosticCode::Syntax.as_str(), "syntax");
        assert_ne!(
            DiagnosticCode::UnsupportedFeature.as_str(),
            DiagnosticCode::UnknownReference.as_str()
        );
        let io = Diagnostic::error(DiagnosticCode::Host, "cannot read", None);
        assert!(io.span.is_none());
    }

    #[test]
    fn diagnostics_sort_by_source_range_then_code() {
        let source = SourceFile::new("x", "x", "abcd");
        let at = |offset| source.span(offset, offset).unwrap();
        let mut diagnostics = vec![
            Diagnostic::error(DiagnosticCode::Syntax, "later", Some(at(3))),
            Diagnostic::error(DiagnosticCode::UnknownReference, "first", Some(at(1))),
        ];
        sort_diagnostics(&mut diagnostics);
        assert_eq!(diagnostics[0].message, "first");
    }

    #[test]
    fn source_id_is_a_shared_stable_value() {
        assert_eq!(SourceId("same".into()), SourceId("same".into()));
    }
}
