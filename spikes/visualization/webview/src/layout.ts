import type { Edge, Node } from '@xyflow/react';
import { MarkerType, Position } from '@xyflow/react';
import type { ElkEdgeSection, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { ArchitectureElement, ArchitectureFixture, ArchitectureRelationship } from './model';
import { buildManualReturnRoute } from '../../elk-only/layout';

export interface MeasuredElement {
  width: number;
  height: number;
}

export interface RelationshipView {
  relationship: ArchitectureRelationship;
  sections: ElkEdgeSection[];
  label?: { x: number; y: number; width: number; height: number };
}

export type C4Node = Node<{ element: ArchitectureElement }, 'c4'>;
export type RoutedEdge = Edge<{ relationship: ArchitectureRelationship; sections: ElkEdgeSection[]; label?: RelationshipView['label'] }, 'routed'>;

export interface LayoutRequest {
  id: number;
  graph: ElkNode;
}

export type LayoutResponse =
  | { id: number; graph: ElkNode }
  | { id: number; error: string };

export function isCurrentLayoutRevision(requestRevision: number, currentRevision: number): boolean {
  return requestRevision === currentRevision;
}

export function measureFixture(fixture: ArchitectureFixture, context: CanvasRenderingContext2D): Map<string, MeasuredElement> {
  const measurements = new Map<string, MeasuredElement>();
  for (const element of fixture.elements) {
    context.font = '13px sans-serif';
    const titleWidth = context.measureText(element.name).width;
    const width = Math.min(280, Math.max(184, Math.ceil(Math.min(titleWidth, 240) + 36)));
    const textWidth = width - 30;
    const lines = (value: string, font: string) => {
      context.font = font;
      return value.split('\n').reduce((count, paragraph) => {
        let line = '';
        let wrapped = 1;
        for (const word of paragraph.split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (line && context.measureText(candidate).width > textWidth) {
            wrapped++;
            line = word;
          } else line = candidate;
        }
        return count + wrapped;
      }, 0);
    };
    const titleLines = lines(element.name, '700 14px sans-serif');
    const descriptionLines = element.kind === 'system' ? 0 : lines(element.description, '12px sans-serif');
    const technologyLines = element.kind === 'system' || !element.technology ? 0 : lines(element.technology, '11px sans-serif');
    const hasPersonIcon = element.kind === 'person';
    const contentRows = 2 + Number(element.kind !== 'system') + Number(technologyLines > 0) + Number(hasPersonIcon);
    measurements.set(element.id, {
      width,
      height: element.kind === 'system' ? 0 : Math.ceil(
        2 + (element.kind === 'person' ? 35 : 26) + Math.max(0, contentRows - 1) * 6
        + 11 + titleLines * 17.5 + descriptionLines * 16.2 + technologyLines * 12.65 + Number(hasPersonIcon) * 14,
      ),
    });
  }
  return measurements;
}

export function buildElkGraph(fixture: ArchitectureFixture, measurements: Map<string, MeasuredElement>, context?: CanvasRenderingContext2D): ElkNode {
  const children = fixture.elements
    .filter((element) => !element.parentId)
    .map((element) => buildElkNode(element, fixture, measurements));
  const edges: ElkExtendedEdge[] = fixture.relationships.map((relationship) => {
    const label = [relationship.label, relationship.technology].filter(Boolean).join(' · ');
    return {
      id: relationship.id,
      sources: [relationship.sourceId],
      targets: [relationship.targetId],
      labels: [{ id: `${relationship.id}-label`, text: label, ...measureLabel(label, context) }],
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
      'elk.layered.crossingMinimization.semiInteractive': 'true',
    },
  };
}

function buildElkNode(element: ArchitectureElement, fixture: ArchitectureFixture, measurements: Map<string, MeasuredElement>): ElkNode {
  const size = measurements.get(element.id)!;
  const node: ElkNode = {
    id: element.id,
    width: size.width,
    height: size.height,
  };
  if (element.kind === 'system') {
    node.labels = [{ id: `${element.id}-title`, text: element.name, width: Math.ceil(Math.min(240, element.name.length * 8) + 8), height: 24 }];
    node.children = fixture.elements
      .filter((child) => child.parentId === element.id)
      .map((child) => buildElkNode(child, fixture, measurements));
    node.layoutOptions = {
      'elk.padding': '[top=56,left=24,bottom=24,right=24]',
      'elk.nodeLabels.placement': 'INSIDE|TOP|H_CENTER',
      'elk.nodeSize.constraints': 'MINIMUM_SIZE',
    };
  }
  return node;
}

function measureLabel(text: string, context?: CanvasRenderingContext2D): { width: number; height: number } {
  context && (context.font = '10px sans-serif');
  const measured = context?.measureText(text).width ?? text.length * 5.6;
  const width = Math.min(230, Math.max(64, measured + 16));
  const contentWidth = width - 16;
  const lines = text.split('\n').reduce((total, line) => {
    const lineWidth = context?.measureText(line).width ?? line.length * 5.6;
    return total + Math.max(1, Math.ceil(lineWidth / contentWidth));
  }, 0);
  return { width, height: Math.max(20, lines * 16 + 4) };
}

export function mapElkNodes(graph: ElkNode, fixture: ArchitectureFixture): C4Node[] {
  const elements = new Map(fixture.elements.map((element) => [element.id, element]));
  const nodes: C4Node[] = [];
  const visit = (elkNode: ElkNode, parentId?: string) => {
    if (elkNode.id !== 'root') {
      const element = elements.get(elkNode.id);
      if (element) {
        nodes.push({
          id: element.id,
          type: 'c4',
          position: { x: elkNode.x ?? 0, y: elkNode.y ?? 0 },
          parentId,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          focusable: true,
          ariaLabel: `${element.kind}: ${element.name}`,
          style: { width: elkNode.width ?? 184, height: elkNode.height ?? 76 },
          data: { element },
        });
      }
    }
    for (const child of elkNode.children ?? []) visit(child, elkNode.id === 'root' ? undefined : elkNode.id);
  };
  visit(graph);
  return nodes;
}

export function mapElkEdges(graph: ElkNode, fixture: ArchitectureFixture): RoutedEdge[] {
  const edgeById = new Map((graph.edges ?? []).map((edge) => [edge.id, edge]));
  const origins = new Map<string, { x: number; y: number }>();
  const visit = (node: ElkNode, parentX = 0, parentY = 0) => {
    const x = parentX + (node.x ?? 0);
    const y = parentY + (node.y ?? 0);
    origins.set(node.id, { x, y });
    for (const child of node.children ?? []) visit(child, x, y);
  };
  visit(graph);
  return fixture.relationships.map((relationship) => {
    const elkEdge = edgeById.get(relationship.id);
    const origin = origins.get(elkEdge?.container ?? '') ?? { x: 0, y: 0 };
    const label = elkEdge?.labels?.[0];
    return {
      id: relationship.id,
      type: 'routed',
      source: relationship.sourceId,
      target: relationship.targetId,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        relationship,
        sections: elkEdge?.sections?.map((section) => ({
          ...section,
          startPoint: { x: section.startPoint.x + origin.x, y: section.startPoint.y + origin.y },
          endPoint: { x: section.endPoint.x + origin.x, y: section.endPoint.y + origin.y },
          bendPoints: section.bendPoints?.map((point) => ({ x: point.x + origin.x, y: point.y + origin.y })),
        })) ?? [],
        label: label?.x === undefined || label.y === undefined ? undefined : {
          x: label.x + origin.x + (label.width ?? 0) / 2,
          y: label.y + origin.y + (label.height ?? 0) / 2,
          width: label.width ?? 0,
          height: label.height ?? 0,
        },
      },
      ariaLabel: relationship.label,
      focusable: true,
    };
  });
}

export function withManualReturnRoute(edges: RoutedEdge[], nodes: C4Node[]): RoutedEdge[] {
  const edge = edges.find((candidate) => candidate.id === 'r-payment-order-result');
  if (!edge?.data?.label) return edges;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const box = (id: string) => {
    const node = byId.get(id);
    const position = getAbsolutePosition(id, nodes);
    if (!node || !position) return undefined;
    return { ...position, width: Number(node.style?.width), height: Number(node.style?.height) };
  };
  const source = box('payment-api');
  const sourceSystem = byId.get('payment-api')?.parentId;
  const target = box('order-api');
  const targetSystem = byId.get('order-api')?.parentId;
  const sourceBoundary = sourceSystem ? box(sourceSystem) : undefined;
  const targetBoundary = targetSystem ? box(targetSystem) : undefined;
  if (!source || !sourceBoundary || !target || !targetBoundary) return edges;

  const route = buildManualReturnRoute(source, sourceBoundary, target, targetBoundary, edge.data.label);
  return edges.map((candidate) => candidate.id !== edge.id ? candidate : {
    ...candidate,
    data: {
      ...candidate.data!,
      sections: [route.section],
      label: { ...candidate.data!.label!, x: route.label.x + candidate.data!.label!.width / 2, y: route.label.y + candidate.data!.label!.height / 2 },
    },
  });
}

export function preserveNodeGeometry(nodes: C4Node[], fixture: ArchitectureFixture): C4Node[] {
  const elements = new Map(fixture.elements.map((element) => [element.id, element]));
  return nodes.flatMap((node) => {
    const element = elements.get(node.id);
    return element ? [node.data.element === element ? node : { ...node, data: { element } }] : [];
  });
}

export function preserveEdgeRoutes(edges: RoutedEdge[], fixture: ArchitectureFixture): RoutedEdge[] {
  const oldEdges = new Map(edges.map((edge) => [edge.id, edge]));
  return fixture.relationships.flatMap((relationship) => {
    const edge = oldEdges.get(relationship.id);
    if (!edge) return [];
    return edge.data?.relationship === relationship ? [edge] : [{ ...edge, data: { ...edge.data, relationship, sections: edge.data?.sections ?? [] } }];
  });
}

export function getAbsolutePosition(nodeId: string, nodes: C4Node[]): { x: number; y: number } | undefined {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let node = byId.get(nodeId);
  if (!node) return undefined;
  let { x, y } = node.position;
  while (node.parentId) {
    node = byId.get(node.parentId);
    if (!node) return undefined;
    x += node.position.x;
    y += node.position.y;
  }
  return { x, y };
}

export function createLayoutClient(workerUrl: string): { layout(graph: ElkNode): Promise<ElkNode>; dispose(): void } {
  const worker = new WorkerClient(workerUrl);
  return { layout: (graph) => worker.layout(graph), dispose: () => worker.dispose() };
}

class WorkerClient {
  private worker?: Worker;
  private blobUrl?: string;
  private ready?: Promise<Worker>;
  private nextId = 0;
  private pending = new Map<number, { resolve: (graph: ElkNode) => void; reject: (error: Error) => void }>();

  constructor(private readonly workerUrl: string) {}

  async layout(graph: ElkNode): Promise<ElkNode> {
    const worker = await this.getWorker();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, graph } satisfies LayoutRequest);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    for (const pending of this.pending.values()) pending.reject(new Error('Layout worker terminated'));
    this.pending.clear();
  }

  private getWorker(): Promise<Worker> {
    if (this.worker) return Promise.resolve(this.worker);
    this.ready ??= fetch(this.workerUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load layout worker (${response.status})`);
        return response.text();
      })
      .then((script) => {
        this.blobUrl = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
        this.worker = new Worker(this.blobUrl);
        this.worker.onmessage = ({ data }: MessageEvent<LayoutResponse>) => {
          const pending = this.pending.get(data.id);
          if (!pending) return;
          this.pending.delete(data.id);
          if ('error' in data) pending.reject(new Error(data.error));
          else pending.resolve(data.graph);
        };
        this.worker.onerror = (event) => {
          for (const pending of this.pending.values()) pending.reject(new Error(event.message || 'Layout worker failed'));
          this.pending.clear();
        };
        return this.worker;
      });
    return this.ready;
  }
}
