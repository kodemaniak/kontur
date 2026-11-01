export type ElementKind = 'person' | 'system' | 'container' | 'database';

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface ArchitectureElement {
  id: string;
  kind: ElementKind;
  name: string;
  description: string;
  technology?: string;
  parentId?: string;
  source: SourceLocation;
}

export interface ArchitectureRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  technology?: string;
  source: SourceLocation;
}

export interface ArchitectureFixture {
  id: string;
  title: string;
  sourceFile: string;
  mutationSource?: SourceLocation;
  elements: ArchitectureElement[];
  relationships: ArchitectureRelationship[];
}

export type FixtureIssue = { path: string; message: string };

export function validateFixture(fixture: ArchitectureFixture, sourceFiles: Map<string, string>): FixtureIssue[] {
  const issues: FixtureIssue[] = [];
  const elements = new Map<string, ArchitectureElement>();
  const ids = new Set<string>();

  for (const [index, element] of fixture.elements.entries()) {
    const path = `elements[${index}]`;
    if (!element.id || ids.has(element.id)) issues.push({ path: `${path}.id`, message: 'Element ID must be unique and non-empty' });
    ids.add(element.id);
    elements.set(element.id, element);
    checkSource(element.source, `${path}.source`, sourceFiles, issues);
    if (element.parentId && !fixture.elements.some((parent) => parent.id === element.parentId && parent.kind === 'system')) {
      issues.push({ path: `${path}.parentId`, message: 'Parent must reference an existing system' });
    }
  }

  const relationshipIds = new Set<string>();
  for (const [index, relationship] of fixture.relationships.entries()) {
    const path = `relationships[${index}]`;
    if (!relationship.id || relationshipIds.has(relationship.id)) issues.push({ path: `${path}.id`, message: 'Relationship ID must be unique and non-empty' });
    relationshipIds.add(relationship.id);
    if (!elements.has(relationship.sourceId)) issues.push({ path: `${path}.sourceId`, message: `Unknown element: ${relationship.sourceId}` });
    if (!elements.has(relationship.targetId)) issues.push({ path: `${path}.targetId`, message: `Unknown element: ${relationship.targetId}` });
    checkSource(relationship.source, `${path}.source`, sourceFiles, issues);
  }

  if (!sourceFiles.has(fixture.sourceFile)) issues.push({ path: 'sourceFile', message: `Missing source file: ${fixture.sourceFile}` });
  if (fixture.mutationSource) checkSource(fixture.mutationSource, 'mutationSource', sourceFiles, issues);
  return issues;
}

function checkSource(source: SourceLocation, path: string, files: Map<string, string>, issues: FixtureIssue[]): void {
  const text = files.get(source.file);
  if (text === undefined) {
    issues.push({ path: `${path}.file`, message: `Missing source file: ${source.file}` });
    return;
  }
  const lines = text.split('\n');
  const start = lines[source.line - 1];
  const end = lines[source.endLine - 1];
  if (!start || !end || source.endLine < source.line || source.column < 1 || source.column > start.length + 1 || source.endColumn < 1 || source.endColumn > end.length + 1 || (source.line === source.endLine && source.endColumn < source.column)) {
    issues.push({ path, message: `Invalid source range ${source.line}:${source.column}-${source.endLine}:${source.endColumn}` });
  }
}

export function mutateFixture(fixture: ArchitectureFixture, action: 'rename' | 'add' | 'remove'): ArchitectureFixture {
  if (action === 'rename') {
    const target = fixture.elements.find((element) => element.id === 'order-api') ?? fixture.elements.find((element) => element.kind === 'container');
    return {
      ...fixture,
      elements: fixture.elements.map((element) => element.id === target?.id ? {
        ...element,
        name: element.id === 'order-api' ? 'Order API' : element.name.replace(/1$/, '2'),
      } : element),
    };
  }

  if (action === 'add') {
    const source = fixture.mutationSource ?? fixture.elements[0]!.source;
    const parentId = fixture.elements.find((element) => element.kind === 'system')?.id;
    return {
      ...fixture,
      elements: fixture.elements.some((element) => element.id === 'notification-service') ? fixture.elements : [
        ...fixture.elements,
        { id: 'notification-service', kind: 'container', name: 'Notification service', description: 'Sends order updates', technology: 'Rust', parentId, source },
      ],
    };
  }

  return {
    ...fixture,
    elements: fixture.elements.filter((element) => element.id !== 'notification-service'),
    relationships: fixture.relationships.filter((relationship) => relationship.sourceId !== 'notification-service' && relationship.targetId !== 'notification-service'),
  };
}
