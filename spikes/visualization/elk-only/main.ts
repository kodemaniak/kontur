import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import small from '../fixtures/small.json';
import large from '../fixtures/large.json';
import type { ArchitectureElement, ArchitectureFixture, ArchitectureRelationship } from '../webview/src/model';
import { buildDirectElkGraph, buildManualReturnRoute } from './layout';
import './style.css';

const elk = new ELK();
const ns = 'http://www.w3.org/2000/svg';
const fixtures: Record<string, ArchitectureFixture> = {
  small: small as ArchitectureFixture,
  large: large as ArchitectureFixture,
};
const svg = document.createElementNS(ns, 'svg');
svg.setAttribute('role', 'img');
svg.setAttribute('aria-label', 'ELK-laid-out architecture graph');
document.querySelector('#diagram')!.append(svg);

type Box = { x: number; y: number; width: number; height: number };
type PositionedNode = { element: ArchitectureElement; box: Box; parentId?: string };
let viewBox: Box = { x: 0, y: 0, width: 1, height: 1 };
let fittedViewBox: Box = { ...viewBox };
let pointer: { x: number; y: number; viewBox: Box } | undefined;
let generation = 0;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function wrap(text: string, maxWidth: number, font: string): string[] {
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = font;
  return text.split('\n').flatMap((paragraph) => {
    const words = paragraph.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  });
}

function collectNodes(graph: ElkNode, fixture: ArchitectureFixture): Map<string, PositionedNode> {
  const elements = new Map(fixture.elements.map((element) => [element.id, element]));
  const nodes = new Map<string, PositionedNode>();
  const visit = (node: ElkNode, parentX = 0, parentY = 0, parentId?: string) => {
    if (node.id !== 'root') {
      const element = elements.get(node.id);
      if (element) nodes.set(node.id, {
        element,
        parentId,
        box: { x: parentX + (node.x ?? 0), y: parentY + (node.y ?? 0), width: node.width ?? 0, height: node.height ?? 0 },
      });
    }
    const x = parentX + (node.x ?? 0);
    const y = parentY + (node.y ?? 0);
    for (const child of node.children ?? []) visit(child, x, y, node.id === 'root' ? undefined : node.id);
  };
  visit(graph);
  return nodes;
}

function translatedEdges(graph: ElkNode, positions: Map<string, PositionedNode>): ElkExtendedEdge[] {
  return (graph.edges ?? []).map((edge) => {
    const origin = edge.container === 'root' ? undefined : positions.get(edge.container ?? '');
    const dx = origin?.box.x ?? 0;
    const dy = origin?.box.y ?? 0;
    return {
      ...edge,
      sections: edge.sections?.map((section) => ({
        ...section,
        startPoint: { x: section.startPoint.x + dx, y: section.startPoint.y + dy },
        endPoint: { x: section.endPoint.x + dx, y: section.endPoint.y + dy },
        bendPoints: section.bendPoints?.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      })),
      labels: edge.labels?.map((label) => ({ ...label, x: (label.x ?? 0) + dx, y: (label.y ?? 0) + dy })),
    };
  });
}

function applyManualReturnRoute(edge: ElkExtendedEdge | undefined, positions: Map<string, PositionedNode>): number {
  if (!edge) return 0;
  const source = positions.get('payment-api');
  const sourceSystem = source?.parentId ? positions.get(source.parentId) : undefined;
  const target = positions.get('order-api');
  const targetSystem = target?.parentId ? positions.get(target.parentId) : undefined;
  if (!source || !sourceSystem || !target || !targetSystem) return 0;
  const label = edge.labels?.[0];
  const route = buildManualReturnRoute(
    { ...source.box }, { ...sourceSystem.box }, { ...target.box }, { ...targetSystem.box },
    { width: label?.width ?? 0, height: label?.height ?? 0 },
  );
  edge.sections = [route.section];
  edge.labels = edge.labels?.map((label) => label.id === `${edge.id}-label`
    ? { ...label, x: route.label.x, y: route.label.y }
    : label);
  return route.bottom;
}

