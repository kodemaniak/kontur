import mermaid from 'mermaid';
import small from '../fixtures/small.json';
import large from '../fixtures/large.json';
import type { ArchitectureFixture } from '../webview/src/model';
import './style.css';

const fixtures: Record<string, ArchitectureFixture> = {
  small: small as ArchitectureFixture,
  large: large as ArchitectureFixture,
};

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  flowchart: { htmlLabels: true, curve: 'linear', nodeSpacing: 48, rankSpacing: 72, minNodeWidth: 180, wrappingWidth: 230, padding: 10, useMaxWidth: false },
  themeVariables: {
    fontFamily: 'system-ui, sans-serif',
    primaryColor: '#fff',
    primaryBorderColor: '#465977',
    primaryTextColor: '#172033',
    lineColor: '#596b86',
    edgeLabelBackground: '#fff',
    clusterBkg: '#edf2fb',
    clusterBorder: '#7587a8',
  },
});

type Box = { x: number; y: number; width: number; height: number };
let fittedViewBox: Box = { x: 0, y: 0, width: 1, height: 1 };
let viewBox = { ...fittedViewBox };
let pointer: { x: number; y: number; viewBox: Box } | undefined;
let generation = 0;
let renderId = 0;

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('|', '&#124;');
}

function mermaidLabel(lines: string[]): string {
  return lines.filter(Boolean).map(escapeHtml).join('<br/>');
}

export function buildMermaidDefinition(fixture: ArchitectureFixture): string {
  const nodeIds = new Map(fixture.elements.map((element, index) => [element.id, `n${index}`]));
  const systemIds = new Map(fixture.elements.filter((element) => element.kind === 'system').map((element, index) => [element.id, `s${index}`]));
  const definitions = ['flowchart LR'];
  const classes: Record<string, string[]> = { person: [], container: [], database: [] };

  for (const element of fixture.elements.filter((item) => item.kind === 'system')) {
    const children = fixture.elements.filter((item) => item.parentId === element.id);
    definitions.push(`subgraph ${systemIds.get(element.id)}["${escapeHtml(element.name)}"]`, 'direction LR');
    for (const child of children) {
      const id = nodeIds.get(child.id)!;
      const label = mermaidLabel([child.kind.toUpperCase(), child.name, child.description, child.technology ?? '']);
      definitions.push(`  ${id}["${label}"]`);
      classes[child.kind]?.push(id);
    }
    definitions.push('end', `style ${systemIds.get(element.id)} fill:#edf2fb,stroke:#7587a8,stroke-width:1.5px,stroke-dasharray:7 4`);
  }

  for (const element of fixture.elements.filter((item) => !item.parentId)) {
    const id = nodeIds.get(element.id)!;
    if (element.kind === 'system') continue;
    const label = mermaidLabel([element.kind.toUpperCase(), element.name, element.description, element.technology ?? '']);
    definitions.push(`${id}["${label}"]`);
    classes[element.kind]?.push(id);
  }

  for (const relationship of fixture.relationships) {
    const label = escapeHtml([relationship.label, relationship.technology].filter(Boolean).join(' · '));
    definitions.push(`${nodeIds.get(relationship.sourceId)} -->|"${label}"| ${nodeIds.get(relationship.targetId)}`);
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

function setViewBox(svg: SVGSVGElement, box: Box) {
  viewBox = box;
  svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
}

async function render(fixtureId: string) {
  const ticket = ++generation;
  const fixture = fixtures[fixtureId];
  const status = document.querySelector<HTMLOutputElement>('#status')!;
  const diagram = document.querySelector<HTMLElement>('#diagram')!;
  status.value = 'Mermaid layout…';
  try {
    const result = await mermaid.render(`kontur-mermaid-${++renderId}`, buildMermaidDefinition(fixture));
    if (ticket !== generation) return;
    diagram.innerHTML = result.svg;
    result.bindFunctions?.(diagram);
    const svg = diagram.querySelector<SVGSVGElement>('svg')!;
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Mermaid architecture diagram: ${fixture.title}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.dataset.fixture = fixtureId;
    svg.dataset.nodeCount = String(fixture.elements.length);
    svg.dataset.edgeCount = String(fixture.relationships.length);
    const bounds = svg.viewBox.baseVal;
    fittedViewBox = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    setViewBox(svg, { ...fittedViewBox });
    status.value = `${fixture.elements.length} elements · ${fixture.relationships.length} relationships`;
  } catch (error) {
    if (ticket === generation) status.value = `Render failed: ${String(error)}`;
  }
}

document.querySelector<HTMLSelectElement>('#fixture')!.addEventListener('change', (event) => render((event.currentTarget as HTMLSelectElement).value));
document.querySelector('#fit')!.addEventListener('click', () => {
  const svg = document.querySelector<SVGSVGElement>('#diagram svg');
  if (svg) setViewBox(svg, { ...fittedViewBox });
});
document.querySelector('#diagram')!.addEventListener('wheel', (event: Event) => {
  const svg = document.querySelector<SVGSVGElement>('#diagram svg');
  if (!svg) return;
  const wheel = event as WheelEvent;
  event.preventDefault();
  const rect = svg.getBoundingClientRect();
  const cx = viewBox.x + (wheel.clientX - rect.left) / rect.width * viewBox.width;
  const cy = viewBox.y + (wheel.clientY - rect.top) / rect.height * viewBox.height;
  const factor = wheel.deltaY < 0 ? 0.88 : 1 / 0.88;
  const width = Math.max(120, Math.min(30000, viewBox.width * factor));
  const height = viewBox.height * width / viewBox.width;
  setViewBox(svg, { x: cx - (cx - viewBox.x) * factor, y: cy - (cy - viewBox.y) * factor, width, height });
}, { passive: false });
document.querySelector('#diagram')!.addEventListener('pointerdown', (event: Event) => {
  const svg = document.querySelector<SVGSVGElement>('#diagram svg');
  const pointerEvent = event as PointerEvent;
  if (!svg || pointerEvent.button !== 0) return;
  pointer = { x: pointerEvent.clientX, y: pointerEvent.clientY, viewBox: { ...viewBox } };
  svg.setPointerCapture(pointerEvent.pointerId);
});
document.querySelector('#diagram')!.addEventListener('pointermove', (event: Event) => {
  const svg = document.querySelector<SVGSVGElement>('#diagram svg');
  if (!pointer || !svg) return;
  const pointerEvent = event as PointerEvent;
  const rect = svg.getBoundingClientRect();
  const dx = (pointerEvent.clientX - pointer.x) * pointer.viewBox.width / rect.width;
  const dy = (pointerEvent.clientY - pointer.y) * pointer.viewBox.height / rect.height;
  setViewBox(svg, { ...pointer.viewBox, x: pointer.viewBox.x - dx, y: pointer.viewBox.y - dy });
});
for (const type of ['pointerup', 'pointercancel'] as const) document.querySelector('#diagram')!.addEventListener(type, () => { pointer = undefined; });

render('small');
