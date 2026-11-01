use crate::source::SourceSpan;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ElementId(pub String);

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RelationshipId(pub String);

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ViewKey(pub String);

impl ElementId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl RelationshipId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl ViewKey {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ElementKind {
    Person,
    SoftwareSystem,
    Container,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayoutDirection {
    LeftToRight,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Element {
    pub id: ElementId,
    pub kind: ElementKind,
    pub name: String,
    pub description: Option<String>,
    pub technology: Option<String>,
    pub tags: Vec<String>,
    pub parent_id: Option<ElementId>,
    pub source: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Relationship {
    pub id: RelationshipId,
    pub source_id: ElementId,
    pub target_id: ElementId,
    pub description: String,
    pub technology: Option<String>,
    pub source: SourceSpan,
    pub source_endpoint: SourceSpan,
    pub target_endpoint: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ViewDefinition {
    pub key: ViewKey,
    pub scope_id: ElementId,
    pub scope_source: SourceSpan,
    pub includes: Vec<ElementId>,
    pub include_sources: Vec<SourceSpan>,
    pub layout_direction: Option<LayoutDirection>,
    pub source: SourceSpan,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Workspace {
    pub elements: Vec<Element>,
    pub relationships: Vec<Relationship>,
    pub views: Vec<ViewDefinition>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SystemBoundary {
    pub id: ElementId,
    pub name: String,
    pub description: Option<String>,
    pub source: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedView {
    pub key: ViewKey,
    pub scope_id: ElementId,
    pub elements: Vec<Element>,
    pub boundaries: Vec<SystemBoundary>,
    pub relationships: Vec<Relationship>,
    pub layout_direction: Option<LayoutDirection>,
}
