import dagre from '@dagrejs/dagre';
import small from '../fixtures/small.json';
import large from '../fixtures/large.json';
import type { ArchitectureElement, ArchitectureFixture, ArchitectureRelationship } from '../webview/src/model';
import './style.css';

const ns = 'http://www.w3.org/2000/svg';
const fixtures: Record<string, ArchitectureFixture> = { small: small as ArchitectureFixture, large: large as ArchitectureFixture };
const svg = document.createElementNS(ns, 'svg');
svg.setAttribute('role', 'img');
svg.setAttribute('aria-label', 'Dagre-laid-out architecture graph');
document.querySelector('#diagram')!.append(svg);

type Box = { x: number; y: number; width: number; height: number };
type LayoutNode = { element: ArchitectureElement; box: Box };
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

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string[] {
  context.font = font;
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = [];
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
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

function measureElement(context: CanvasRenderingContext2D, element: ArchitectureElement) {
  context.font = '600 13px system-ui';
  const width = Math.min(280, Math.max(184, Math.ceil(context.measureText(element.name).width + 32)));
  const contentWidth = width - 24;
  const title = wrap(context, element.name, contentWidth, '600 13px system-ui');
  const description = wrap(context, element.description, contentWidth, '11px system-ui');
  const technology = element.technology ? wrap(context, element.technology, contentWidth, 'italic 10px system-ui') : [];
  const height = Math.max(86, 42 + title.length * 18 + description.length * 15 + technology.length * 14);
  return { width, height };
}

function measureLabel(context: CanvasRenderingContext2D, text: string) {
  const lines = wrap(context, text, 214, '10px system-ui');
  const width = Math.min(230, Math.max(64, ...lines.map((line) => {
    context.font = '10px system-ui';
    return context.measureText(line).width + 14;
  })));
  return { width, height: lines.length * 14 + 8 };
}

function layoutFixture(fixture: ArchitectureFixture, context: CanvasRenderingContext2D) {
  const graph = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  graph.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 80, edgesep: 24, marginx: 36, marginy: 36, ranker: 'network-simplex' });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const element of fixture.elements) {
    if (element.kind === 'system') {
      graph.setNode(element.id, { label: element.name, padding: 24, paddingX: 24, paddingY: 24, labelpos: 't', rankdir: 'TB' });
    } else graph.setNode(element.id, { ...measureElement(context, element), label: element.name });
  }
  for (const element of fixture.elements) if (element.parentId) graph.setParent(element.id, element.parentId);
  for (const relationship of fixture.relationships) {
    const label = [relationship.label, relationship.technology].filter(Boolean).join(' · ');
    graph.setEdge(relationship.sourceId, relationship.targetId, { ...measureLabel(context, label), label }, relationship.id);
  }
  dagre.layout(graph);

  const nodes = new Map<string, LayoutNode>();
  for (const element of fixture.elements) {
    const node = graph.node(element.id);
    nodes.set(element.id, { element, box: { x: node.x - node.width / 2, y: node.y - node.height / 2, width: node.width, height: node.height } });
  }
  const edges = fixture.relationships.map((relationship) => ({
    relationship,
    geometry: graph.edge({ v: relationship.sourceId, w: relationship.targetId, name: relationship.id }),
    fallbackOffset: 0,
  }));
  const fallbackGroups = new Map<string, typeof edges>();
  for (const edge of edges) {
    if (edge.geometry.points?.length) continue;
    const ids = [edge.relationship.sourceId, edge.relationship.targetId].sort();
    const key = ids.join('\0');
    fallbackGroups.set(key, [...(fallbackGroups.get(key) ?? []), edge]);
  }
  for (const group of fallbackGroups.values()) {
    group.forEach((edge, index) => { edge.fallbackOffset = (index - (group.length - 1) / 2) * 48; });
  }
  return { graph, nodes, edges };
}

function systemBox(element: ArchitectureElement, nodes: Map<string, LayoutNode>): Box {
  const children = [...nodes.values()].filter((node) => node.element.parentId === element.id);
  const left = Math.min(...children.map(({ box }) => box.x));
  const top = Math.min(...children.map(({ box }) => box.y));
  const right = Math.max(...children.map(({ box }) => box.x + box.width));
  const bottom = Math.max(...children.map(({ box }) => box.y + box.height));
  return { x: left - 24, y: top - 44, width: right - left + 48, height: bottom - top + 68 };
}

