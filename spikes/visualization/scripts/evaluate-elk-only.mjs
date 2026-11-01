import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from 'playwright';
import small from '../fixtures/small.json' with { type: 'json' };
import large from '../fixtures/large.json' with { type: 'json' };

const results = new URL('../results/', import.meta.url);
const fixtures = { small, large };
const server = await preview({ configFile: 'vite.elk-only.config.ts', preview: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (error) => { throw error; });
  await page.goto(server.resolvedUrls.local[0]);
  const report = { browser: browser.version(), fixtures: {} };

  for (const [id, nodeCount, edgeCount] of [['small', 8, 8], ['large', 101, 105]]) {
    if (id === 'large') await page.locator('#fixture').selectOption(id);
    await page.waitForFunction((fixture) => document.querySelector('svg')?.dataset.fixture === fixture, id, { timeout: 30000 });
    await page.waitForFunction(([nodes, edges]) =>
      Number(document.querySelector('svg')?.dataset.nodeCount) === nodes
      && Number(document.querySelector('svg')?.dataset.edgeCount) === edges,
    [nodeCount, edgeCount]);
    const details = await page.evaluate((fixture) => {
      const box = (id) => document.querySelector(`[data-node-id="${CSS.escape(id)}"]`).getBoundingClientRect();
      const nodeOverflows = fixture.elements.filter((element) => element.parentId).flatMap((element) => {
        const parent = box(element.parentId);
        const child = box(element.id);
        return child.left < parent.left - 1 || child.top < parent.top - 1 || child.right > parent.right + 1 || child.bottom > parent.bottom + 1 ? [element.id] : [];
      });
      const gap = (point, bounds) => {
        const x = Math.max(bounds.left, Math.min(point.x, bounds.right));
        const y = Math.max(bounds.top, Math.min(point.y, bounds.bottom));
        if (x !== point.x || y !== point.y) return Math.hypot(point.x - x, point.y - y);
        return Math.min(x - bounds.left, bounds.right - x, y - bounds.top, bounds.bottom - y);
      };
      const detached = [...document.querySelectorAll('[data-route="true"]')].flatMap((path) => {
        const id = path.closest('[data-edge-id]').dataset.edgeId;
        const relationship = fixture.relationships.find((item) => item.id === id);
        const project = (distance) => new DOMPoint(path.getPointAtLength(distance).x, path.getPointAtLength(distance).y).matrixTransform(path.getScreenCTM());
        const start = project(0), end = project(path.getTotalLength());
        const sourceGap = gap(start, box(relationship.sourceId));
        const targetGap = gap(end, box(relationship.targetId));
        return sourceGap >= 4 || targetGap >= 4 ? [{ id, sourceGap, targetGap }] : [];
      });
      const labels = [...document.querySelectorAll('[data-label-for]')].map((node) => node.getBoundingClientRect());
      const overlaps = [];
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j];
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps.push([i, j]);
      }
      const svgChildren = [...document.querySelector('svg').children];
      const indexOf = (selector, mode) => {
        const indexes = svgChildren.map((node, index) => node.matches(selector) ? index : -1).filter((index) => index >= 0);
        return mode === 'last' ? Math.max(...indexes) : Math.min(...indexes);
      };
      const lastBoundaryIndex = indexOf('[data-node-kind="system"]', 'last');
      const firstEdgeIndex = indexOf('[data-edge-id]', 'first');
      const lastEdgeIndex = indexOf('[data-edge-id]', 'last');
      const firstElementIndex = indexOf('[data-node-kind]:not([data-node-kind="system"])', 'first');
      return {
        elementCount: document.querySelectorAll('[data-node-id]').length,
        relationshipCount: document.querySelectorAll('[data-edge-id]').length,
        labelCount: labels.length,
        missingSystemChildren: fixture.elements.filter((element) => element.parentId && !document.querySelector(`[data-node-id="${CSS.escape(element.id)}"][data-parent-id="${CSS.escape(element.parentId)}"]`)).map((element) => element.id),
        nodeOverflows,
        detached,
        labelOverlaps: overlaps,
        systemBackgroundsBehindEdges: lastBoundaryIndex < firstEdgeIndex,
        elementBoxesAboveEdges: firstElementIndex > lastEdgeIndex,
        viewBox: document.querySelector('svg').getAttribute('viewBox'),
      };
    }, fixtures[id]);
    assert.equal(details.elementCount, nodeCount, `${id}: all elements rendered`);
    assert.equal(details.relationshipCount, edgeCount, `${id}: all relationships rendered`);
    assert.equal(details.labelCount, edgeCount, `${id}: all relationship labels rendered`);
    assert.equal(details.missingSystemChildren.length, 0, `${id}: nested model relationships retained`);
    assert.equal(details.nodeOverflows.length, 0, `${id}: child boxes remain inside systems`);
    assert.equal(details.detached.length, 0, `${id}: routes attach to node borders`);
    assert.equal(details.systemBackgroundsBehindEdges, true, `${id}: system fills render behind routes`);
    assert.equal(details.elementBoxesAboveEdges, true, `${id}: element boxes render above routes`);
    if (id === 'small') {
      await mkdir(results, { recursive: true });
      await page.screenshot({ path: fileURLToPath(new URL('elk-only-small.png', results)) });
      const before = await page.locator('svg').getAttribute('viewBox');
      await page.mouse.move(800, 500);
      await page.mouse.wheel(0, -300);
      await page.waitForFunction((value) => document.querySelector('svg').getAttribute('viewBox') !== value, before);
      details.wheelZoomChangesViewBox = true;
      await page.locator('#route-mode').selectOption('manual');
      await page.waitForFunction(() => document.querySelector('svg')?.dataset.routeMode === 'manual');
      const manualRoute = await page.evaluate((fixture) => {
        const edge = document.querySelector('[data-edge-id="r-payment-order-result"]');
        const path = edge.querySelector('[data-route="true"]');
        const relation = fixture.relationships.find((item) => item.id === 'r-payment-order-result');
        const box = (id) => document.querySelector(`[data-node-id="${CSS.escape(id)}"]`).getBoundingClientRect();
        const gap = (point, bounds) => {
          const x = Math.max(bounds.left, Math.min(point.x, bounds.right));
          const y = Math.max(bounds.top, Math.min(point.y, bounds.bottom));
          if (x !== point.x || y !== point.y) return Math.hypot(point.x - x, point.y - y);
          return Math.min(x - bounds.left, bounds.right - x, y - bounds.top, bounds.bottom - y);
        };
        const project = (distance) => new DOMPoint(path.getPointAtLength(distance).x, path.getPointAtLength(distance).y).matrixTransform(path.getScreenCTM());
        return {
          sourceGap: gap(project(0), box(relation.sourceId)),
          targetGap: gap(project(path.getTotalLength()), box(relation.targetId)),
          route: path.getAttribute('d'),
          labelVisible: document.querySelector('[data-label-for="r-payment-order-result"]') !== null,
        };
      }, fixtures.small);
      assert(manualRoute.sourceGap < 4, 'manual return route attaches to Payment Authorization API');
      assert(manualRoute.targetGap < 4, 'manual return route attaches to Order Management API');
      assert.equal(manualRoute.labelVisible, true, 'manual return route retains its label');
      details.manualRoute = manualRoute;
      await page.screenshot({ path: fileURLToPath(new URL('elk-only-small-manual.png', results)) });
      await page.locator('#route-mode').selectOption('elk');
      await page.waitForFunction(() => document.querySelector('svg')?.dataset.routeMode === 'elk');
    } else {
      await page.screenshot({ path: fileURLToPath(new URL('elk-only-large.png', results)) });
    }
    report.fixtures[id] = details;
  }
  await writeFile(new URL('elk-only-comparison.json', results), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.fixtures).map(([id, result]) => [id, {
    elements: result.elementCount,
    relationships: result.relationshipCount,
    labels: result.labelCount,
    containmentOverflows: result.nodeOverflows.length,
    detachedRoutes: result.detached.length,
    labelOverlaps: result.labelOverlaps.length,
  }])), null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