function drawSystemBoundary(node: PositionedNode): SVGGElement {
  const { element, box } = node;
  const group = el('g', { class: 'element element-system', 'data-node-id': element.id, 'data-node-kind': 'system', 'data-parent-id': '' });
  group.append(el('rect', { x: box.x, y: box.y, width: box.width, height: box.height, rx: 10, class: 'system-boundary' }));
  return group;
}

function drawSystemTitle(node: PositionedNode): SVGTextElement {
  return el('text', {
    x: node.box.x + node.box.width / 2,
    y: node.box.y + 25,
    class: 'element-title',
    'text-anchor': 'middle',
    'data-system-title': node.element.id,
  }, node.element.name);
}

function drawElement(node: PositionedNode): SVGGElement {
  const { element, box } = node;
  const group = el('g', { class: `element element-${element.kind}`, 'data-node-id': element.id, 'data-node-kind': element.kind, 'data-parent-id': node.parentId ?? '' });
  const rect = el('rect', { x: box.x, y: box.y, width: box.width, height: box.height, rx: 5, class: `element-box element-${element.kind}` });
  group.append(rect);
  const contentWidth = box.width - 20;
  group.append(el('text', { x: box.x + 10, y: box.y + 14, class: 'element-kind' }, element.kind.toUpperCase()));
  const lines: Array<{ text: string; className: string; font: string; lineHeight: number }> = [
    ...wrap(element.name, contentWidth, '600 13px system-ui').map((text) => ({ text, className: 'element-title', font: '600 13px system-ui', lineHeight: 16 })),
    ...wrap(element.description, contentWidth, '11px system-ui').map((text) => ({ text, className: 'element-description', font: '11px system-ui', lineHeight: 14 })),
    ...(element.technology ? wrap(element.technology, contentWidth, 'italic 10px system-ui').map((text) => ({ text, className: 'element-technology', font: 'italic 10px system-ui', lineHeight: 13 })) : []),
  ];
  let y = box.y + 33;
  for (const line of lines) {
    group.append(el('text', { x: box.x + 10, y, class: line.className }, line.text));
    y += line.lineHeight;
  }
  return group;
}

function drawEdge(edge: ElkExtendedEdge, relationship: ArchitectureRelationship): SVGGElement {
  const group = el('g', { class: 'relationship', 'data-edge-id': relationship.id, 'data-source-id': relationship.sourceId, 'data-target-id': relationship.targetId });
  for (const section of edge.sections ?? []) {
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    group.append(el('path', { d: path, class: 'edge-path', 'marker-end': 'url(#arrow)', 'data-route': 'true' }));
  }
  return group;
}

function setViewBox(box: Box) {
  viewBox = box;
  svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
}

