import type { LocationDto, ResolvedViewDto } from '../../preview/src/contract';

export type SourcePosition = { line: number; character: number };
export type SourceRange = { start: SourcePosition; end: SourcePosition };
export type SourceMappingDocument = {
  documentUri: string;
  lineCount: number;
  lineAt(line: number): { text: string };
  offsetAt(position: SourcePosition): number;
};

export function sourceRange(location: LocationDto, document: SourceMappingDocument): SourceRange | undefined {
  if (location.file !== document.documentUri
    || ![location.line, location.column, location.endLine, location.endColumn]
    .every((value) => Number.isSafeInteger(value) && value >= 1)
    || location.endLine < location.line
    || (location.endLine === location.line && location.endColumn < location.column)
    || location.endLine > document.lineCount) return undefined;

  const start = sourcePosition(location.line, location.column, document);
  const end = sourcePosition(location.endLine, location.endColumn, document);
  if (!start || !end || document.offsetAt(start) > document.offsetAt(end)) return undefined;
  return { start, end };
}

export function findSourceElementId(
  view: Pick<ResolvedViewDto, 'elements' | 'boundaries'>,
  cursor: SourcePosition,
  document: SourceMappingDocument,
): string | undefined {
  if (!Number.isSafeInteger(cursor.line) || !Number.isSafeInteger(cursor.character)
    || cursor.line < 0 || cursor.character < 0) return undefined;

  let match: { id: string; length: number } | undefined;
  for (const target of [...view.elements, ...view.boundaries]) {
    if (!target.source) continue;
    const range = sourceRange(target.source, document);
    if (!range || compare(cursor, range.start) < 0 || compare(cursor, range.end) >= 0) continue;
    const length = document.offsetAt(range.end) - document.offsetAt(range.start);
    if (!match || length < match.length) match = { id: target.id, length };
  }
  return match?.id;
}

export function parseNavigationRequest(
  message: unknown,
  currentRevision: number,
  visibleIds: ReadonlySet<string>,
): string | undefined {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined;
  const prototype = Object.getPrototypeOf(message);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const request = message as Record<string, unknown>;
  const keys = Object.keys(request);
  if (keys.length !== 3 || !keys.includes('type') || !keys.includes('revision') || !keys.includes('id')
    || request.type !== 'navigate-to-source'
    || request.revision !== currentRevision
    || !Number.isSafeInteger(request.revision)
    || (request.revision as number) < 1
    || typeof request.id !== 'string'
    || !visibleIds.has(request.id)) return undefined;
  return request.id;
}

function sourcePosition(line: number, column: number, document: SourceMappingDocument): SourcePosition | undefined {
  const text = document.lineAt(line - 1).text;
  const characters = Array.from(text);
  if (column > characters.length + 1) return undefined;
  return { line: line - 1, character: characters.slice(0, column - 1).join('').length };
}

function compare(a: SourcePosition, b: SourcePosition): number {
  return a.line === b.line ? a.character - b.character : a.line - b.line;
}
