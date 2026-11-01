export type LocationDto = { file: string; line: number; column: number; endLine: number; endColumn: number };
export type ElementDto = {
  id: string; kind: 'person' | 'container'; name: string; description: string | null;
  technology: string | null; tags: string[]; parentId: string | null; source: LocationDto | null;
};
export type BoundaryDto = { id: string; name: string; description: string | null; source: LocationDto | null };
export type RelationshipDto = {
  id: string; sourceId: string; targetId: string; label: string;
  technology: string | null; source: LocationDto | null;
};
export type ResolvedViewDto = {
  key: string; scopeId: string; elements: ElementDto[]; boundaries: BoundaryDto[];
  relationships: RelationshipDto[]; layoutDirection: 'lr' | null;
};
export type DiagnosticDto = {
  code: string; severity: 'error' | 'warning'; message: string;
  location: LocationDto | null; related?: { message: string; location: LocationDto | null }[];
};
export type PreviewResult =
  | { schemaVersion: 1; status: 'ok'; view: ResolvedViewDto }
  | { schemaVersion: 1; status: 'error'; diagnostics: DiagnosticDto[] };

const diagnosticCodes = new Set([
  'syntax', 'unsupported-feature', 'duplicate-identifier', 'unknown-reference',
  'semantic', 'view-not-found', 'host', 'transport',
]);

export function parsePreviewJson(text: string): PreviewResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateResult(value);
}

function validateResult(value: unknown): PreviewResult {
  const result = record(value, 'result');
  assertInteger(result.schemaVersion, 'schemaVersion');
  if (result.schemaVersion !== 1) throw new TypeError('Unsupported preview schema version.');

  if (result.status === 'error') {
    exactKeys(result, ['schemaVersion', 'status', 'diagnostics']);
    if (!Array.isArray(result.diagnostics) || result.diagnostics.length === 0) {
      throw new TypeError('Error result must contain diagnostics and no view.');
    }
    result.diagnostics.forEach(validateDiagnostic);
    return result as PreviewResult;
  }
  if (result.status !== 'ok') throw new TypeError('Result status must be "ok" or "error".');
  exactKeys(result, ['schemaVersion', 'status', 'view']);
  validateView(result.view);
  return result as PreviewResult;
}

function validateView(value: unknown): void {
  const view = record(value, 'view');
  exactKeys(view, ['key', 'scopeId', 'elements', 'boundaries', 'relationships', 'layoutDirection']);
  assertString(view.key, 'view.key');
  assertString(view.scopeId, 'view.scopeId');
  if (view.layoutDirection !== null && view.layoutDirection !== 'lr') {
    throw new TypeError('view.layoutDirection must be null or "lr".');
  }
  if (!Array.isArray(view.elements) || !Array.isArray(view.boundaries) || !Array.isArray(view.relationships)) {
    throw new TypeError('View elements, boundaries, and relationships must be arrays.');
  }

  const ids = new Set<string>();
  const selected = new Set<string>();
  const parents = new Map<string, string>();
  for (const value of view.elements) {
    const element = record(value, 'element');
    exactKeys(element, ['id', 'kind', 'name', 'description', 'technology', 'tags', 'parentId', 'source']);
    addUnique(ids, element.id, 'element');
    selected.add(element.id as string);
    assertString(element.name, 'element.name');
    if (element.kind !== 'person' && element.kind !== 'container') throw new TypeError('Element kind must be person or container.');
    assertNullableString(element.description, 'element.description');
    assertNullableString(element.technology, 'element.technology');
    if (!Array.isArray(element.tags) || !element.tags.every((tag) => typeof tag === 'string')) {
      throw new TypeError('element.tags must be an array of strings.');
    }
    assertNullableString(element.parentId, 'element.parentId');
    if (element.kind === 'person' && element.parentId !== null) throw new TypeError('A person cannot have a container parent.');
    if (element.kind === 'container') {
      if (typeof element.parentId !== 'string' || element.parentId.length === 0) throw new TypeError('A container must reference its system parent.');
      parents.set(element.id as string, element.parentId);
    }
    validateNullableLocation(element.source, 'element.source');
  }

  const boundaryIds = new Set<string>();
  for (const value of view.boundaries) {
    const boundary = record(value, 'boundary');
    exactKeys(boundary, ['id', 'name', 'description', 'source']);
    addUnique(ids, boundary.id, 'boundary');
    boundaryIds.add(boundary.id as string);
    assertString(boundary.name, 'boundary.name');
    assertNullableString(boundary.description, 'boundary.description');
    validateNullableLocation(boundary.source, 'boundary.source');
  }
  for (const parent of parents.values()) {
    if (!boundaryIds.has(parent)) throw new TypeError('Container parent is missing from the view boundaries.');
  }

  for (const value of view.relationships) {
    const relationship = record(value, 'relationship');
    exactKeys(relationship, ['id', 'sourceId', 'targetId', 'label', 'technology', 'source']);
    addUnique(ids, relationship.id, 'relationship');
    assertString(relationship.label, 'relationship.label');
    assertNullableString(relationship.technology, 'relationship.technology');
    if (!selected.has(assertString(relationship.sourceId, 'relationship.sourceId'))
      || !selected.has(assertString(relationship.targetId, 'relationship.targetId'))) {
      throw new TypeError('Relationship endpoint is not a selected element.');
    }
    validateNullableLocation(relationship.source, 'relationship.source');
  }
}

