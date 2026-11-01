import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from 'playwright';
import small from '../fixtures/small.json' with { type: 'json' };
import large from '../fixtures/large.json' with { type: 'json' };

const results = new URL('../results/', import.meta.url);
const fixtures = { small, large };
const server = await preview({ configFile: 'vite.dagre-only.config.ts', preview: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  const report = { browser: browser.version(), fixtures: {} };

  for (const [id, nodeCount, edgeCount] of [['small', 8, 8], ['large', 101, 105]]) {
    if (id === 'large') await page.locator('#fixture').selectOption(id);
    await page.waitForFunction(([fixture, nodes, edges]) => {
      const svg = document.querySelector('svg');
      return svg?.dataset.fixture === fixture && Number(svg.dataset.nodeCount) === nodes && Number(svg.dataset.edgeCount) === edges;
    }, [id, nodeCount, edgeCount], { timeout: 30000 });
    const details = await page.evaluate((fixture) => {
      const box = (id) => document.querySelector(`[data-node-id="${CSS.escape(id)}"]`).getBoundingClientRect();
      const gap = (point, bounds) => {
        const x = Math.max(bounds.left, Math.min(point.x, bounds.right));
        const y = Math.max(bounds.top, Math.min(point.y, bounds.bottom));
        if (x !== point.x || y !== point.y) return Math.hypot(point.x - x, point.y - y);
        return Math.min(x - bounds.left, bounds.right - x, y - bounds.top, bounds.bottom - y);
      };
      const overflows = fixture.elements.filter((element) => element.parentId).flatMap((element) => {
        const parent = box(element.parentId), child = box(element.id);
        return child.left < parent.left - 1 || child.top < parent.top - 1 || child.right > parent.right + 1 || child.bottom > parent.bottom + 1 ? [element.id] : [];
      });
      const detached = [...document.querySelectorAll('[data-route="true"]')].flatMap((path) => {
        const edge = path.closest('[data-edge-id]');
        const relation = fixture.relationships.find((item) => item.id === edge.dataset.edgeId);
        const project = (distance) => {
          const point = path.getPointAtLength(distance);
          return new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
        };
        const sourceGap = gap(project(0), box(relation.sourceId));
        const targetGap = gap(project(path.getTotalLength()), box(relation.targetId));
        return sourceGap >= 4 || targetGap >= 4 ? [{ id: relation.id, sourceGap, targetGap }] : [];
      });
      const labels = [...document.querySelectorAll('[data-label-for]')];
      const labelBoxes = labels.map((label) => label.getBoundingClientRect());
      const labelOverlaps = [];
      for (let i = 0; i < labelBoxes.length; i++) for (let j = i + 1; j < labelBoxes.length; j++) {
        const a = labelBoxes[i], b = labelBoxes[j];
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) labelOverlaps.push([i, j]);
      }
      return {
        elementCount: document.querySelectorAll('[data-node-id]').length,
        relationshipCount: document.querySelectorAll('[data-edge-id]').length,
        labelCount: labels.length,
        visibleLabels: labels.filter((label) => label.getBoundingClientRect().width > 0 && label.getBoundingClientRect().height > 0).length,
        labelOverlaps: labelOverlaps.length,
        systemCount: document.querySelectorAll('[data-node-kind="system"]').length,
        nodeOverflows: overflows,
        detached,
        routeFallbacks: document.querySelectorAll('[data-route-fallback="true"]').length,
        viewBox: document.querySelector('svg').getAttribute('viewBox'),
      };
    }, fixtures[id]);
    assert.equal(details.elementCount, nodeCount, `${id}: all elements rendered`);
    assert.equal(details.relationshipCount, edgeCount, `${id}: all relationships rendered`);
    assert.equal(details.labelCount, edgeCount, `${id}: all relationship labels rendered`);
    assert.equal(details.visibleLabels, edgeCount, `${id}: all labels visible`);
    assert.equal(details.systemCount, fixtures[id].elements.filter((element) => element.kind === 'system').length, `${id}: system boxes rendered`);
    assert.deepEqual(details.nodeOverflows, [], `${id}: child nodes inside system boundaries`);
    assert.deepEqual(details.detached, [], `${id}: routes touch source and target boxes`);
    assert(details.viewBox && !details.viewBox.includes('NaN'), `${id}: valid Dagre viewBox`);
    if (id === 'small') {
      assert(details.routeFallbacks > 0, 'small: cross-compound routes are visibly marked as fallbacks');
      await mkdir(results, { recursive: true });
      await page.screenshot({ path: fileURLToPath(new URL('dagre-only-small.png', results)) });
      const before = await page.locator('svg').getAttribute('viewBox');
      await page.mouse.move(800, 500);
      await page.mouse.wheel(0, -300);
      await page.waitForFunction((value) => document.querySelector('svg').getAttribute('viewBox') !== value, before);
      details.wheelZoomChangesViewBox = true;
      await page.locator('#fit').click();
      await page.waitForFunction((value) => document.querySelector('svg').getAttribute('viewBox') === value, details.viewBox);
      const beforePan = await page.locator('svg').getAttribute('viewBox');
      const bounds = await page.locator('svg').boundingBox();
      assert(bounds);
      await page.mouse.move(bounds.x + 400, bounds.y + 300);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 440, bounds.y + 330);
      await page.mouse.up();
      await page.waitForFunction((value) => document.querySelector('svg').getAttribute('viewBox') !== value, beforePan);
      details.dragPanChangesViewBox = true;
    } else await page.screenshot({ path: fileURLToPath(new URL('dagre-only-large.png', results)) });
    report.fixtures[id] = details;
  }
  assert.deepEqual(pageErrors, [], 'Dagre viewer has no browser errors');
  await writeFile(new URL('dagre-only-comparison.json', results), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
