#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct SourceId(pub String);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceFile {
    pub id: SourceId,
    pub name: String,
    pub text: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceSpan {
    pub source_id: SourceId,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SourceLocation {
    pub line: usize,
    pub column: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SourceError {
    Reversed,
    OutOfBounds,
    NotCharacterBoundary,
    WrongSource,
}

impl SourceFile {
    pub fn new(id: impl Into<String>, name: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            id: SourceId(id.into()),
            name: name.into(),
            text: text.into(),
        }
    }

    pub fn span(&self, start: usize, end: usize) -> Result<SourceSpan, SourceError> {
        self.check_range(start, end)?;
        Ok(SourceSpan {
            source_id: self.id.clone(),
            start,
            end,
        })
    }

    pub fn slice(&self, span: &SourceSpan) -> Result<&str, SourceError> {
        if span.source_id != self.id {
            return Err(SourceError::WrongSource);
        }
        self.check_range(span.start, span.end)?;
        Ok(&self.text[span.start..span.end])
    }

    pub fn location(&self, offset: usize) -> Result<SourceLocation, SourceError> {
        if offset > self.text.len() {
            return Err(SourceError::OutOfBounds);
        }
        if !self.text.is_char_boundary(offset) {
            return Err(SourceError::NotCharacterBoundary);
        }

        let mut location = SourceLocation { line: 1, column: 1 };
        let mut chars = self.text[..offset].char_indices().peekable();
        while let Some((_, ch)) = chars.next() {
            match ch {
                '\n' => {
                    location.line += 1;
                    location.column = 1;
                }
                '\r' if chars.peek().is_some_and(|(_, next)| *next == '\n') => {}
                '\r' => {
                    location.line += 1;
                    location.column = 1;
                }
                _ => location.column += 1,
            }
        }
        Ok(location)
    }

    fn check_range(&self, start: usize, end: usize) -> Result<(), SourceError> {
        if start > end {
            return Err(SourceError::Reversed);
        }
        if end > self.text.len() {
            return Err(SourceError::OutOfBounds);
        }
        if !self.text.is_char_boundary(start) || !self.text.is_char_boundary(end) {
            return Err(SourceError::NotCharacterBoundary);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locations_count_unicode_scalars_and_crlf_lines() {
        let source = SourceFile::new("test", "test.dsl", "øx\r\ny");
        let y = source.text.find('y').unwrap();
        assert_eq!(
            source.location(y).unwrap(),
            SourceLocation { line: 2, column: 1 }
        );
    }

    #[test]
    fn spans_reject_wrong_ranges_and_wrong_sources() {
        let source = SourceFile::new("test", "test.dsl", "éx");
        assert_eq!(source.span(2, 1), Err(SourceError::Reversed));
        assert_eq!(source.span(0, 4), Err(SourceError::OutOfBounds));
        assert_eq!(source.span(1, 2), Err(SourceError::NotCharacterBoundary));
        assert_eq!(
            source.slice(&SourceSpan {
                source_id: SourceId("other".into()),
                start: 0,
                end: 1
            }),
            Err(SourceError::WrongSource)
        );
    }

    #[test]
    fn eof_and_line_end_offsets_are_valid() {
        let source = SourceFile::new("test", "test.dsl", "a\r\nb");
        assert_eq!(
            source.location(source.text.len()).unwrap(),
            SourceLocation { line: 2, column: 2 }
        );
        assert!(source.span(source.text.len(), source.text.len()).is_ok());
    }
}
