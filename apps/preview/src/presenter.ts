import mermaid from 'mermaid';
import type { DiagnosticDto, PreviewResult } from './contract';
import { buildMermaidDefinition } from './mermaid';

export type DiagramRenderer = (id: string, definition: string) => Promise<{ svg: string }>;
export type PreviewPresenter = {
  markPending(revision: number): void;
  applyResult(revision: number, result: PreviewResult): Promise<void>;
  showHostError(revision: number, message: string): void;
  restore(state: PreviewPresenterState): Promise<void>;
  getState(): PreviewPresenterState | undefined;
  dispose(): void;
};

export type PreviewViewport = { x: number; y: number; width: number; height: number };
export type PreviewPresenterState = {
  revision: number;
  result: Extract<PreviewResult, { status: 'ok' }>;
  viewport: PreviewViewport;
};
type Box = PreviewViewport;

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

const renderMermaid: DiagramRenderer = (id, definition) => mermaid.render(id, definition);

export function mountPreview(
  root: HTMLElement,
  render: DiagramRenderer = renderMermaid,
  options: { onReload?: () => void; onStateChange?: () => void } = {},
): PreviewPresenter {
  root.innerHTML = `
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

  const controller = new AbortController();
  const { signal } = controller;
  const diagram = root.querySelector<HTMLElement>('#diagram')!;
  const status = root.querySelector<HTMLOutputElement>('#status')!;
  const diagnostics = root.querySelector<HTMLElement>('#diagnostics')!;
  const reloadButton = root.querySelector<HTMLButtonElement>('#reload')!;
  reloadButton.hidden = !options.onReload;

  let fittedBox: Box | undefined;
  let currentBox: Box | undefined;
  let activePointer: { id: number; x: number; y: number; box: Box } | undefined;
  let latestRevision = 0;
  let renderVersion = 0;
  let mermaidId = 0;
  let hasValidPreview = false;
  let lastValidResult: Extract<PreviewResult, { status: 'ok' }> | undefined;
  let lastValidRevision = 0;
  let disposed = false;

  function showDiagnostics(items: DiagnosticDto[]): void {
    diagnostics.replaceChildren();
    if (items.length === 0) return;
    const heading = root.ownerDocument.createElement('h2');
    heading.textContent = `${items.length} diagnostic${items.length === 1 ? '' : 's'}`;
    const list = root.ownerDocument.createElement('ul');
    for (const item of items) {
      const entry = root.ownerDocument.createElement('li');
      const code = root.ownerDocument.createElement('code');
      code.textContent = item.code;
      const message = root.ownerDocument.createElement('span');
      const location = item.location ? `${item.location.file}:${item.location.line}:${item.location.column}: ` : '';
      message.textContent = `${location}${item.message}`;
      entry.append(code, message);
      list.append(entry);
    }
    diagnostics.append(heading, list);
  }

  function showHostDiagnostic(message: string): void {
    showDiagnostics([{ code: 'transport', severity: 'error', message, location: null }]);
  }

  function retainPreviewAsStale(message: string): void {
    status.value = hasValidPreview ? `Stale preview · ${message}` : `No valid preview · ${message}`;
    status.dataset.stale = String(hasValidPreview);
  }

  function setViewBox(svg: SVGSVGElement, box: Box): void {
    currentBox = box;
    svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
    if (hasValidPreview) options.onStateChange?.();
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

  function viewportAfterReload(nextBox: Box): Box {
    if (!fittedBox || !currentBox) return { ...nextBox };
    if (nextBox.x === fittedBox.x && nextBox.y === fittedBox.y
      && nextBox.width === fittedBox.width && nextBox.height === fittedBox.height) return { ...currentBox };
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

  function acceptRevision(revision: number): boolean {
    if (disposed || revision < latestRevision) return false;
    latestRevision = revision;
    return true;
  }

  async function applyResult(revision: number, result: PreviewResult): Promise<void> {
    return renderResult(revision, result);
  }

  async function restore(state: PreviewPresenterState): Promise<void> {
    await renderResult(0, state.result, state.viewport, state.revision);
  }

  async function renderResult(
    revision: number,
    result: PreviewResult,
    restoredViewport?: Box,
    stateRevision = revision,
  ): Promise<void> {
    if (!acceptRevision(revision)) return;
    const ticket = ++renderVersion;
    if (result.status === 'error') {
      showDiagnostics(result.diagnostics);
      retainPreviewAsStale(`${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? '' : 's'}`);
      return;
    }

    try {
      const rendered = await render(`kontur-preview-${++mermaidId}`, buildMermaidDefinition(result.view));
      if (disposed || ticket !== renderVersion || revision !== latestRevision) return;
      const parsed = new DOMParser().parseFromString(rendered.svg, 'text/html');
      const svg = parsed.querySelector('svg');
      if (!svg || svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg') {
        throw new Error('Mermaid did not return a valid SVG diagram.');
      }

      const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
      if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) {
        throw new Error('Mermaid returned a diagram without a usable view box.');
      }
      const nextFit = { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] };
      const nextView = restoredViewport ?? viewportAfterReload(nextFit);
      const imported = root.ownerDocument.importNode(svg, true);
      imported.setAttribute('role', 'img');
      imported.setAttribute('aria-label', `Architecture diagram for ${result.view.key}`);
      imported.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      imported.dataset.elementCount = String(result.view.elements.length);
      imported.dataset.relationshipCount = String(result.view.relationships.length);
      imported.setAttribute('viewBox', `${nextView.x} ${nextView.y} ${nextView.width} ${nextView.height}`);
      diagram.replaceChildren(imported);

      fittedBox = nextFit;
      currentBox = nextView;
      hasValidPreview = true;
      lastValidResult = result;
      lastValidRevision = stateRevision;
      status.value = `${result.view.elements.length} elements · ${result.view.relationships.length} relationships`;
      status.dataset.stale = 'false';
      showDiagnostics([]);
      options.onStateChange?.();
    } catch (error) {
      if (disposed || ticket !== renderVersion || revision !== latestRevision) return;
      showHostDiagnostic(error instanceof Error ? error.message : String(error));
      retainPreviewAsStale('render failed');
    }
  }

  function markPending(revision: number): void {
    if (!acceptRevision(revision)) return;
    renderVersion++;
    status.value = hasValidPreview ? 'Reloading · showing last valid preview' : 'Loading preview…';
    status.dataset.stale = String(hasValidPreview);
    diagnostics.replaceChildren();
  }

  function showHostError(revision: number, message: string): void {
    if (!acceptRevision(revision)) return;
    renderVersion++;
    showHostDiagnostic(message);
    retainPreviewAsStale('reload failed');
  }

  reloadButton.addEventListener('click', () => options.onReload?.(), { signal });
  root.querySelector<HTMLButtonElement>('#fit')!.addEventListener('click', fit, { signal });
  root.querySelector<HTMLButtonElement>('#zoom-in')!.addEventListener('click', () => zoom(0.8), { signal });
  root.querySelector<HTMLButtonElement>('#zoom-out')!.addEventListener('click', () => zoom(1.25), { signal });
  diagram.addEventListener('wheel', (event: WheelEvent) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 0.88 : 1 / 0.88, event.clientX, event.clientY);
  }, { passive: false, signal });
  diagram.addEventListener('pointerdown', (event: PointerEvent) => {
    const svg = diagram.querySelector<SVGSVGElement>('svg');
    if (!svg || !currentBox || event.button !== 0) return;
    activePointer = { id: event.pointerId, x: event.clientX, y: event.clientY, box: { ...currentBox } };
    diagram.setPointerCapture(event.pointerId);
    diagram.classList.add('is-panning');
  }, { signal });
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
  }, { signal });
  const stopPan = (event: PointerEvent): void => {
    if (activePointer?.id !== event.pointerId) return;
    activePointer = undefined;
    diagram.classList.remove('is-panning');
  };
  diagram.addEventListener('pointerup', stopPan, { signal });
  diagram.addEventListener('pointercancel', stopPan, { signal });

  return {
    markPending,
    applyResult,
    showHostError,
    restore,
    getState() {
      if (!lastValidResult || !currentBox) return undefined;
      return { revision: lastValidRevision, result: lastValidResult, viewport: { ...currentBox } };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderVersion++;
      controller.abort();
      root.replaceChildren();
    },
  };
}
