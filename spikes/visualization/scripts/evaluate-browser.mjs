import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(root, 'dist/webview');
const results = resolve(root, 'results');
await mkdir(results, { recursive: true });

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    let file = resolve(webRoot, `.${pathname}`);
    if (file !== webRoot && !file.startsWith(`${webRoot}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    if (pathname.endsWith('/')) file = resolve(file, 'index.html');
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
assert(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });
const page = await context.newPage();
const pageErrors = [];
const externalRequests = [];
await page.addInitScript(() => {
  window.__elkGeometry = { outputs: [] };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({ data }) => window.__elkGeometry.outputs.push(structuredClone(data)));
    }
  };
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('request', (request) => {
  if (!request.url().startsWith(origin)) externalRequests.push(request.url());
});
await page.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());

const countFor = (id) => id === 'small' ? 8 : 101;
async function waitForLayout(id, count = countFor(id), previousTiming, targetPage = page) {
  await targetPage.waitForFunction(async (expected) => {
    const snapshot = () => [
      document.querySelector('.status.timing')?.textContent ?? '',
      document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '',
      document.querySelectorAll('.react-flow__node').length,
      [...document.querySelectorAll('.c4-node')].map((node) => `${node.getAttribute('data-flow-x')},${node.getAttribute('data-flow-y')}`).join(';'),
    ].join('|');
    await new Promise(requestAnimationFrame);
    const first = snapshot();
    await new Promise(requestAnimationFrame);
    const second = snapshot();
    await new Promise(requestAnimationFrame);
    const third = snapshot();
    const timing = document.querySelector('.status.timing')?.textContent ?? '';
    return !document.querySelector('.status.busy') && document.querySelectorAll('.react-flow__node').length === expected.count && timing.startsWith(`${expected.count} nodes`) && (!expected.previousTiming || timing !== expected.previousTiming) && first === second && second === third;
  }, { count, previousTiming }, { timeout: 60000 });
  await targetPage.locator('.react-flow__node').nth(count - 1).waitFor({ timeout: 60000 });
  await targetPage.locator('.status.busy').waitFor({ state: 'detached', timeout: 60000 });
}
async function relayout(id) {
  const started = performance.now();
  const previousTiming = await page.locator('.status.timing').textContent();
  await page.getByRole('button', { name: 'Re-layout' }).click();
  await waitForLayout(id, countFor(id), previousTiming);
  return { requestToRenderMs: performance.now() - started, elkMs: await layoutMs() };
}
function layoutMs() {
  const match = page.locator('.status.timing').textContent();
  return match.then((text) => Number(text?.match(/([\d.]+) ms/)?.[1] ?? NaN));
}
async function positions() {
  return page.locator('.react-flow__node').evaluateAll((items) => Object.fromEntries(items.map((item) => {
    const node = item.querySelector('.c4-node');
    return [item.getAttribute('data-id'), { x: Number(node?.getAttribute('data-flow-x')), y: Number(node?.getAttribute('data-flow-y')) }];
  })));
}
async function viewportTransform() {
  return page.locator('.react-flow__viewport').evaluate((node) => getComputedStyle(node).transform);
}
function maxDisplacement(before, after) {
  return Math.max(0, ...Object.entries(before).flatMap(([id, point]) => {
    const next = after[id];
    return next ? [Math.hypot(next.x - point.x, next.y - point.y)] : [];
  }));
}

await page.goto(origin);
await waitForLayout('small');
await page.screenshot({ path: resolve(results, 'small-before.png'), fullPage: true });
assert.equal(await page.locator('.react-flow__node').count(), 8);
assert.equal(await page.locator('.react-flow__edge').count(), 8);
assert.equal(await page.locator('.relationship-label').count(), 8);
for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'Zoom in' }).click();
await page.screenshot({ path: resolve(results, 'small-detail.png'), fullPage: true });

const parent = await page.locator('.react-flow__node[data-id="order-hub"] .c4-system').boundingBox();
for (const id of ['storefront', 'order-api', 'order-db']) {
  const child = await page.locator(`.react-flow__node[data-id="${id}"] .c4-node`).boundingBox();
  assert(parent && child && child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height, `Boundary does not contain ${id}`);
}

const beforeRename = await positions();
await page.getByRole('button', { name: 'Rename' }).click();
await page.getByText('Order API', { exact: true }).waitFor();
const afterRename = await positions();
assert.equal(maxDisplacement(beforeRename, afterRename), 0, 'Non-geometric rename moved a node');

await page.locator('.react-flow__node[data-id="order-api"]').press('Enter');
await page.getByText(/fixtures\/small\.arch:4:/).waitFor();
const focusOutline = await page.locator('.react-flow__node[data-id="order-api"]').evaluate((node) => getComputedStyle(node).outlineStyle);
await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'editor-selection', id: 'payment-api' } })));
await page.locator('.react-flow__node[data-id="payment-api"] .c4-node.selected').waitFor();
await page.getByText(/fixtures\/small\.arch:7:/).waitFor();
const mappedSource = await page.locator('.source-panel pre').textContent();
await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'editor-selection', id: '../README.md' } })));
assert.equal(await page.locator('.source-panel pre').textContent(), mappedSource, 'Unknown editor target changed the selected source');
await page.locator('.react-flow__node[data-id="order-api"]').click();

await page.getByRole('button', { name: 'Add', exact: true }).click();
await page.locator('.react-flow__node[data-id="notification-service"]').waitFor();
await waitForLayout('small', 9);
assert.equal(await page.locator('.react-flow__node[data-id="order-api"] .c4-node.selected').count(), 1, 'Structural update lost selection');
await page.screenshot({ path: resolve(results, 'small-after-add.png'), fullPage: true });
await page.locator('.react-flow__node[data-id="notification-service"]').click();
await page.getByRole('button', { name: 'Remove added' }).click();
await page.locator('.react-flow__node[data-id="notification-service"]').waitFor({ state: 'detached' });
await waitForLayout('small');
assert.equal(await page.locator('.react-flow__node.selected').count(), 0, 'Removing the selected node did not clear selection');
await page.getByRole('button', { name: 'Simulate invalid input' }).click();
await page.getByText(/Showing last valid view/).waitFor();
const staleTiming = await page.locator('.status.timing').textContent();
const validNodeCount = await page.locator('.react-flow__node').count();
await page.getByRole('button', { name: 'Simulate layout failure' }).click();
await page.getByText('Simulated ELK layout failure').waitFor();
assert.equal(await page.locator('.react-flow__node').count(), validNodeCount, 'Layout failure replaced the last valid graph');
await page.getByRole('button', { name: 'Re-layout' }).click();
await waitForLayout('small', 8, staleTiming);
assert.equal(await page.locator('.status.stale').count(), 0, 'Successful relayout did not clear stale state');

const fixtureSamples = {};
const updateSamples = {};
const movements = {};
const directElk = {};
for (const id of ['small', 'large']) {
  fixtureSamples[id] = [];
  updateSamples[id] = [];
  movements[id] = [];
  await page.locator('#fixture-select').selectOption(id);
  await waitForLayout(id);
  if (id === 'large') {
    await page.getByRole('button', { name: 'Fit view' }).click();
    await page.screenshot({ path: resolve(results, 'large-before.png'), fullPage: true });
    assert.equal(await page.locator('.react-flow__node').count(), 101);
  }
  for (let run = 0; run < 5; run++) {
    const initialStarted = performance.now();
    const previousTiming = await page.locator('.status.timing').textContent();
    await page.getByRole('button', { name: 'Reset' }).click();
    await waitForLayout(id, countFor(id), previousTiming);
    fixtureSamples[id].push({ requestToRenderMs: performance.now() - initialStarted, elkMs: await layoutMs() });
    const basePositions = await positions();
    const beforeRenameViewport = await viewportTransform();
    const renameStarted = performance.now();
    await page.getByRole('button', { name: 'Rename' }).click();
    if (id === 'small') await page.getByText('Order API', { exact: true }).waitFor();
    else await page.locator('.react-flow__node[data-id="commerce-service-01"]').getByText('Commerce platform service 2', { exact: true }).waitFor();
    const afterRenamePositions = await positions();
    const renameDisplacement = maxDisplacement(basePositions, afterRenamePositions);
    const afterRenameViewport = await viewportTransform();
    assert.equal(renameDisplacement, 0, 'Rename did not preserve geometry');
    assert.equal(afterRenameViewport, beforeRenameViewport, 'Rename did not preserve viewport');
    const addedAt = performance.now();
    const beforeAddViewport = await viewportTransform();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.locator('.react-flow__node[data-id="notification-service"]').waitFor();
    await waitForLayout(id, countFor(id) + 1);
    const afterAddViewport = await viewportTransform();
    assert.equal(afterAddViewport, beforeAddViewport, 'Structural update did not preserve viewport');
    const afterAdd = await positions();
    const addTiming = await layoutMs();
    const removedAt = performance.now();
    await page.getByRole('button', { name: 'Remove added' }).click();
    await page.locator('.react-flow__node[data-id="notification-service"]').waitFor({ state: 'detached' });
    await waitForLayout(id);
    const afterRemove = await positions();
    const removeTiming = await layoutMs();
    updateSamples[id].push({
      run: run + 1,
      renameRequestToRenderMs: addedAt - renameStarted,
      addRequestToRenderMs: removedAt - addedAt,
      addElkMs: addTiming,
      removeRequestToRenderMs: performance.now() - removedAt,
      removeElkMs: removeTiming,
    });
    movements[id].push({
      addMaxSurvivorDisplacementFlowUnits: maxDisplacement(basePositions, afterAdd),
      removeMaxSurvivorDisplacementFlowUnits: maxDisplacement(basePositions, afterRemove),
    });
    if (id === 'large' && run === 0) await page.screenshot({ path: resolve(results, 'large-after-add.png'), fullPage: true });
  }
}

for (const id of ['small', 'large']) {
  await page.locator('#fixture-select').selectOption(id);
  await waitForLayout(id, countFor(id));
  if (await page.locator('#layout-mode-select').inputValue() !== 'direct-elk') {
    const beforeModeTiming = await page.locator('.status.timing').textContent();
    await page.locator('#layout-mode-select').selectOption('direct-elk');
    await page.waitForFunction(() => document.querySelector('.diagram')?.getAttribute('data-layout-mode') === 'direct-elk');
    await waitForLayout(id, countFor(id), beforeModeTiming);
  }
  directElk[id] = await page.evaluate((fixtureId) => {
    const graph = window.__elkGeometry.outputs.at(-1).graph;
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const edges = [...document.querySelectorAll('.react-flow__edge')];
    const labels = document.querySelectorAll('.relationship-label').length;
    const containsNestedChildren = (parent) => (parent.children ?? []).every((child) => {
      const parentBox = document.querySelector(`.react-flow__node[data-id="${CSS.escape(parent.id)}"] .c4-node`)?.getBoundingClientRect();
      const childBox = document.querySelector(`.react-flow__node[data-id="${CSS.escape(child.id)}"] .c4-node`)?.getBoundingClientRect();
      return Boolean(parentBox && childBox && childBox.left >= parentBox.left && childBox.top >= parentBox.top
        && childBox.right <= parentBox.right && childBox.bottom <= parentBox.bottom && containsNestedChildren(child));
    });
    const labelGeometryMatches = [...document.querySelectorAll('.relationship-label')].every((label) => {
      const style = getComputedStyle(label);
      return Math.abs(parseFloat(style.width) - label.offsetWidth) < 1
        && Math.abs(parseFloat(style.height) - label.offsetHeight) < 1;
    });
    const origins = new Map();
    const visit = (node, parentX = 0, parentY = 0) => {
      const origin = { x: parentX + (node.x ?? 0), y: parentY + (node.y ?? 0) };
      origins.set(node.id, origin);
      for (const child of node.children ?? []) visit(child, origin.x, origin.y);
    };
    visit(graph);
    const labelPlacementDeltas = graph.edges.flatMap((elkEdge) => (elkEdge.labels ?? []).map((elkLabel) => {
      const element = document.querySelector(`[data-edge-label="${CSS.escape(elkEdge.id)}"]`);
      const path = document.querySelector(`.react-flow__edge[data-id="${CSS.escape(elkEdge.id)}"] .react-flow__edge-path`);
      const rect = element.getBoundingClientRect();
      const actual = new DOMPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).matrixTransform(path.getScreenCTM().inverse());
      const origin = origins.get(elkEdge.container ?? 'root');
      return {
        id: elkEdge.id,
        distance: Math.hypot(actual.x - origin.x - elkLabel.x - elkLabel.width / 2, actual.y - origin.y - elkLabel.y - elkLabel.height / 2),
        expected: { x: origin.x + elkLabel.x + elkLabel.width / 2, y: origin.y + elkLabel.y + elkLabel.height / 2 },
        actual: { x: actual.x, y: actual.y },
        container: elkEdge.container,
      };
    }));
    let returnEdgeEndpointGaps = null;
    if (fixtureId === 'small') {
      const edge = [...document.querySelectorAll('.react-flow__edge')].find((item) => item.getAttribute('data-id') === 'r-payment-order-result')?.querySelector('path');
      const source = document.querySelector('.react-flow__node[data-id="payment-api"]')?.getBoundingClientRect();
      const target = document.querySelector('.react-flow__node[data-id="order-api"]')?.getBoundingClientRect();
      if (!edge || !source || !target) throw new Error('Direct ELK return edge endpoints are missing');
      const point = (distance) => {
        const p = edge.getPointAtLength(distance);
        const screen = new DOMPoint(p.x, p.y).matrixTransform(edge.getScreenCTM());
        return { x: screen.x, y: screen.y };
      };
      const start = point(0);
      const end = point(edge.getTotalLength());
      const distance = (p, rect) => Math.min(
        Math.hypot(p.x - rect.left, p.y - rect.top),
        Math.hypot(p.x - rect.right, p.y - rect.top),
        Math.hypot(p.x - rect.left, p.y - rect.bottom),
        Math.hypot(p.x - rect.right, p.y - rect.bottom),
        Math.max(rect.left - p.x, 0, p.x - rect.right, rect.top - p.y, 0, p.y - rect.bottom),
      );
      returnEdgeEndpointGaps = [distance(start, source), distance(end, target)];
    }
    return {
      nodes: nodes.length,
      edges: edges.length,
      labels,
      nestedChildrenContained: (graph.children ?? []).every(containsNestedChildren),
      labelGeometryMatches,
      maxLabelPlacementDelta: Math.max(0, ...labelPlacementDeltas.map((label) => label.distance)),
      returnEdgeEndpointGaps,
    };
  }, id);
  assert.equal(directElk[id].nodes, countFor(id), `${id}: direct ELK node count`);
  assert.equal(directElk[id].edges, id === 'small' ? 8 : 105, `${id}: direct ELK edge count`);
  assert.equal(directElk[id].labels, id === 'small' ? 8 : 105, `${id}: direct ELK labels`);
  assert.equal(directElk[id].labelGeometryMatches, true, `${id}: ELK-sized label boxes`);
  assert(directElk[id].maxLabelPlacementDelta < 1, `${id}: ELK label position delta ${directElk[id].maxLabelPlacementDelta}`);
  assert.equal(directElk[id].nestedChildrenContained, true, `${id}: direct ELK containment`);
  if (id === 'small') {
    assert(directElk[id].returnEdgeEndpointGaps.every((gap) => gap < 4), 'direct ELK return edge connects to both endpoint nodes');
  }
  await page.screenshot({ path: resolve(results, `react-flow-direct-elk-${id}.png`), fullPage: true });
}
await page.locator('#fixture-select').selectOption('small');
await waitForLayout('small', 8);
const elkReturnPath = await page.locator('.react-flow__edge[data-id="r-payment-order-result"] .react-flow__edge-path').getAttribute('d');
const otherElkPaths = await page.locator('.react-flow__edge:not([data-id="r-payment-order-result"]) .react-flow__edge-path').evaluateAll((paths) => paths.map((path) => path.getAttribute('d')));
const previousRouteTiming = await page.locator('.status.timing').textContent();
await page.locator('#route-mode-select').selectOption('manual');
await page.waitForFunction(() => document.querySelector('.diagram')?.getAttribute('data-route-mode') === 'manual');
await waitForLayout('small', 8, previousRouteTiming);
const manualRoute = await page.evaluate(() => {
  const edge = document.querySelector('.react-flow__edge[data-id="r-payment-order-result"]');
  const path = edge.querySelector('.react-flow__edge-path');
  const endpoint = (distance) => {
    const point = path.getPointAtLength(distance);
    return new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
  };
  const box = (id) => document.querySelector(`.react-flow__node[data-id="${id}"] .c4-node`).getBoundingClientRect();
  const gap = (point, rect) => {
    const x = Math.max(rect.left, Math.min(point.x, rect.right));
    const y = Math.max(rect.top, Math.min(point.y, rect.bottom));
    if (x !== point.x || y !== point.y) return Math.hypot(point.x - x, point.y - y);
    return Math.min(x - rect.left, rect.right - x, y - rect.top, rect.bottom - y);
  };
  const start = endpoint(0);
  const end = endpoint(path.getTotalLength());
  const label = document.querySelector('[data-edge-label="r-payment-order-result"]');
  const labelBox = label.getBoundingClientRect();
  const labelCenter = new DOMPoint(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2).matrixTransform(path.getScreenCTM().inverse());
  return {
    path: path.getAttribute('d'),
    sourceGap: gap(start, box('payment-api')),
    targetGap: gap(end, box('order-api')),
    labelPositionDelta: Math.hypot(labelCenter.x - Number(label.dataset.flowX), labelCenter.y - Number(label.dataset.flowY)),
  };
});
assert.notEqual(manualRoute.path, elkReturnPath, 'manual route replaces only the return-edge path');
assert.deepEqual(await page.locator('.react-flow__edge:not([data-id="r-payment-order-result"]) .react-flow__edge-path').evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))), otherElkPaths, 'manual mode leaves all other ELK routes unchanged');
assert(manualRoute.sourceGap < 4 && manualRoute.targetGap < 4, 'manual return route connects to its node boxes');
assert(manualRoute.labelPositionDelta < 1, 'manual route label uses its manually assigned position');
await page.screenshot({ path: resolve(results, 'react-flow-direct-elk-small-manual.png'), fullPage: true });
await page.locator('#route-mode-select').selectOption('elk');
await waitForLayout('small', 8);
assert.equal(await page.locator('.react-flow__edge[data-id="r-payment-order-result"] .react-flow__edge-path').getAttribute('d'), elkReturnPath, 'ELK mode restores the original return-edge route');
await page.locator('#layout-mode-select').selectOption('existing');
await page.waitForFunction(() => document.querySelector('.diagram')?.getAttribute('data-layout-mode') === 'existing');
await page.locator('#fixture-select').selectOption('large');
await waitForLayout('large', 101);

const viewportBefore = await viewportTransform();
const beforePanZoomTiming = await page.locator('.status.timing').textContent();
await page.getByRole('button', { name: 'Re-layout' }).click();
await page.locator('.status.busy').waitFor({ state: 'visible' }).catch(() => undefined);
await page.locator('.react-flow__pane').hover();
await page.mouse.wheel(0, -350);
await waitForLayout('large', 101, beforePanZoomTiming);
const viewportAfter = await viewportTransform();

const darkContext = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' });
const darkPage = await darkContext.newPage();
await darkPage.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
await darkPage.goto(origin);
await waitForLayout('small', 8, undefined, darkPage);
await darkPage.locator('.react-flow__node[data-id="order-api"]').press('Enter');
const darkFocusOutline = await darkPage.locator('.react-flow__node[data-id="order-api"]').evaluate((node) => getComputedStyle(node).outlineStyle);
await darkPage.screenshot({ path: resolve(results, 'small-dark.png'), fullPage: true });

const summarize = (samples) => {
  const field = (name) => {
    const values = samples.map((sample) => sample[name]).sort((a, b) => a - b);
    return { samples: values, median: values[Math.floor(values.length / 2)], max: Math.max(...values) };
  };
  return { elkMs: field('elkMs'), requestToRenderMs: field('requestToRenderMs') };
};
const summarizeValues = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values, median: sorted[Math.floor(sorted.length / 2)], max: Math.max(...values) };
};
const updateSummary = Object.fromEntries(Object.entries(updateSamples).map(([id, samples]) => {
  const fields = ['renameRequestToRenderMs', 'addRequestToRenderMs', 'addElkMs', 'removeRequestToRenderMs', 'removeElkMs'];
  return [id, Object.fromEntries(fields.map((key) => [key, summarizeValues(samples.map((sample) => sample[key]))]))];
}));
const movementSummary = Object.fromEntries(Object.entries(movements).map(([id, samples]) => {
  const fields = ['addMaxSurvivorDisplacementFlowUnits', 'removeMaxSurvivorDisplacementFlowUnits'];
  return [id, Object.fromEntries(fields.map((key) => [key, summarizeValues(samples.map((sample) => sample[key]))]))];
}));
const report = {
  generatedAt: new Date().toISOString(),
  machine: { platform: process.platform, arch: os.arch(), release: os.release(), cpu: os.cpus()[0]?.model, node: process.version, browser: browser.version() },
  graphSizes: { small: { nodes: 8, relationships: 8 }, large: { nodes: 101, relationships: 105 } },
  initial: Object.fromEntries(Object.entries(fixtureSamples).map(([id, samples]) => [id, summarize(samples)])),
  initialSamples: fixtureSamples,
  updateSamples,
  movementUnit: 'React Flow canvas coordinates (viewport transform removed)',
  movementFlowUnits: movements,
  movementSummary,
  directElk,
  checks: {
    nestedBoundariesContainChildren: true,
    viewportAndGeometryPreservedOnRename: true,
    viewportAndSelectionPreservedOnStructuralUpdate: true,
    sourceNavigationByKeyboard: true,
    editorSelectionHighlightsKnownNode: true,
    visibleKeyboardFocus: focusOutline !== 'none',
    visibleDarkThemeKeyboardFocus: darkFocusOutline !== 'none',
    invalidPreviewRetainedAndRecovered: true,
    externalRequestsAttempted: externalRequests,
    pageErrors,
    panZoomDuringLayoutChangedViewport: viewportBefore !== viewportAfter,
    offlineBrowserAssets: externalRequests.length === 0,
  },
};
await writeFile(resolve(results, 'measurements.json'), `${JSON.stringify(report, null, 2)}\n`);
assert.deepEqual(pageErrors, []);
assert.deepEqual(externalRequests, []);
assert.equal(report.checks.visibleKeyboardFocus, true, 'Keyboard focus outline was not visible');
assert.equal(report.checks.visibleDarkThemeKeyboardFocus, true, 'Dark-theme keyboard focus outline was not visible');

await darkContext.close();
await context.close();
await browser.close();
await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
console.log(JSON.stringify({ screenshots: ['small-before.png', 'small-detail.png', 'small-after-add.png', 'large-before.png', 'large-after-add.png', 'small-dark.png', 'react-flow-direct-elk-small.png', 'react-flow-direct-elk-large.png', 'react-flow-direct-elk-small-manual.png'], directElk, manualRoute, initial: report.initial, updates: updateSummary, movement: movementSummary, checks: report.checks }, null, 2));