function boundaryPoint(box: Box, toward: { x: number; y: number }) {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const scale = Math.min(box.width / 2 / Math.max(Math.abs(dx), 0.001), box.height / 2 / Math.max(Math.abs(dy), 0.001));
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function edgePoints(edge: { relationship: ArchitectureRelationship; geometry: { points?: Array<{ x: number; y: number }>; x?: number; y?: number }; fallbackOffset: number }, nodes: Map<string, LayoutNode>) {
  if (edge.geometry.points?.length) return {
    points: edge.geometry.points,
    fallback: false,
    labelPoint: { x: edge.geometry.x ?? edge.geometry.points[0]!.x, y: edge.geometry.y ?? edge.geometry.points[0]!.y },
  };
  const source = nodes.get(edge.relationship.sourceId)!.box;
  const target = nodes.get(edge.relationship.targetId)!.box;
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const start = boundaryPoint(source, targetCenter);
  const end = boundaryPoint(target, sourceCenter);
  const labelPoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 + edge.fallbackOffset };
  return { points: [start, labelPoint, end], fallback: true, labelPoint };
}

function drawSystem(node: LayoutNode, nodes: Map<string, LayoutNode>) {
  const box = systemBox(node.element, nodes);
  const group = el('g', { class: 'element element-system', 'data-node-id': node.element.id, 'data-node-kind': 'system', 'data-parent-id': '' });
  group.append(el('rect', { x: box.x, y: box.y, width: box.width, height: box.height, rx: 10, class: 'system-boundary' }));
  group.append(el('text', { x: box.x + box.width / 2, y: box.y + 25, class: 'system-title', 'text-anchor': 'middle' }, node.element.name));
  return group;
}

function drawElement(node: LayoutNode, context: CanvasRenderingContext2D) {
  const { element, box } = node;
  const group = el('g', { class: `element element-${element.kind}`, 'data-node-id': element.id, 'data-node-kind': element.kind, 'data-parent-id': element.parentId ?? '' });
  group.append(el('rect', { x: box.x, y: box.y, width: box.width, height: box.height, rx: 5, class: `element-box element-${element.kind}` }));
  const contentWidth = box.width - 20;
  group.append(el('text', { x: box.x + 10, y: box.y + 14, class: 'element-kind' }, element.kind.toUpperCase()));
  const rows = [
    ...wrap(context, element.name, contentWidth, '600 13px system-ui').map((text) => ({ text, className: 'element-title', lineHeight: 16 })),
    ...wrap(context, element.description, contentWidth, '11px system-ui').map((text) => ({ text, className: 'element-description', lineHeight: 14 })),
    ...(element.technology ? wrap(context, element.technology, contentWidth, 'italic 10px system-ui').map((text) => ({ text, className: 'element-technology', lineHeight: 13 })) : []),
  ];
  let y = box.y + 33;
  for (const row of rows) {
    group.append(el('text', { x: box.x + 10, y, class: row.className }, row.text));
    y += row.lineHeight;
  }
  return group;
}

function drawEdge(edge: { relationship: ArchitectureRelationship; geometry: { x?: number; y?: number; width?: number; height?: number; label?: string; points?: Array<{ x: number; y: number }> }; fallbackOffset: number }, nodes: Map<string, LayoutNode>, context: CanvasRenderingContext2D) {
  const { relationship, geometry } = edge;
  const route = edgePoints(edge, nodes);
  const group = el('g', { class: 'relationship', 'data-edge-id': relationship.id, 'data-source-id': relationship.sourceId, 'data-target-id': relationship.targetId, 'data-route-fallback': String(route.fallback) });
  const d = route.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  group.append(el('path', { d, class: `edge-path${route.fallback ? ' fallback' : ''}`, 'marker-end': 'url(#arrow)', 'data-route': 'true' }));
  const label = geometry.label ?? [relationship.label, relationship.technology].filter(Boolean).join(' · ');
  const size = measureLabel(context, label);
  const x = geometry.x ?? route.labelPoint!.x;
  const y = geometry.y ?? route.labelPoint!.y;
  const box = { x: x - size.width / 2, y: y - size.height / 2, ...size };
  const labelGroup = el('g', { 'data-label-for': relationship.id });
  labelGroup.append(el('rect', { x: box.x, y: box.y, width: box.width, height: box.height, rx: 3, class: 'edge-label-bg' }));
  const lines = wrap(context, label, box.width - 12, '10px system-ui');
  const text = el('text', { x, y: box.y + (box.height - (lines.length - 1) * 14) / 2 + 3, class: 'edge-label', 'text-anchor': 'middle' });
  lines.forEach((line, index) => text.append(el('tspan', { x, dy: index ? 14 : 0 }, line)));
  labelGroup.append(text);
  return { group, labelGroup };
}

