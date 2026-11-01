import type { ResolvedViewDto } from './contract';

export function buildMermaidDefinition(view: ResolvedViewDto): string {
  const elementIds = new Map(view.elements.map((element, index) => [element.id, `n${index}`]));
  const boundaryIds = new Map(view.boundaries.map((boundary, index) => [boundary.id, `s${index}`]));
  const definitions = ['flowchart LR'];
  const classes: Record<string, string[]> = { person: [], container: [], database: [] };

  for (const boundary of view.boundaries) {
    const boundaryToken = boundaryIds.get(boundary.id)!;
    definitions.push(`subgraph ${boundaryToken}["${escapeHtml(boundary.name)}"]`, 'direction LR');
    for (const element of view.elements.filter((candidate) => candidate.parentId === boundary.id)) {
      const id = elementIds.get(element.id)!;
      definitions.push(`  ${id}["${elementLabel(element.kind, element.name, element.description, element.technology)}"]`);
      classes.container.push(id);
      if (element.tags.includes('Database')) classes.database.push(id);
    }
    definitions.push('end', `style ${boundaryToken} fill:#edf2fb,stroke:#7587a8,stroke-width:1.5px,stroke-dasharray:7 4`);
  }

  for (const element of view.elements.filter((candidate) => candidate.kind === 'person')) {
    const id = elementIds.get(element.id)!;
    definitions.push(`${id}["${elementLabel('person', element.name, element.description, element.technology)}"]`);
    classes.person.push(id);
  }

  for (const relationship of view.relationships) {
    const label = escapeHtml([relationship.label, relationship.technology].filter(Boolean).join(' · '));
    definitions.push(`${elementIds.get(relationship.sourceId)} -->|"${label}"| ${elementIds.get(relationship.targetId)}`);
  }

  for (const [kind, ids] of Object.entries(classes)) {
    if (ids.length) definitions.push(`class ${ids.join(',')} ${kind}`);
  }
  definitions.push(
    'classDef person fill:#fff8e8,stroke:#a56d18,color:#172033',
    'classDef container fill:#fff,stroke:#465977,color:#172033',
    'classDef database fill:#eef8f3,stroke:#328060,color:#172033',
  );
  return definitions.join('\n');
}

function elementLabel(kind: string, name: string, description: string | null, technology: string | null): string {
  return [kind.toUpperCase(), name, description, technology]
    .filter((line): line is string => typeof line === 'string' && line.length > 0)
    .map(escapeHtml)
    .join('<br/>');
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('|', '&#124;')
    .replaceAll('\r', '&#13;').replaceAll('\n', '&#10;');
}
