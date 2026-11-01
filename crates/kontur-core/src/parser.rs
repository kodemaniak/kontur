use crate::diagnostic::{Diagnostic, DiagnosticCode};
use crate::source::{SourceFile, SourceSpan};
use pest::Parser;
use pest::error::InputLocation;
use pest::iterators::Pair;
use pest_derive::Parser;

#[derive(Parser)]
#[grammar = "parser.pest"]
struct StructurizrParser;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ParsedElementKind {
    Person,
    SoftwareSystem,
    Container,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentifierRef {
    pub value: String,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParsedElement {
    pub id: IdentifierRef,
    pub kind: ParsedElementKind,
    pub name: String,
    pub description: Option<String>,
    pub technology: Option<String>,
    pub tags: Vec<String>,
    pub parent: Option<IdentifierRef>,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParsedRelationship {
    pub id: IdentifierRef,
    pub source: IdentifierRef,
    pub target: IdentifierRef,
    pub description: String,
    pub technology: Option<String>,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParsedView {
    pub key: IdentifierRef,
    pub scope: IdentifierRef,
    pub includes: Vec<IdentifierRef>,
    pub layout_direction: Option<String>,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParsedWorkspace {
    pub elements: Vec<ParsedElement>,
    pub relationships: Vec<ParsedRelationship>,
    pub views: Vec<ParsedView>,
    pub implied_relationships_disabled: bool,
}

pub fn parse(source: &SourceFile) -> Result<ParsedWorkspace, Vec<Diagnostic>> {
    let pairs = StructurizrParser::parse(Rule::workspace, &source.text).map_err(|error| {
        let position = match error.location {
            InputLocation::Pos(position) => position,
            InputLocation::Span((start, _)) => start,
        };
        vec![parse_error(source, position)]
    })?;

    let mut workspace = ParsedWorkspace {
        elements: Vec::new(),
        relationships: Vec::new(),
        views: Vec::new(),
        implied_relationships_disabled: false,
    };
    for pair in pairs
        .into_iter()
        .next()
        .expect("workspace pair")
        .into_inner()
    {
        match pair.as_rule() {
            Rule::implied_directive => workspace.implied_relationships_disabled = true,
            Rule::model_block => {
                for item in pair.into_inner() {
                    parse_model_item(source, item, None, &mut workspace);
                }
            }
            Rule::views_block => {
                for view in pair.into_inner() {
                    workspace.views.push(parse_view(source, view));
                }
            }
            _ => {}
        }
    }

    if !workspace.implied_relationships_disabled {
        return Err(vec![Diagnostic::error(
            DiagnosticCode::UnsupportedFeature,
            "This subset requires `!impliedRelationships false` in the workspace.",
            Some(source.span(0, 0).expect("empty source span is valid")),
        )]);
    }
    Ok(workspace)
}

fn parse_model_item(
    source: &SourceFile,
    pair: Pair<'_, Rule>,
    parent: Option<IdentifierRef>,
    workspace: &mut ParsedWorkspace,
) {
    match pair.as_rule() {
        Rule::model_item => {
            for child in pair.into_inner() {
                parse_model_item(source, child, parent.clone(), workspace);
            }
        }
        Rule::person_decl => {
            let mut inner = pair.clone().into_inner();
            let id = identifier(source, inner.next().expect("person identifier"));
            let name = decode_string(inner.next().expect("person name").as_str());
            let description = inner.next().map(|value| decode_string(value.as_str()));
            workspace.elements.push(ParsedElement {
                id,
                kind: ParsedElementKind::Person,
                name,
                description,
                technology: None,
                tags: Vec::new(),
                parent: None,
                span: source_span(source, pair.as_span().start(), pair.as_span().end()),
            });
        }
        Rule::software_system_decl => {
            let mut inner = pair.clone().into_inner();
            let id = identifier(source, inner.next().expect("software system identifier"));
            let name = decode_string(inner.next().expect("software system name").as_str());
            let description = inner.next().map(|value| decode_string(value.as_str()));
            let system = ParsedElement {
                id: id.clone(),
                kind: ParsedElementKind::SoftwareSystem,
                name,
                description,
                technology: None,
                tags: Vec::new(),
                parent: None,
                span: source_span(source, pair.as_span().start(), pair.as_span().end()),
            };
            workspace.elements.push(system);
            for child in inner {
                parse_model_item(source, child, Some(id.clone()), workspace);
            }
        }
        Rule::container_decl => {
            let mut inner = pair.clone().into_inner();
            let id = identifier(source, inner.next().expect("container identifier"));
            let name = decode_string(inner.next().expect("container name").as_str());
            let description = inner.next().map(|value| decode_string(value.as_str()));
            let technology = inner.next().map(|value| decode_string(value.as_str()));
            let mut tags = Vec::new();
            for tag_block in inner {
                for tag_stmt in tag_block.into_inner() {
                    if tag_stmt.as_rule() == Rule::tag_stmt {
                        if let Some(tag) = tag_stmt.into_inner().next() {
                            tags.extend(
                                decode_string(tag.as_str())
                                    .split(',')
                                    .map(|tag| tag.trim().to_owned())
                                    .filter(|tag| !tag.is_empty()),
                            );
                        }
                    }
                }
            }
            workspace.elements.push(ParsedElement {
                id,
                kind: ParsedElementKind::Container,
                name,
                description,
                technology,
                tags,
                parent,
                span: source_span(source, pair.as_span().start(), pair.as_span().end()),
            });
        }
        Rule::relationship_decl => {
            let mut inner = pair.clone().into_inner();
            let id = identifier(source, inner.next().expect("relationship identifier"));
            let source_id = identifier(source, inner.next().expect("relationship source"));
            let target_id = identifier(source, inner.next().expect("relationship target"));
            let description =
                decode_string(inner.next().expect("relationship description").as_str());
            let technology = inner.next().map(|value| decode_string(value.as_str()));
            workspace.relationships.push(ParsedRelationship {
                id,
                source: source_id,
                target: target_id,
                description,
                technology,
                span: source_span(source, pair.as_span().start(), pair.as_span().end()),
            });
        }
        _ => {}
    }
}

fn parse_view(source: &SourceFile, pair: Pair<'_, Rule>) -> ParsedView {
    let mut inner = pair.clone().into_inner();
    let scope = identifier(source, inner.next().expect("view scope"));
    let key = string_ref(source, inner.next().expect("view key"));
    let mut includes = Vec::new();
    let mut layout_direction = None;
    for item in inner {
        if item.as_rule() == Rule::view_item {
            for child in item.into_inner() {
                match child.as_rule() {
                    Rule::include_stmt => {
                        includes.extend(child.into_inner().map(|id| identifier(source, id)))
                    }
                    Rule::auto_layout => layout_direction = Some("lr".into()),
                    _ => {}
                }
            }
        }
    }
    ParsedView {
        key,
        scope,
        includes,
        layout_direction,
        span: source_span(source, pair.as_span().start(), pair.as_span().end()),
    }
}

fn identifier(source: &SourceFile, pair: Pair<'_, Rule>) -> IdentifierRef {
    IdentifierRef {
        value: pair.as_str().to_owned(),
        span: source_span(source, pair.as_span().start(), pair.as_span().end()),
    }
}

fn string_ref(source: &SourceFile, pair: Pair<'_, Rule>) -> IdentifierRef {
    IdentifierRef {
        value: decode_string(pair.as_str()),
        span: source_span(source, pair.as_span().start(), pair.as_span().end()),
    }
}

fn source_span(source: &SourceFile, start: usize, end: usize) -> SourceSpan {
    source
        .span(start, end)
        .expect("Pest spans are UTF-8 boundaries within the source")
}

fn decode_string(raw: &str) -> String {
    let mut output = String::with_capacity(raw.len().saturating_sub(2));
    let mut chars = raw[1..raw.len() - 1].chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(escaped) = chars.next() {
                output.push(escaped);
            }
        } else {
            output.push(ch);
        }
    }
    output
}

fn parse_error(source: &SourceFile, position: usize) -> Diagnostic {
    let position = position.min(source.text.len());
    let line_start = source.text[..position]
        .rfind(['\n', '\r'])
        .map_or(0, |index| index + 1);
    let line_end = source.text[position..]
        .find(['\n', '\r'])
        .map_or(source.text.len(), |relative| position + relative);
    let line = &source.text[line_start..line_end];
    let trimmed = line.trim_start();
    let unsupported = [
        "!include",
        "!script",
        "!identifiers hierarchical",
        "!impliedRelationships true",
        "include *",
        "include \"",
        "exclude",
        "styles",
        "systemContext",
        "systemLandscape",
        "dynamic",
        "deployment",
        "component",
    ]
    .iter()
    .any(|feature| line.contains(feature))
        || trimmed.starts_with('!')
        || ["person \"", "softwareSystem \"", "container \""]
            .iter()
            .any(|feature| trimmed.starts_with(feature))
        || (trimmed.starts_with("include ")
            && trimmed.split_whitespace().any(|token| {
                token.contains('*')
                    || token.contains('.')
                    || token.contains("==")
                    || token.contains("!=")
            }))
        || (line.contains("autoLayout") && !line.contains("autoLayout lr"));
    let code = if unsupported {
        DiagnosticCode::UnsupportedFeature
    } else {
        DiagnosticCode::Syntax
    };
    let message = if unsupported {
        format!(
            "Unsupported Structurizr DSL construct: `{}`.",
            trimmed.trim()
        )
    } else if source.text[position..].starts_with("/*")
        || (source.text.contains("/*") && !source.text.contains("*/"))
    {
        "Unclosed block comment.".to_owned()
    } else if has_unclosed_string(&source.text) {
        "Unclosed quoted string.".to_owned()
    } else {
        "Unexpected or incomplete syntax in the supported Structurizr DSL subset.".to_owned()
    };
    let end = source.text[position..]
        .chars()
        .next()
        .map_or(position, |ch| position + ch.len_utf8());
    Diagnostic::error(code, message, Some(source_span(source, position, end)))
}

fn has_unclosed_string(text: &str) -> bool {
    let mut quoted = false;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    let mut chars = text.char_indices().peekable();
    while let Some((_, ch)) = chars.next() {
        let next = chars.peek().map(|(_, ch)| *ch);
        if line_comment {
            if ch == '\n' {
                line_comment = false;
            }
            continue;
        }
        if block_comment {
            if ch == '*' && next == Some('/') {
                chars.next();
                block_comment = false;
            }
            continue;
        }
        if quoted {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                quoted = false;
            }
            continue;
        }
        if ch == '/' && next == Some('/') {
            chars.next();
            line_comment = true;
        } else if ch == '/' && next == Some('*') {
            chars.next();
            block_comment = true;
        } else if ch == '"' {
            quoted = true;
        }
    }
    quoted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_orders_payments_fixture_with_spans() {
        let source = SourceFile::new(
            "orders-payments",
            "workspace.dsl",
            include_str!("../../../examples/orders-payments/workspace.dsl"),
        );
        let parsed = parse(&source).expect("valid DSL subset");
        assert_eq!(parsed.elements.len(), 8);
        assert_eq!(parsed.relationships.len(), 8);
        assert_eq!(parsed.views.len(), 1);
        assert!(parsed.implied_relationships_disabled);
        assert_eq!(parsed.views[0].includes.len(), 6);
        assert!(
            parsed
                .elements
                .iter()
                .all(|element| source.slice(&element.span).is_ok())
        );
    }

    #[test]
    fn preserves_forward_references_and_parallel_relationship_ids() {
        let source = SourceFile::new(
            "forward",
            "forward.dsl",
            r#"
workspace "Test" {
    !impliedRelationships false
    model {
        first_link = source -> target "first"
        second_link = source -> target "second"
        source = person "autoLayout → { source }"
        target = softwareSystem "Target" {
            app = container "Application"
        }
    }
    views {
        container target "test" {
            include source app
        }
    }
}
"#,
        );
        let parsed = parse(&source).expect("forward references are syntax, not resolution");
        assert_eq!(parsed.relationships[0].source.value, "source");
        assert_eq!(parsed.relationships[0].target.value, "target");
        assert_ne!(
            parsed.relationships[0].id.value,
            parsed.relationships[1].id.value
        );
        assert_eq!(source.slice(&parsed.elements[0].id.span).unwrap(), "source");
    }

    #[test]
    fn accepts_crlf_comments_and_escaped_quotes() {
        let dsl = "workspace \"Test\" {\r\n    !impliedRelationships false\r\n    model {\r\n        // comment with -> and { ignored\r\n        user = person \"Op\\\"s\" \"ø\"\r\n        app = softwareSystem \"App\" {\r\n            ui = container \"UI\"\r\n        }\r\n    }\r\n    views {\r\n        container app \"view\" {\r\n            include user ui\r\n        }\r\n    }\r\n}\r\n";
        let parsed = parse(&SourceFile::new("crlf", "crlf.dsl", dsl)).expect("CRLF input");
        assert_eq!(parsed.elements[0].name, "Op\"s");
        assert_eq!(parsed.elements[0].description.as_deref(), Some("ø"));
    }

    #[test]
    fn keyword_prefixes_remain_identifiers_and_strings() {
        let source = SourceFile::new(
            "prefixes",
            "prefixes.dsl",
            r#"workspace "Keyword names" {
    !impliedRelationships false
    model {
        person_id = person "person"
        softwareSystem_id = softwareSystem "softwareSystem" {
            container_id = container "container"
        }
    }
    views {
        container softwareSystem_id "view" {
            include person_id container_id
        }
    }
}"#,
        );
        let parsed = parse(&source).expect("keyword prefixes are ordinary identifiers");
        assert_eq!(parsed.elements[0].id.value, "person_id");
        assert_eq!(parsed.elements[1].id.value, "softwareSystem_id");
        assert_eq!(parsed.views[0].includes.len(), 2);
    }

    #[test]
    fn known_unsupported_features_have_their_own_category() {
        for dsl in [
            "workspace \"x\" { !include \"other.dsl\" }",
            "workspace \"x\" {\n    !unsupportedDirective\n    model {}\n    views { container x \"v\" {} }\n}",
            "workspace \"x\" { !impliedRelationships false model { p = person \"P\" s = softwareSystem \"S\" {} } views { container s \"v\" { include * } } }",
            "workspace \"x\" { !impliedRelationships false model { s = softwareSystem \"S\" {} } views { systemContext s \"v\" { include * } } }",
            "workspace \"x\" {\n!impliedRelationships false\nmodel {\np = person \"P\"\ns = softwareSystem \"S\" {}\n}\nviews {\ncontainer s \"v\" {\ninclude \"element.tag==Database\"\n}\n}\n}",
            "workspace \"x\" {\n!impliedRelationships false\nmodel {\nperson \"anonymous\"\n}\nviews { container x \"v\" {} }\n}",
        ] {
            let errors =
                parse(&SourceFile::new("unsupported", "unsupported.dsl", dsl)).unwrap_err();
            assert_eq!(errors[0].code, DiagnosticCode::UnsupportedFeature, "{dsl}");
            assert!(errors[0].span.is_some());
        }
    }

    #[test]
    fn requires_explicitly_disabled_implied_relationships() {
        let source = SourceFile::new(
            "implied",
            "implied.dsl",
            r#"workspace "x" {
model { p = person "P" }
views { container p "v" { include p } }
}"#,
        );
        let errors = parse(&source).unwrap_err();
        assert_eq!(errors[0].code, DiagnosticCode::UnsupportedFeature);
        assert!(errors[0].message.contains("!impliedRelationships false"));
    }

    #[test]
    fn rejects_trailing_tokens_and_truncated_strings_without_panicking() {
        for dsl in [
            "workspace \"x\" { !impliedRelationships false model { p = person \"P\" } views { container p \"v\" { include p } } } trailing",
            "workspace \"x\" { !impliedRelationships false model { p = person \"unfinished } views { container p \"v\" { include p } } }",
            "workspace \"x\" { /* unfinished",
        ] {
            let errors = parse(&SourceFile::new("broken", "broken.dsl", dsl)).unwrap_err();
            assert_eq!(errors[0].code, DiagnosticCode::Syntax);
            assert!(errors[0].span.is_some());
        }
    }
}