function setViewBox(box: Box) {
  viewBox = box;
  svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
}

function render(fixtureId: string) {
  const ticket = ++generation;
  const fixture = fixtures[fixtureId];
  const status = document.querySelector<HTMLOutputElement>('#status')!;
  status.value = 'Dagre layout…';
  try {
    const context = document.createElement('canvas').getContext('2d')!;
    const { nodes, edges } = layoutFixture(fixture, context);
    if (ticket !== generation) return;
    svg.replaceChildren();
    svg.dataset.fixture = fixtureId;
    svg.dataset.nodeCount = String(nodes.size);
    svg.dataset.edgeCount = String(edges.length);
    const defs = el('defs');
    const marker = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    marker.append(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#596b86' }));
    defs.append(marker);
    svg.append(defs);

    for (const node of nodes.values()) if (node.element.kind === 'system') svg.append(drawSystem(node, nodes));
    const edgeViews = edges.map((edge) => drawEdge(edge, nodes, context));
    for (const edge of edgeViews) svg.append(edge.group);
    for (const node of nodes.values()) if (node.element.kind !== 'system') svg.append(drawElement(node, context));
    for (const edge of edgeViews) svg.append(edge.labelGroup);

    const bounds = svg.getBBox();
    const padding = 36;
    fittedViewBox = { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 };
    svg.setAttribute('aria-label', `Dagre architecture diagram: ${fixture.title}`);
    setViewBox({ ...fittedViewBox });
    status.value = `${nodes.size} elements · ${edges.length} relationships`;
  } catch (error) {
    if (ticket === generation) status.value = `Layout failed: ${String(error)}`;
  }
}

document.querySelector<HTMLSelectElement>('#fixture')!.addEventListener('change', (event) => render((event.currentTarget as HTMLSelectElement).value));
document.querySelector('#fit')!.addEventListener('click', () => setViewBox({ ...fittedViewBox }));
document.querySelector('#diagram')!.addEventListener('wheel', (event: Event) => {
  const wheel = event as WheelEvent;
  event.preventDefault();
  const rect = svg.getBoundingClientRect();
  const cx = viewBox.x + (wheel.clientX - rect.left) / rect.width * viewBox.width;
  const cy = viewBox.y + (wheel.clientY - rect.top) / rect.height * viewBox.height;
  const factor = wheel.deltaY < 0 ? 0.88 : 1 / 0.88;
  const width = Math.max(120, Math.min(30000, viewBox.width * factor));
  const height = viewBox.height * width / viewBox.width;
  setViewBox({ x: cx - (cx - viewBox.x) * factor, y: cy - (cy - viewBox.y) * factor, width, height });
}, { passive: false });
document.querySelector('#diagram')!.addEventListener('pointerdown', (event: Event) => {
  const pointerEvent = event as PointerEvent;
  if (pointerEvent.button !== 0) return;
  pointer = { x: pointerEvent.clientX, y: pointerEvent.clientY, viewBox: { ...viewBox } };
  svg.setPointerCapture(pointerEvent.pointerId);
});
document.querySelector('#diagram')!.addEventListener('pointermove', (event: Event) => {
  const pointerEvent = event as PointerEvent;
  if (!pointer) return;
  const rect = svg.getBoundingClientRect();
  const dx = (pointerEvent.clientX - pointer.x) * pointer.viewBox.width / rect.width;
  const dy = (pointerEvent.clientY - pointer.y) * pointer.viewBox.height / rect.height;
  setViewBox({ ...pointer.viewBox, x: pointer.viewBox.x - dx, y: pointer.viewBox.y - dy });
});
for (const type of ['pointerup', 'pointercancel'] as const) document.querySelector('#diagram')!.addEventListener(type, () => { pointer = undefined; });

render('small');
