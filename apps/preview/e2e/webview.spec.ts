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

async function post(page: Page, message: unknown): Promise<void> {
  await page.evaluate((value) => window.postMessage(value, '*'), message);
}

test('announces readiness, validates host results and ignores unknown or stale messages', async ({ page }) => {
  await page.goto('/webview.html');
  await expect.poll(() => page.evaluate(() => window.konturMessages)).toContainEqual({ type: 'ready' });

  await post(page, { type: 'pending', revision: 1 });
  await post(page, { type: 'result', revision: 1, result: exampleResult() });
  await expect(page.locator('#diagram svg')).toBeVisible();
  const validSvg = await page.locator('#diagram svg').evaluate((svg) => svg.outerHTML);

  await post(page, { type: 'pending', revision: 2 });
  await post(page, { type: 'host-error', revision: 2, message: 'Service unavailable' });
  await expect(page.locator('#diagnostics')).toContainText('Service unavailable');
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'true');
  await post(page, { type: 'result', revision: 1, result: exampleResult() });
  await post(page, { type: 'future-message', revision: 3, command: 'workbench.action.files.openFile', path: '/etc/passwd' });
  await post(page, { type: 'open-file', revision: 3, path: '/etc/passwd' });
  await post(page, { type: 'execute-command', revision: 3, command: 'workbench.action.files.openFile', path: '/etc/passwd' });
  await expect(page.locator('#diagnostics')).toContainText('Service unavailable');
  expect(await page.locator('#diagram svg').evaluate((svg) => svg.outerHTML)).toBe(validSvg);
  expect(await page.evaluate(() => window.konturMessages)).toEqual([{ type: 'ready' }]);
});

test('host failure cancels a render already in progress', async ({ page }) => {
  const result = exampleResult();
  await page.goto('/webview.html');
  await expect.poll(() => page.evaluate(() => window.konturMessages)).toContainEqual({ type: 'ready' });
  await page.evaluate((value) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'result', revision: 1, result: value },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'host-error', revision: 1, message: 'Service exited during render' },
    }));
  }, result);

  await expect(page.locator('#diagnostics')).toContainText('Service exited during render');
  await expect(page.locator('#diagram svg')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'false');
});

test('restores the same document’s last valid result and viewport before announcing readiness', async ({ page }) => {
  const result = exampleResult();
  const state = {
    schemaVersion: 1,
    documentUri: 'file:///fixture.dsl',
    revision: 7,
    result,
    viewport: { x: 15, y: 20, width: 300, height: 180 },
  };
  await page.addInitScript((seed) => { window.konturInitialState = seed; }, state);
  await page.goto('/webview.html');

  await expect(page.locator('#diagram svg')).toBeVisible();
  await expect(page.locator('#diagram svg')).toHaveAttribute('viewBox', '15 20 300 180');
  expect(await page.evaluate(() => window.konturMessages)).toEqual([{ type: 'ready' }]);
});

test('restores first, then applies a host error received during restoration before announcing ready', async ({ page }) => {
  const state = {
    schemaVersion: 1,
    documentUri: 'file:///fixture.dsl',
    revision: 4,
    result: exampleResult(),
    viewport: { x: 11, y: 13, width: 240, height: 160 },
  };
  await page.addInitScript((seed) => {
    window.konturInitialState = seed;
    window.konturInitialHostMessage = { type: 'host-error', revision: 1, message: 'Previous request failed' };
  }, state);
  await page.goto('/webview.html');

  await expect(page.locator('#diagram svg')).toBeVisible();
  await expect(page.locator('#diagram svg')).toHaveAttribute('viewBox', '11 13 240 160');
  await expect(page.locator('#diagnostics')).toContainText('Previous request failed');
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'true');
  expect(await page.evaluate(() => window.konturMessages)).toEqual([{ type: 'ready' }]);
});

test('stores last-valid presentation state and does not replace it with a later error', async ({ page }) => {
  await page.goto('/webview.html');
  await expect.poll(() => page.evaluate(() => window.konturMessages)).toContainEqual({ type: 'ready' });
  await post(page, { type: 'result', revision: 1, result: exampleResult() });
  await expect(page.locator('#diagram svg')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.konturSavedState)).not.toBeUndefined();
  const saved = await page.evaluate(() => window.konturSavedState);
  await post(page, {
    type: 'result',
    revision: 2,
    result: { schemaVersion: 1, status: 'error', diagnostics: [
      { code: 'syntax', severity: 'error', message: 'Invalid source', location: null },
    ] },
  });
  await expect(page.locator('#diagnostics')).toContainText('Invalid source');
  expect(await page.evaluate(() => window.konturSavedState)).toEqual(saved);
});

test('restores the stored view after webview recreation and rejects state from another document', async ({ page }) => {
  await page.goto('/webview.html');
  await expect.poll(() => page.evaluate(() => window.konturMessages)).toContainEqual({ type: 'ready' });
  await post(page, { type: 'result', revision: 1, result: exampleResult() });
  await expect(page.locator('#diagram svg')).toBeVisible();
  await page.locator('#zoom-in').click();
  const stored = await page.evaluate(() => window.konturSavedState as {
    schemaVersion: number; documentUri: string; revision: number;
    result: PreviewResult; viewport: { x: number; y: number; width: number; height: number };
  });
  expect(stored.documentUri).toBe('file:///fixture.dsl');

  await page.reload();
  await expect(page.locator('#diagram svg')).toBeVisible();
  await expect(page.locator('#diagram svg')).toHaveAttribute('viewBox',
    `${stored.viewport.x} ${stored.viewport.y} ${stored.viewport.width} ${stored.viewport.height}`);
  expect(await page.evaluate(() => window.konturMessages)).toEqual([{ type: 'ready' }]);

  await page.addInitScript((state) => {
    window.konturInitialState = { ...state, documentUri: 'file:///other.dsl' };
  }, stored);
  await page.reload();
  await expect(page.locator('#diagram svg')).toHaveCount(0);
  expect(await page.evaluate(() => window.konturMessages)).toEqual([{ type: 'ready' }]);
});