function validateDiagnostic(value: unknown): void {
  const diagnostic = record(value, 'diagnostic');
  exactKeys(diagnostic, ['code', 'severity', 'message', 'location'], ['related']);
  if (typeof diagnostic.code !== 'string' || !diagnosticCodes.has(diagnostic.code)) throw new TypeError('Unknown diagnostic code.');
  if (diagnostic.severity !== 'error' && diagnostic.severity !== 'warning') throw new TypeError('Invalid diagnostic severity.');
  assertString(diagnostic.message, 'diagnostic.message');
  validateNullableLocation(diagnostic.location, 'diagnostic.location');
  if (diagnostic.related !== undefined) {
    if (!Array.isArray(diagnostic.related)) throw new TypeError('diagnostic.related must be an array.');
    diagnostic.related.forEach((value) => {
      const related = record(value, 'related diagnostic');
      exactKeys(related, ['message', 'location']);
      assertString(related.message, 'related.message');
      validateNullableLocation(related.location, 'related.location');
    });
  }
}

function validateNullableLocation(value: unknown, label: string): void {
  if (value === null) return;
  const location = record(value, label);
  exactKeys(location, ['file', 'line', 'column', 'endLine', 'endColumn']);
  assertString(location.file, `${label}.file`);
  const line = assertInteger(location.line, `${label}.line`);
  const column = assertInteger(location.column, `${label}.column`);
  const endLine = assertInteger(location.endLine, `${label}.endLine`);
  const endColumn = assertInteger(location.endColumn, `${label}.endColumn`);
  if (line < 1 || column < 1 || endLine < line || endColumn < 1 || (endLine === line && endColumn < column)) {
    throw new TypeError(`${label} has an invalid range.`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TypeError('Invalid result shape: missing or unexpected fields.');
  }
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a nonempty string.`);
  return value;
}

function assertNullableString(value: unknown, label: string): void {
  if (value !== null && typeof value !== 'string') throw new TypeError(`${label} must be a string or null.`);
}

function assertInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeError(`${label} must be an integer.`);
  return value;
}

function addUnique(ids: Set<string>, value: unknown, label: string): void {
  const id = assertString(value, `${label}.id`);
  if (ids.has(id)) throw new TypeError(`Duplicate ${label} ID: ${id}`);
  ids.add(id);
}
