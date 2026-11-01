import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from 'playwright';

const results = new URL('../results/', import.meta.url);
const epsilon = 0.1;
const distanceToBoundary = (point, box) => {
  const x = Math.max(box.x, Math.min(point.x, box.x + box.width));
  const y = Math.max(box.y, Math.min(point.y, box.y + box.height));
  if (x !== point.x || y !== point.y) return Math.hypot(point.x - x, point.y - y);
  return Math.min(x - box.x, box.x + box.width - x, y - box.y, box.y + box.height - y);
};
const contains = (parent, child) => child.x >= parent.x - epsilon && child.y >= parent.y - epsilon
  && child.x + child.width <= parent.x + parent.width + epsilon
  && child.y + child.height <= parent.y + parent.height + epsilon;

assert.equal(distanceToBoundary({ x: 0, y: 5 }, { x: 0, y: 0, width: 10, height: 10 }), 0);
assert.equal(distanceToBoundary({ x: 5, y: 5 }, { x: 0, y: 0, width: 10, height: 10 }), 5);
assert.equal(distanceToBoundary({ x: -3, y: -4 }, { x: 0, y: 0, width: 10, height: 10 }), 5);
assert.equal(contains({ x: 0, y: 0, width: 10, height: 10 }, { x: 1, y: 1, width: 9, height: 10 }), false);

const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript(() => {
    window.__elkGeometry = { inputs: [], outputs: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => window.__elkGeometry.outputs.push(structuredClone(data)));
      }
      postMessage(data, ...args) {
        window.__elkGeometry.inputs.push(structuredClone(data));
        return super.postMessage(data, ...args);
      }
    };
  });
  await page.goto(server.resolvedUrls.local[0]);
  const report = { browser: browser.version(), toleranceFlowUnits: epsilon, fixtures: {} };
  for (const [id, count] of [['small', 8], ['large', 101]]) {
    if (id === 'large') await page.locator('#fixture-select').selectOption(id);
    await page.waitForFunction((count) => window.__elkGeometry.outputs.at(-1)?.graph
      && document.querySelectorAll('.react-flow__node').length === count
      && !document.querySelector('.status.busy'), count);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const captured = await page.evaluate(() => {
      const reference = document.querySelector('.react-flow__edge-path').getScreenCTM().inverse();
      const bounds = (element) => {
        const box = element.getBoundingClientRect();
        const start = new DOMPoint(box.x, box.y).matrixTransform(reference);
        const end = new DOMPoint(box.right, box.bottom).matrixTransform(reference);
        return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
      };
      const input = window.__elkGeometry.inputs.at(-1).graph;
      const output = window.__elkGeometry.outputs.at(-1).graph;
      const nodes = [...document.querySelectorAll('.react-flow__node')].map((element) => ({
        id: element.dataset.id, wrapper: bounds(element), visible: bounds(element.querySelector('.c4-node')),
      }));
      const edges = [...document.querySelectorAll('.react-flow__edge')].map((element) => {
        const path = element.querySelector('.react-flow__edge-path');
        const project = (point) => {
          const global = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()).matrixTransform(reference);
          return { x: global.x, y: global.y };
        };
        return { id: element.dataset.id, start: project(path.getPointAtLength(0)), end: project(path.getPointAtLength(path.getTotalLength())) };
      });
      return { input, output, nodes, edges };
    });
    const nodes = new Map();
    const visit = (node, parent) => {
      const absolute = { id: node.id, parentId: parent?.id, x: (parent?.x ?? 0) + (node.x ?? 0), y: (parent?.y ?? 0) + (node.y ?? 0), width: node.width, height: node.height };
      assert([absolute.x, absolute.y, absolute.width, absolute.height].every(Number.isFinite), `${id}: non-finite node ${node.id}`);
      if (parent) assert(contains(parent, absolute), `${id}: ELK child ${node.id} outside ${parent.id}`);
      nodes.set(node.id, absolute);
      for (const child of node.children ?? []) visit(child, absolute);
    };
    visit(captured.output);
    assert.equal(nodes.size - 1, count);
    const renderedNodes = new Map(captured.nodes.map((node) => [node.id, node]));
    const renderedEdges = new Map(captured.edges.map((edge) => [edge.id, edge]));
    const geometryMismatches = captured.nodes.flatMap((node) => {
      const expected = nodes.get(node.id);
      return ['x', 'y', 'width', 'height'].some((key) => Math.abs(expected[key] - node.visible[key]) > epsilon)
        ? [{ id: node.id, elk: expected, ...node }] : [];
    });
    const visibleBoundaryOverflows = captured.nodes.filter((node) => {
      const parentId = nodes.get(node.id).parentId;
      return parentId !== 'root' && !contains(renderedNodes.get(parentId).visible, node.visible);
    }).map((node) => node.id);
    const detachedRenderedEdges = [];
    for (const edge of captured.output.edges) {
      const container = nodes.get(edge.container ?? 'root');
      assert(container, `${id}: missing edge container ${edge.container}`);
      assert.equal(edge.sections?.length, 1, `${id}: expected a single route section for ${edge.id}`);
      const section = edge.sections[0];
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
      assert(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), `${id}: invalid route ${edge.id}`);
      for (let index = 1; index < points.length; index++) {
        assert(Math.abs(points[index].x - points[index - 1].x) <= epsilon || Math.abs(points[index].y - points[index - 1].y) <= epsilon, `${id}: non-orthogonal route ${edge.id}`);
      }
      const global = (point) => ({ x: point.x + container.x, y: point.y + container.y });
      const sourceId = edge.sources[0];
      const targetId = edge.targets[0];
      assert(distanceToBoundary(global(section.startPoint), nodes.get(sourceId)) <= epsilon, `${id}: ELK route ${edge.id} misses source`);
      assert(distanceToBoundary(global(section.endPoint), nodes.get(targetId)) <= epsilon, `${id}: ELK route ${edge.id} misses target`);
      const rendered = renderedEdges.get(edge.id);
      assert(rendered, `${id}: rendered edge ${edge.id} missing`);
      const sourceGap = distanceToBoundary(rendered.start, renderedNodes.get(sourceId).visible);
      const targetGap = distanceToBoundary(rendered.end, renderedNodes.get(targetId).visible);
      if (sourceGap > epsilon || targetGap > epsilon) detachedRenderedEdges.push({ id: edge.id, container: edge.container, sourceGap, targetGap });
    }
    report.fixtures[id] = {
      nodes: count, edges: captured.output.edges.length,
      rawElkContainmentAndEndpointsPass: true,
      geometryMismatches, visibleBoundaryOverflows, detachedRenderedEdges,
    };
    if (id === 'small') {
      await mkdir(results, { recursive: true });
      for (const field of ['input', 'output']) await writeFile(new URL(`elk-small-${field}.json`, results), `${JSON.stringify(captured[field], null, 2)}\n`);
    }
  }
  const path = new URL('elk-geometry.json', results);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.fixtures).map(([id, fixture]) => [id, {
    nodes: fixture.nodes, edges: fixture.edges,
    rawElkContainmentAndEndpointsPass: fixture.rawElkContainmentAndEndpointsPass,
    geometryMismatches: fixture.geometryMismatches.length,
    visibleBoundaryOverflows: fixture.visibleBoundaryOverflows,
    detachedRenderedEdges: fixture.detachedRenderedEdges.length,
  }])), null, 2));
  console.log(`Details: ${fileURLToPath(path)}`);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
