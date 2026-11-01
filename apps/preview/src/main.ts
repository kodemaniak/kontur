// shortcut: Mermaid's full import bundles unused diagram types; switch to flowchart-only loading if preview size matters.
import mermaid from 'mermaid';
import { parsePreviewJson, type DiagnosticDto, type ResolvedViewDto } from './contract';
import { buildMermaidDefinition } from './mermaid';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Preview root element #app is missing.');

app.innerHTML = `
  <header>
    <div class="brand"><strong>kontur</strong><span>local architecture preview</span></div>
    <div class="actions">
      <button id="reload" type="button">Reload</button>
      <span class="divider" aria-hidden="true"></span>
      <button id="zoom-out" type="button" aria-label="Zoom out">−</button>
      <button id="fit" type="button">Fit</button>
      <button id="zoom-in" type="button" aria-label="Zoom in">+</button>
    </div>
  </header>
  <main>
    <section class="workspace" aria-label="Architecture view">
      <div class="canvas-toolbar"><span>Container view</span><span>Scroll to zoom · drag to pan</span></div>
      <div id="diagram" aria-label="Architecture diagram"></div>
      <output id="status" role="status" aria-live="polite" data-stale="false">Loading…</output>
    </section>
    <aside id="diagnostics" aria-label="Diagnostics" aria-live="polite"></aside>
  </main>
`;

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  flowchart: {
    htmlLabels: true,
    curve: 'linear',
    nodeSpacing: 48,
    rankSpacing: 72,
    minNodeWidth: 180,
    wrappingWidth: 230,
    padding: 10,
    useMaxWidth: false,
  },
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
let fittedBox: Box | undefined;
let currentBox: Box | undefined;
let activePointer: { id: number; x: number; y: number; box: Box } | undefined;
let requestVersion = 0;
let renderVersion = 0;
let mermaidId = 0;
let hasValidPreview = false;

function isSvgRoot(node: Node | null): node is SVGSVGElement {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const element = node as Element;
  return element.localName === 'svg' && element.namespaceURI === 'http://www.w3.org/2000/svg';
}

const diagram = document.querySelector<HTMLElement>('#diagram')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const diagnostics = document.querySelector<HTMLElement>('#diagnostics')!;

function setViewBox(svg: SVGSVGElement, box: Box): void {
  currentBox = box;
  svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
}

function fit(): void {
  const svg = diagram.querySelector<SVGSVGElement>('svg');
  if (svg && fittedBox) setViewBox(svg, { ...fittedBox });
}

function zoom(factor: number, clientX?: number, clientY?: number): void {
  const svg = diagram.querySelector<SVGSVGElement>('svg');
  if (!svg || !currentBox) return;
  const rect = svg.getBoundingClientRect();
  const anchorX = clientX ?? rect.left + rect.width / 2;
  const anchorY = clientY ?? rect.top + rect.height / 2;
  const screenScale = Math.min(rect.width / currentBox.width, rect.height / currentBox.height);
  const x = currentBox.x + (anchorX - rect.left - (rect.width - currentBox.width * screenScale) / 2) / screenScale;
  const y = currentBox.y + (anchorY - rect.top - (rect.height - currentBox.height * screenScale) / 2) / screenScale;
  const width = Math.max(120, Math.min(30_000, currentBox.width * factor));
  const height = currentBox.height * width / currentBox.width;
  setViewBox(svg, {
    x: x - (x - currentBox.x) * (width / currentBox.width),
    y: y - (y - currentBox.y) * (height / currentBox.height),
    width,
    height,
  });
}

function showDiagnostics(items: DiagnosticDto[]): void {
  diagnostics.replaceChildren();
  if (items.length === 0) return;
  const heading = document.createElement('h2');
  heading.textContent = `${items.length} diagnostic${items.length === 1 ? '' : 's'}`;
  const list = document.createElement('ul');
  for (const item of items) {
    const entry = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = item.code;
    const message = document.createElement('span');
    const location = item.location ? `${item.location.file}:${item.location.line}:${item.location.column}: ` : '';
    message.textContent = `${location}${item.message}`;
    entry.append(code, message);
    list.append(entry);
  }
  diagnostics.append(heading, list);
}

function showClientError(message: string): void {
  showDiagnostics([{
    code: 'transport',
    severity: 'error',
    message,
    location: null,
  }]);
}

function retainPreviewAsStale(message: string): void {
  status.value = hasValidPreview ? `Stale preview · ${message}` : `No valid preview · ${message}`;
  status.dataset.stale = String(hasValidPreview);
}