async function render(fixtureId: string) {
  const ticket = ++generation;
  const fixture = fixtures[fixtureId];
  const status = document.querySelector<HTMLOutputElement>('#status')!;
  status.value = 'ELK layout…';
  try {
    const context = document.createElement('canvas').getContext('2d')!;
    const graph = await elk.layout(buildDirectElkGraph(fixture, context));
    if (ticket !== generation) return;
    const positions = collectNodes(graph, fixture);
    const edges = translatedEdges(graph, positions);
    const routeSelector = document.querySelector<HTMLSelectElement>('#route-mode')!;
    const manualOption = routeSelector.querySelector<HTMLOptionElement>('option[value="manual"]')!;
    manualOption.disabled = fixtureId !== 'small';
    if (manualOption.disabled) routeSelector.value = 'elk';
    const manualRoute = routeSelector.value === 'manual';
    const manualRouteBottom = manualRoute
      ? applyManualReturnRoute(edges.find((edge) => edge.id === 'r-payment-order-result'), positions)
      : 0;
    svg.replaceChildren();
    svg.dataset.fixture = fixture.id;
    svg.dataset.nodeCount = String(positions.size);
    svg.dataset.edgeCount = String(edges.length);
    svg.dataset.routeMode = manualRoute ? 'manual' : 'elk';
    const defs = el('defs');
    const marker = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    marker.append(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#596b86' }));
    defs.append(marker);
    svg.append(defs);

    for (const node of positions.values()) {
      if (node.element.kind === 'system') svg.append(drawSystemBoundary(node));
    }
    for (const relationship of fixture.relationships) {
      const edge = edges.find((candidate) => candidate.id === relationship.id);
      if (edge) svg.append(drawEdge(edge, relationship));
    }
    for (const node of positions.values()) {
      if (node.element.kind !== 'system') svg.append(drawElement(node));
    }
    for (const node of positions.values()) {
      if (node.element.kind === 'system') svg.append(drawSystemTitle(node));
    }
    for (const relationship of fixture.relationships) {
      const edge = edges.find((candidate) => candidate.id === relationship.id);
      if (!edge) continue;
      for (const label of edge.labels ?? []) {
        const x = label.x ?? 0;
        const y = label.y ?? 0;
        const width = label.width ?? 0;
        const height = label.height ?? 0;
        const group = el('g', { 'data-label-for': relationship.id });
        group.append(el('rect', { x, y, width, height, rx: 3, class: 'edge-label-bg' }));
        const textLines = wrap(label.text ?? '', width - 12, '10px system-ui');
        const textNode = el('text', { x: x + width / 2, y: y + (height - (textLines.length - 1) * 14) / 2 + 3, class: 'edge-label', 'text-anchor': 'middle' });
        textLines.forEach((line, index) => textNode.append(el('tspan', { x: x + width / 2, dy: index ? 14 : 0 }, line)));
        group.append(textNode);
        svg.append(group);
      }
    }
    const graphBox = { x: 0, y: 0, width: graph.width ?? 1200, height: Math.max(graph.height ?? 800, manualRouteBottom) };
    fittedViewBox = graphBox;
    setViewBox(graphBox);
    status.value = `${positions.size} elements · ${edges.length} relationships`;
  } catch (error) {
    if (ticket === generation) status.value = `Layout failed: ${String(error)}`;
  }
}

document.querySelector<HTMLSelectElement>('#fixture')!.addEventListener('change', (event) => render((event.currentTarget as HTMLSelectElement).value));
document.querySelector<HTMLSelectElement>('#route-mode')!.addEventListener('change', () => render(document.querySelector<HTMLSelectElement>('#fixture')!.value));
document.querySelector('#fit')!.addEventListener('click', () => {
  setViewBox({ ...fittedViewBox });
});
svg.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = svg.getBoundingClientRect();
  const cx = viewBox.x + (event.clientX - rect.left) / rect.width * viewBox.width;
  const cy = viewBox.y + (event.clientY - rect.top) / rect.height * viewBox.height;
  const factor = event.deltaY < 0 ? 0.88 : 1 / 0.88;
  const width = Math.max(120, Math.min(10000, viewBox.width * factor));
  const height = viewBox.height * width / viewBox.width;
  setViewBox({ x: cx - (cx - viewBox.x) * factor, y: cy - (cy - viewBox.y) * factor, width, height });
}, { passive: false });
svg.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  pointer = { x: event.clientX, y: event.clientY, viewBox: { ...viewBox } };
  svg.setPointerCapture(event.pointerId);
});
svg.addEventListener('pointermove', (event) => {
  if (!pointer) return;
  const rect = svg.getBoundingClientRect();
  const dx = (event.clientX - pointer.x) * pointer.viewBox.width / rect.width;
  const dy = (event.clientY - pointer.y) * pointer.viewBox.height / rect.height;
  setViewBox({ ...pointer.viewBox, x: pointer.viewBox.x - dx, y: pointer.viewBox.y - dy });
});
svg.addEventListener('pointerup', () => { pointer = undefined; });
svg.addEventListener('pointercancel', () => { pointer = undefined; });
render('small');
