import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from 'playwright';
import small from '../fixtures/small.json' with { type: 'json' };
import large from '../fixtures/large.json' with { type: 'json' };

const results = new URL('../results/', import.meta.url);
const fixtures = { small, large };
const server = await preview({ configFile: 'vite.sprotty.config.ts', preview: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (error) => { throw error; });
  await page.goto(server.resolvedUrls.local[0]);

  const fixtureResults = {};
  for (const [fixture, nodeCount, edgeCount] of [['small', 8, 8], ['large', 101, 105]]) {
    if (fixture === 'large') await page.locator('#fixture').selectOption(fixture);
    await page.waitForFunction(([nodes, edges]) =>
      document.querySelectorAll('#diagram > svg.sprotty-graph .sprotty-node').length === nodes
      && document.querySelectorAll('#diagram > svg.sprotty-graph .sprotty-edge').length === edges,
    [nodeCount, edgeCount], { timeout: 30000 });
    await page.waitForTimeout(150);
    const details = await page.evaluate((fixtureModel) => {
      const nodeRect = (id) => document.querySelector(`#diagram_${CSS.escape(id)} > rect.sprotty-node`).getBoundingClientRect();
      const rect = (box) => ({ x: box.x, y: box.y, right: box.right, bottom: box.bottom });
      const distanceToBoundary = (point, box) => {
        const x = Math.max(box.x, Math.min(point.x, box.right));
        const y = Math.max(box.y, Math.min(point.y, box.bottom));
        if (x !== point.x || y !== point.y) return Math.hypot(point.x - x, point.y - y);
        return Math.min(x - box.x, box.right - x, y - box.y, box.bottom - y);
      };
      const graph = document.querySelector('#diagram > svg.sprotty-graph');
      const edges = [...graph.querySelectorAll('g.sprotty-edge')].map((edge) => {
        const path = edge.querySelector('path');
        const project = (point) => {
          const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
          return { x: screen.x, y: screen.y };
        };
        const start = project(path.getPointAtLength(0));
        const end = project(path.getPointAtLength(path.getTotalLength()));
        const id = edge.id.replace('diagram_', '');
        const model = fixtureModel.relationships.find((relationship) => relationship.id === id);
        return {
          id,
          sourceGapPx: distanceToBoundary(start, rect(nodeRect(model.sourceId))),
          targetGapPx: distanceToBoundary(end, rect(nodeRect(model.targetId))),
        };
      });
      const nodeOverflows = fixtureModel.elements.filter((element) => element.parentId).flatMap((element) => {
        const parent = rect(nodeRect(element.parentId));
        const child = rect(nodeRect(element.id));
        return child.x < parent.x - 1 || child.y < parent.y - 1 || child.right > parent.right + 1 || child.bottom > parent.bottom + 1 ? [element.id] : [];
      });
      const labels = [...graph.querySelectorAll('g.sprotty-edge text')].map((label) => ({ id: label.id, box: rect(label.getBoundingClientRect()) }));
      const labelOverlaps = [];
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i].box, b = labels[j].box;
        if (a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y) labelOverlaps.push([labels[i].id, labels[j].id]);
      }
      return {
        edgeCount: edges.length,
        detachedEdges: edges.filter((edge) => edge.sourceGapPx >= 3 || edge.targetGapPx >= 3),
        maxEndpointGapPx: Math.max(...edges.flatMap((edge) => [edge.sourceGapPx, edge.targetGapPx])),
        nodeOverflows,
        edgeLabelCount: labels.length,
        edgeLabelOverlaps: labelOverlaps,
        systemChildren: fixtureModel.elements.filter((element) => element.parentId).length,
        missingSystemChildren: fixtureModel.elements.filter((element) => element.parentId).flatMap((element) => {
          const parent = document.querySelector(`#diagram_${CSS.escape(element.parentId)} #diagram_${CSS.escape(element.id)}`);
          return parent ? [] : [element.id];
        }),
        transform: graph.querySelector(':scope > g')?.getAttribute('transform'),
      };
    }, fixtures[fixture]);
    assert.equal(details.edgeCount, edgeCount, `${fixture}: relationships rendered`);
    assert.equal(details.edgeLabelCount, edgeCount, `${fixture}: relationship labels rendered`);
    assert.equal(details.missingSystemChildren.length, 0, `${fixture}: system children remain nested in the rendered model`);
    assert.equal(details.detachedEdges.length, 0, `${fixture}: routed edges attach to their endpoint boxes`);
    if (fixture === 'small') {
      await page.screenshot({ path: fileURLToPath(new URL('sprotty-small.png', results)) });
      const before = details.transform;
      await page.mouse.move(800, 500);
      await page.mouse.wheel(0, -350);
      await page.waitForFunction((before) => document.querySelector('#diagram > svg.sprotty-graph > g')?.getAttribute('transform') !== before, before);
      details.wheelZoomChangesViewport = true;
      await page.locator('#fit').click();
      await page.waitForTimeout(100);
    }
    if (fixture === 'large') {
      await page.screenshot({ path: fileURLToPath(new URL('sprotty-large.png', results)) });
      await page.mouse.move(800, 500);
      await page.mouse.wheel(0, -350);
      await page.waitForFunction((before) => document.querySelector('#diagram > svg.sprotty-graph > g')?.getAttribute('transform') !== before, details.transform);
      details.wheelZoomChangesViewport = true;
    }
    fixtureResults[fixture] = details;
  }
  const report = { browser: browser.version(), fixtures: fixtureResults };
  const path = new URL('sprotty-comparison.json', results);
  await mkdir(results, { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(fixtureResults).map(([id, result]) => [id, {
    edges: result.edgeCount,
    endpointGapsOver3px: result.detachedEdges.length,
    maxEndpointGapPx: result.maxEndpointGapPx,
    childBoundaryOverflows: result.nodeOverflows.length,
    edgeLabelOverlaps: result.edgeLabelOverlaps.length,
    wheelZoomChangesViewport: result.wheelZoomChangesViewport ?? 'not tested on large fixture',
  }])), null, 2));
  console.log(`Details: ${fileURLToPath(path)}`);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
