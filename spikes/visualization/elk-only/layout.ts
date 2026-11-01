import type { ElkEdgeSection, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { ArchitectureElement, ArchitectureFixture } from '../webview/src/model';

function lines(context: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string[] {
  context.font = font;
  return text.split('\n').flatMap((paragraph) => {
    const words = paragraph.split(/\s+/);
    const result: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        result.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) result.push(line);
    return result;
  });
}

function measureElement(context: CanvasRenderingContext2D, element: ArchitectureElement) {
  context.font = '600 13px system-ui';
  const width = Math.min(280, Math.max(184, Math.ceil(context.measureText(element.name).width + 32)));
  const contentWidth = width - 24;
  const titleLines = lines(context, element.name, contentWidth, '600 13px system-ui').length;
  const descriptionLines = lines(context, element.description, contentWidth, '11px system-ui').length;
  const technologyLines = element.technology ? lines(context, element.technology, contentWidth, 'italic 10px system-ui').length : 0;
  return { width, height: Math.max(86, 42 + titleLines * 18 + descriptionLines * 15 + technologyLines * 14) };
}

function measureLabel(context: CanvasRenderingContext2D, text: string) {
  const wrapped = lines(context, text, 214, '10px system-ui');
  const width = Math.min(230, Math.max(64, ...wrapped.map((line) => {
    context.font = '10px system-ui';
    return context.measureText(line).width + 14;
  })));
  return { width, height: wrapped.length * 14 + 8 };
}

function buildNode(context: CanvasRenderingContext2D, element: ArchitectureElement, fixture: ArchitectureFixture): ElkNode {
  if (element.kind === 'system') {
    context.font = '600 13px system-ui';
    return {
      id: element.id,
      labels: [{ id: `${element.id}-title`, text: element.name, width: context.measureText(element.name).width + 12, height: 22 }],
      children: fixture.elements.filter((child) => child.parentId === element.id).map((child) => buildNode(context, child, fixture)),
      layoutOptions: {
        'elk.padding': '[top=52,left=24,bottom=24,right=24]',
        'elk.nodeLabels.placement': 'INSIDE|TOP|H_CENTER',
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
      },
    };
  }
  return { id: element.id, ...measureElement(context, element) };
}

/** The exact input graph used by the standalone ELK + SVG spike. */
export function buildDirectElkGraph(fixture: ArchitectureFixture, context: CanvasRenderingContext2D): ElkNode {
  context.font = '600 13px system-ui';
  const children = fixture.elements.filter((element) => !element.parentId).map((element) => buildNode(context, element, fixture));
  const edges: ElkExtendedEdge[] = fixture.relationships.map((relationship) => {
    const text = [relationship.label, relationship.technology].filter(Boolean).join(' · ');
    return {
      id: relationship.id,
      sources: [relationship.sourceId],
      targets: [relationship.targetId],
      labels: [{ id: `${relationship.id}-label`, text, ...measureLabel(context, text) }],
    };
  });
  return {
    id: 'root',
    children,
    edges,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.spacing.edgeLabel': '12',
      'elk.padding': '[top=36,left=32,bottom=36,right=32]',
    },
  };
}

type RouteBounds = Pick<ElkNode, 'x' | 'y' | 'width' | 'height'>;

export function buildManualReturnRoute(source: RouteBounds, sourceSystem: RouteBounds, target: RouteBounds, targetSystem: RouteBounds, label: { width: number; height: number }) {
  const startPoint = { x: source.x ?? 0, y: (source.y ?? 0) + (source.height ?? 0) / 2 };
  const endPoint = { x: (target.x ?? 0) + (target.width ?? 0) / 2, y: (target.y ?? 0) + (target.height ?? 0) };
  const exitX = (sourceSystem.x ?? 0) - 16;
  const laneY = Math.max(
    (sourceSystem.y ?? 0) + (sourceSystem.height ?? 0),
    (targetSystem.y ?? 0) + (targetSystem.height ?? 0),
  ) + 16;
  const section: ElkEdgeSection = {
    id: 'r-payment-order-result-manual',
    startPoint,
    bendPoints: [{ x: exitX, y: startPoint.y }, { x: exitX, y: laneY }, { x: endPoint.x, y: laneY }],
    endPoint,
  };
  return {
    section,
    label: { x: (exitX + endPoint.x) / 2 - label.width / 2, y: laneY + 6 },
    bottom: laneY + label.height + 24,
  };
}
