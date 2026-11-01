import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from 'playwright';
import small from '../fixtures/small.json' with { type: 'json' };
import large from '../fixtures/large.json' with { type: 'json' };

const results = new URL('../results/', import.meta.url);
const fixtures = { small, large };
const server = await preview({ configFile: 'vite.mermaid-only.config.ts', preview: { host: '127.0.0.1', port: 0 } });
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
    await page.waitForFunction((fixture) => document.querySelector('#diagram svg')?.dataset.fixture === fixture, id, { timeout: 60000 });
    await page.waitForFunction(([nodes, edges]) =>
      document.querySelectorAll('#diagram svg g.node, #diagram svg g.cluster').length === nodes
      && document.querySelectorAll('#diagram svg path.flowchart-link').length === edges
      && document.querySelectorAll('#diagram svg g.edgeLabel').length === edges,
    [nodeCount, edgeCount], { timeout: 60000 });
    const details = await page.evaluate((fixture) => {
      const svg = document.querySelector('#diagram svg');
      const nodeGroups = [...svg.querySelectorAll('g.node')];
      const edgePaths = [...svg.querySelectorAll('path.flowchart-link')];
      const labels = [...svg.querySelectorAll('g.edgeLabel')];
      return {
        elementCount: nodeGroups.length + svg.querySelectorAll('g.cluster').length,
        relationshipCount: edgePaths.length,
        labelCount: labels.length,
        systemCount: svg.querySelectorAll('g.cluster').length,
        visibleLabels: labels.filter((label) => label.getBoundingClientRect().width > 0 && label.getBoundingClientRect().height > 0).length,
        nodeNames: fixture.elements.map((element) => element.name).filter((name) => !svg.textContent.includes(name)),
        viewBox: svg.getAttribute('viewBox'),
      };
    }, fixtures[id]);
    assert.equal(details.elementCount, nodeCount, `${id}: every element rendered`);
    assert.equal(details.relationshipCount, edgeCount, `${id}: every relationship rendered`);
    assert.equal(details.labelCount, edgeCount, `${id}: every relationship label rendered`);
    assert.equal(details.visibleLabels, edgeCount, `${id}: every relationship label visible`);
    assert.equal(details.systemCount, fixtures[id].elements.filter((element) => element.kind === 'system').length, `${id}: system subgraphs rendered`);
    assert.deepEqual(details.nodeNames, [], `${id}: node labels retained`);
    assert(details.viewBox && !details.viewBox.includes('NaN'), `${id}: valid Mermaid SVG viewBox`);
    if (id === 'small') {
      await mkdir(results, { recursive: true });
      await page.screenshot({ path: fileURLToPath(new URL('mermaid-only-small.png', results)) });
      const before = await page.locator('#diagram svg').getAttribute('viewBox');
      await page.mouse.move(800, 500);
      await page.mouse.wheel(0, -300);
      await page.waitForFunction((value) => document.querySelector('#diagram svg').getAttribute('viewBox') !== value, before);
      details.wheelZoomChangesViewBox = true;
      await page.locator('#fit').click();
      await page.waitForFunction((value) => document.querySelector('#diagram svg').getAttribute('viewBox') === value, details.viewBox);
      const beforePan = await page.locator('#diagram svg').getAttribute('viewBox');
      const bounds = await page.locator('#diagram svg').boundingBox();
      assert(bounds);
      await page.mouse.move(bounds.x + 400, bounds.y + 300);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 440, bounds.y + 330);
      await page.mouse.up();
      await page.waitForFunction((value) => document.querySelector('#diagram svg').getAttribute('viewBox') !== value, beforePan);
      details.dragPanChangesViewBox = true;
    } else {
      await page.screenshot({ path: fileURLToPath(new URL('mermaid-only-large.png', results)) });
    }
    report.fixtures[id] = details;
  }
  assert.deepEqual(pageErrors, [], 'Mermaid viewer has no browser errors');
  await writeFile(new URL('mermaid-only-comparison.json', results), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
