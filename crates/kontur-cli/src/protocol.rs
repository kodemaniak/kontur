use kontur_core::diagnostic::{Diagnostic, Severity};
use kontur_core::model::{Element, ElementKind, LayoutDirection, Relationship, ResolvedView};
use kontur_core::source::{SourceFile, SourceSpan};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewRequest {
    pub schema_version: u32,
    pub revision: u64,
    pub document_uri: String,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResponse {
    pub schema_version: u32,
    pub revision: u64,
    pub document_uri: String,
    pub result: PreviewResult,
}

#[derive(Serialize)]
#[serde(tag = "status")]
pub enum PreviewResult {
    #[serde(rename = "ok")]
    Ok {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        view: ResolvedViewDto,
    },
    #[serde(rename = "error")]
    Error {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
        diagnostics: Vec<DiagnosticDto>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedViewDto {
    pub key: String,
    pub scope_id: String,
    pub elements: Vec<ElementDto>,
    pub boundaries: Vec<BoundaryDto>,
    pub relationships: Vec<RelationshipDto>,
    pub layout_direction: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementDto {
    pub id: String,
    pub kind: &'static str,
    pub name: String,
    pub description: Option<String>,
    pub technology: Option<String>,
    pub tags: Vec<String>,
    pub parent_id: Option<String>,
    pub source: Option<LocationDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub source: Option<LocationDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipDto {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub label: String,
    pub technology: Option<String>,
    pub source: Option<LocationDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationDto {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticDto {
    pub code: &'static str,
    pub severity: &'static str,
    pub message: String,
    pub location: Option<LocationDto>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub related: Vec<RelatedDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedDto {
    pub message: String,
    pub location: Option<LocationDto>,
}

impl PreviewResult {
    pub fn success(view: &ResolvedView, source: &SourceFile) -> Self {
        Self::Ok {
            schema_version: 1,
            view: ResolvedViewDto {
                key: view.key.0.clone(),
                scope_id: view.scope_id.0.clone(),
                elements: view
                    .elements
                    .iter()
                    .map(|element| element_dto(element, source))
                    .collect(),
                boundaries: view
                    .boundaries
                    .iter()
                    .map(|boundary| BoundaryDto {
                        id: boundary.id.0.clone(),
                        name: boundary.name.clone(),
                        description: boundary.description.clone(),
                        source: location(source, &boundary.source),
                    })
                    .collect(),
                relationships: view
                    .relationships
                    .iter()
                    .map(|relationship| relationship_dto(relationship, source))
                    .collect(),
                layout_direction: view.layout_direction.map(|direction| match direction {
                    LayoutDirection::LeftToRight => "lr",
                }),
            },
        }
    }

    pub fn failure(diagnostics: &[Diagnostic], source: Option<&SourceFile>) -> Self {
        Self::Error {
            schema_version: 1,
            diagnostics: diagnostics
                .iter()
                .map(|diagnostic| DiagnosticDto {
                    code: diagnostic.code.as_str(),
                    severity: match diagnostic.severity {
                        Severity::Error => "error",
                        Severity::Warning => "warning",
                    },
                    message: diagnostic.message.clone(),
                    location: diagnostic
                        .span
                        .as_ref()
                        .and_then(|span| source.and_then(|source| location(source, span))),
                    related: diagnostic
                        .related
                        .iter()
                        .map(|related| RelatedDto {
                            message: related.message.clone(),
                            location: source.and_then(|source| location(source, &related.span)),
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}

fn element_dto(element: &Element, source: &SourceFile) -> ElementDto {
    ElementDto {
        id: element.id.0.clone(),
        kind: match element.kind {
            ElementKind::Person => "person",
            ElementKind::Container => "container",
            ElementKind::SoftwareSystem => "softwareSystem",
        },
        name: element.name.clone(),
        description: element.description.clone(),
        technology: element.technology.clone(),
        tags: element.tags.clone(),
        parent_id: element.parent_id.as_ref().map(|id| id.0.clone()),
        source: location(source, &element.source),
    }
}

fn relationship_dto(relationship: &Relationship, source: &SourceFile) -> RelationshipDto {
    RelationshipDto {
        id: relationship.id.0.clone(),
        source_id: relationship.source_id.0.clone(),
        target_id: relationship.target_id.0.clone(),
        label: relationship.description.clone(),
        technology: relationship.technology.clone(),
        source: location(source, &relationship.source),
    }
}

fn location(source: &SourceFile, span: &SourceSpan) -> Option<LocationDto> {
    if span.source_id != source.id {
        return None;
    }
    let start = source.location(span.start).ok()?;
    let end = source.location(span.end).ok()?;
    Some(LocationDto {
        file: source.name.clone(),
        line: start.line,
        column: start.column,
        end_line: end.line,
        end_column: end.column,
    })
}