function viewportAfterReload(nextBox: Box): Box {
  if (!fittedBox || !currentBox) return { ...nextBox };
  const zoomRatio = currentBox.width / fittedBox.width;
  const centerX = (currentBox.x + currentBox.width / 2 - fittedBox.x) / fittedBox.width;
  const centerY = (currentBox.y + currentBox.height / 2 - fittedBox.y) / fittedBox.height;
  const width = nextBox.width * zoomRatio;
  const height = nextBox.height * zoomRatio;
  return {
    x: nextBox.x + centerX * nextBox.width - width / 2,
    y: nextBox.y + centerY * nextBox.height - height / 2,
    width,
    height,
  };
}

async function renderView(view: ResolvedViewDto, ticket: number): Promise<void> {
  const thisRender = ++renderVersion;
  const result = await mermaid.render(`kontur-preview-${++mermaidId}`, buildMermaidDefinition(view));
  if (ticket !== requestVersion || thisRender !== renderVersion) return;

  const parsed = new DOMParser().parseFromString(result.svg, 'text/html');
  const svg = parsed.querySelector('svg');
  if (!isSvgRoot(svg)) {
    throw new Error('Mermaid did not return a valid SVG diagram.');
  }

  const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error('Mermaid returned a diagram without a usable view box.');
  }
  const nextFit = { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] };
  const nextView = viewportAfterReload(nextFit);
  const imported = document.importNode(svg, true);
  if (!isSvgRoot(imported)) throw new Error('Could not attach the rendered SVG diagram.');
  imported.setAttribute('role', 'img');
  imported.setAttribute('aria-label', `Architecture diagram for ${view.key}`);
  imported.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  imported.dataset.elementCount = String(view.elements.length);
  imported.dataset.relationshipCount = String(view.relationships.length);
  imported.setAttribute('viewBox', `${nextView.x} ${nextView.y} ${nextView.width} ${nextView.height}`);
  diagram.replaceChildren(imported);

  fittedBox = nextFit;
  currentBox = nextView;
  hasValidPreview = true;
  status.value = `${view.elements.length} elements · ${view.relationships.length} relationships`;
  status.dataset.stale = 'false';
  showDiagnostics([]);
}

async function reload(): Promise<void> {
  const ticket = ++requestVersion;
  status.value = hasValidPreview ? 'Reloading · showing last valid preview' : 'Loading preview…';
  diagnostics.replaceChildren();
  try {
    const response = await fetch('/api/view', { cache: 'no-store' });
    const result = parsePreviewJson(await response.text());
    if (ticket !== requestVersion) return;
    if (result.status === 'error') {
      showDiagnostics(result.diagnostics);
      retainPreviewAsStale(`${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? '' : 's'}`);
      return;
    }
    if (!response.ok) throw new Error(`Local preview endpoint returned HTTP ${response.status}.`);
    await renderView(result.view, ticket);
  } catch (error) {
    if (ticket !== requestVersion) return;
    showClientError(error instanceof Error ? error.message : String(error));
    retainPreviewAsStale('reload failed');
  }
}

document.querySelector<HTMLButtonElement>('#reload')!.addEventListener('click', () => void reload());
document.querySelector<HTMLButtonElement>('#fit')!.addEventListener('click', fit);
document.querySelector<HTMLButtonElement>('#zoom-in')!.addEventListener('click', () => zoom(0.8));
document.querySelector<HTMLButtonElement>('#zoom-out')!.addEventListener('click', () => zoom(1.25));

diagram.addEventListener('wheel', (event: WheelEvent) => {
  event.preventDefault();
  zoom(event.deltaY < 0 ? 0.88 : 1 / 0.88, event.clientX, event.clientY);
}, { passive: false });

diagram.addEventListener('pointerdown', (event: PointerEvent) => {
  const svg = diagram.querySelector<SVGSVGElement>('svg');
  if (!svg || !currentBox || event.button !== 0) return;
  activePointer = { id: event.pointerId, x: event.clientX, y: event.clientY, box: { ...currentBox } };
  diagram.setPointerCapture(event.pointerId);
  diagram.classList.add('is-panning');
});

diagram.addEventListener('pointermove', (event: PointerEvent) => {
  const svg = diagram.querySelector<SVGSVGElement>('svg');
  if (!activePointer || !svg || !currentBox || activePointer.id !== event.pointerId) return;
  const rect = svg.getBoundingClientRect();
  const scale = Math.min(rect.width / activePointer.box.width, rect.height / activePointer.box.height);
  setViewBox(svg, {
    ...activePointer.box,
    x: activePointer.box.x - (event.clientX - activePointer.x) / scale,
    y: activePointer.box.y - (event.clientY - activePointer.y) / scale,
  });
});

function stopPan(event: PointerEvent): void {
  if (activePointer?.id !== event.pointerId) return;
  activePointer = undefined;
  diagram.classList.remove('is-panning');
}
diagram.addEventListener('pointerup', stopPan);
diagram.addEventListener('pointercancel', stopPan);

void reload();
