import 'reflect-metadata';
import 'sprotty/css/sprotty.css';
import './style.css';
import { LocalModelSource, TYPES } from 'sprotty';
import { FitToScreenAction } from 'sprotty-protocol';
import small from '../fixtures/small.json';
import large from '../fixtures/large.json';
import type { ArchitectureFixture, ArchitectureElement } from '../webview/src/model';
import createContainer from './sprotty-config';

const fixtures = { small: small as ArchitectureFixture, large: large as ArchitectureFixture };
const container = createContainer('diagram');
const source = container.get<LocalModelSource>(TYPES.ModelSource);
const select = document.querySelector<HTMLSelectElement>('#fixture')!;

function toModel(fixture: ArchitectureFixture) {
  const children = new Map<string | undefined, ArchitectureElement[]>();
  for (const element of fixture.elements) {
    const siblings = children.get(element.parentId) ?? [];
    siblings.push(element);
    children.set(element.parentId, siblings);
  }
  const node = (element: ArchitectureElement) => ({
    id: element.id,
    type: 'node',
    cssClasses: [`c4-${element.kind}`],
    layout: 'vbox',
    children: [
      { id: `${element.id}-kind`, type: 'label:node', text: element.kind.toUpperCase(), cssClasses: ['c4-kind'] },
      { id: `${element.id}-name`, type: 'label:node', text: element.name, cssClasses: ['c4-name'] },
      ...(element.description ? [{ id: `${element.id}-description`, type: 'label:node', text: element.description, cssClasses: ['c4-description'] }] : []),
      ...(element.technology ? [{ id: `${element.id}-technology`, type: 'label:node', text: element.technology, cssClasses: ['c4-technology'] }] : []),
      ...(children.get(element.id) ?? []).map(node),
    ],
  });
  return {
    id: fixture.id,
    type: 'graph',
    layoutOptions: {
      'org.eclipse.elk.algorithm': 'org.eclipse.elk.layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.spacing.nodeNode': '36',
    'elk.layered.spacing.nodeNodeBetweenLayers': '72',
    'elk.spacing.edgeEdge': '24',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '24',
    'elk.spacing.edgeLabel': '10',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: [
      ...(children.get(undefined) ?? []).map(node),
      ...fixture.relationships.map((relationship) => ({
        id: relationship.id,
        type: 'edge',
        sourceId: relationship.sourceId,
        targetId: relationship.targetId,
        children: [{
          id: `${relationship.id}-label`,
          type: 'label:edge',
          text: `${relationship.label}${relationship.technology ? ` · ${relationship.technology}` : ''}`,
        }],
      })),
    ],
  };
}

async function fitDiagram() {
  await source.actionDispatcher.dispatch(FitToScreenAction.create([], { padding: 36, animate: false }));
}

async function showFixture() {
  await source.setModel(toModel(fixtures[select.value as keyof typeof fixtures]));
  await fitDiagram();
}

select.addEventListener('change', showFixture);
document.querySelector('#fit')!.addEventListener('click', fitDiagram);
showFixture();
