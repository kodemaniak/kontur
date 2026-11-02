import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { PreviewResult } from '../src/contract';

const repoRoot = resolve(import.meta.dirname, '../../..');

function exampleResult(): Extract<PreviewResult, { status: 'ok' }> {
  const dsl = resolve(repoRoot, 'examples/orders-payments/workspace.dsl');
  const output = execFileSync('cargo', [
    'run', '--locked', '--quiet', '-p', 'kontur-cli', '--', 'view', dsl, '--view', 'orders-payments',
  ], { cwd: repoRoot, encoding: 'utf8' });
  const result = JSON.parse(output) as PreviewResult;
  if (result.status !== 'ok') throw new Error('Expected the example view to compile');
  return result;
}

async function openPresenter(page: Page): Promise<void> {
  await page.goto('/presenter.html');
  await page.waitForFunction(() => typeof (window as any).createKonturPreview === 'function');
}

async function apply(page: Page, revision: number, result: PreviewResult): Promise<void> {
  await page.evaluate(async ({ revision, result }) => {
    const preview = (window as any).preview;
    if (!preview) (window as any).preview = (window as any).createKonturPreview();
    await (window as any).preview.applyResult(revision, result);
  }, { revision, result });
}

test('shows diagnostics without inventing a diagram for an initial invalid result', async ({ page }) => {
  await openPresenter(page);
  await apply(page, 1, {
    schemaVersion: 1,
    status: 'error',
    diagnostics: [{ code: 'syntax', severity: 'error', message: 'Invalid DSL', location: null }],
  });

  await expect(page.locator('#diagnostics')).toContainText('Invalid DSL');
  await expect(page.locator('#diagram svg')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'false');
});

test('marks pending updates, retains last valid output on core and transport errors, and recovers', async ({ page }) => {
  await openPresenter(page);
  await apply(page, 1, exampleResult());
  const diagram = page.locator('#diagram svg');
  await expect(diagram).toBeVisible();
  const lastValid = await diagram.evaluate((svg) => svg.outerHTML);

  await page.evaluate(() => (window as any).preview.markPending(2));
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'true');
  expect(await diagram.evaluate((svg) => svg.outerHTML)).toBe(lastValid);

  await apply(page, 2, {
    schemaVersion: 1,
    status: 'error',
    diagnostics: [{ code: 'semantic', severity: 'error', message: 'Invalid view', location: null }],
  });
  await expect(page.locator('#diagnostics')).toContainText('Invalid view');
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'true');
  expect(await diagram.evaluate((svg) => svg.outerHTML)).toBe(lastValid);

  await page.evaluate(() => (window as any).preview.showHostError(2, 'Preview service unavailable'));
  await expect(page.locator('#diagnostics')).toContainText('Preview service unavailable');
  expect(await diagram.evaluate((svg) => svg.outerHTML)).toBe(lastValid);

  const recovered = structuredClone(exampleResult());
  recovered.view.relationships[0].label = 'Recovered relationship';
  await apply(page, 3, recovered);
  await expect(page.locator('#diagram')).toContainText('Recovered relationship');
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'false');
});

test('retains the last SVG after Mermaid failure and invalidates a delayed obsolete render', async ({ page }) => {
  await openPresenter(page);
  const initial = exampleResult();
  await page.evaluate((result) => {
    const render = async (_id: string, definition: string) => {
      if (definition.includes('FAIL_RENDER')) throw new Error('Synthetic Mermaid render failure');
      return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>Current diagram</text></svg>' };
    };
    (window as any).preview = (window as any).createKonturPreview(render);
    return (window as any).preview.applyResult(1, result);
  }, initial);
  const diagram = page.locator('#diagram svg');
  await expect(diagram).toBeVisible();
  await page.locator('#zoom-in').click();
  const lastValid = await diagram.evaluate((svg) => svg.outerHTML);

  const failedRender = structuredClone(initial);
  failedRender.view.relationships[0].label = 'FAIL_RENDER';
  await apply(page, 2, failedRender);
  await expect(page.locator('#diagnostics')).toContainText('Synthetic Mermaid render failure');
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'true');
  expect(await diagram.evaluate((svg) => svg.outerHTML)).toBe(lastValid);

  const older = structuredClone(initial);
  older.view.relationships[0].label = 'Older response';
  const newest = structuredClone(initial);
  newest.view.relationships[0].label = 'Newest response';
  await page.evaluate(async ({ older, newest }) => {
    let releaseOlder!: () => void;
    let started!: () => void;
    const olderStarted = new Promise<void>((resolveStarted) => { started = resolveStarted; });
    const olderGate = new Promise<void>((resolveOlder) => { releaseOlder = resolveOlder; });
    (window as any).releaseOlder = releaseOlder;
    const render = async (_id: string, definition: string) => {
      if (definition.includes('Older response')) {
        started();
        await olderGate;
        return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>Older response</text></svg>' };
      }
      return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>Newest response</text></svg>' };
    };
    const preview = (window as any).createKonturPreview(render);
    (window as any).preview = preview;
    const oldRender = preview.applyResult(4, older);
    await olderStarted;
    await preview.applyResult(5, newest);
    (window as any).oldRender = oldRender;
  }, { older, newest });
  await expect(page.locator('#diagram')).toContainText('Newest response');
  await page.evaluate(async () => {
    (window as any).releaseOlder();
    await (window as any).oldRender;
  });
  await expect(page.locator('#diagram')).toContainText('Newest response');
  await expect(page.locator('#diagram')).not.toContainText('Older response');
});

test('preserves zoom and pan across equal geometry and preserves relative framing when geometry changes', async ({ page }) => {
  await openPresenter(page);
  const base = exampleResult();
  const equalGeometry = structuredClone(base);
  const changedGeometry = structuredClone(base);
  changedGeometry.view.relationships[0].label = 'Larger graph';

  await page.evaluate((result) => {
    const render = async (_id: string, definition: string) => {
      const size = definition.includes('Larger graph') ? '0 0 400 200' : '0 0 200 100';
      return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${size}"><text>Architecture</text></svg>`,
      };
    };
    (window as any).preview = (window as any).createKonturPreview(render);
    return (window as any).preview.applyResult(1, result);
  }, base);

  await page.locator('#fit').click();
  await page.locator('#zoom-in').click();
  const bounds = await page.locator('#diagram').boundingBox();
  if (!bounds) throw new Error('Expected the diagram canvas to be laid out');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 35, bounds.y + bounds.height / 2 + 20);
  await page.mouse.up();

  const readBox = () => page.locator('#diagram svg').evaluate((svg) =>
    (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number));
  const beforeEqual = await readBox();
  await apply(page, 2, equalGeometry);
  const afterEqual = await readBox();
  expect(afterEqual).toEqual(beforeEqual);

  await apply(page, 3, changedGeometry);
  const afterChanged = await readBox();
  expect(afterChanged[2]).toBeCloseTo(beforeEqual[2] * 2, 5);
  expect(afterChanged[3]).toBeCloseTo(beforeEqual[3] * 2, 5);
  expect((afterChanged[0] + afterChanged[2] / 2) / 400)
    .toBeCloseTo((beforeEqual[0] + beforeEqual[2] / 2) / 200, 5);
  expect((afterChanged[1] + afterChanged[3] / 2) / 200)
    .toBeCloseTo((beforeEqual[1] + beforeEqual[3] / 2) / 100, 5);
});

test('dispose removes the mounted presenter and makes later results inert', async ({ page }) => {
  await openPresenter(page);
  await page.evaluate(() => {
    (window as any).preview = (window as any).createKonturPreview();
    (window as any).preview.dispose();
  });

  await expect(page.locator('#diagram')).toHaveCount(0);
});
