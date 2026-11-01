import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const fixturePath = resolve(repoRoot, 'apps/preview/test-results/orders-payments.dsl');
const originalDsl = readFileSync(resolve(repoRoot, 'examples/orders-payments/workspace.dsl'), 'utf8');

test.beforeEach(() => writeFileSync(fixturePath, originalDsl));

test('reloads saved DSL through Rust, filters view membership, retains stale output, recovers, and pans/zooms', async ({ page }) => {
  await page.goto('/');
  const diagram = page.locator('#diagram');
  await expect(diagram.locator('svg')).toBeVisible();
  await expect(page.locator('#status')).toContainText('6 elements');
  await expect(diagram).toContainText('Operations analyst');

  let dsl = originalDsl.replace('Operations analyst', 'Shift supervisor');
  writeFileSync(fixturePath, dsl);
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(diagram).toContainText('Shift supervisor');

  dsl = dsl.replace('Reviews and places orders', 'Inspects and submits orders');
  writeFileSync(fixturePath, dsl);
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(diagram).toContainText('Inspects and submits orders');

  dsl = dsl.replace('include operations_analyst storefront order_api order_db payment_api payment_db', 'include operations_analyst storefront order_api order_db payment_api');
  writeFileSync(fixturePath, dsl);
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.locator('#status')).toContainText('5 elements');
  await expect(diagram).not.toContainText('Settlement ledger database');
  expect(dsl).toContain('payment_db = container');

  const beforeInvalid = await diagram.locator('svg').evaluate((svg) => svg.outerHTML);
  writeFileSync(fixturePath, dsl.replace('!impliedRelationships false', '!unsupportedDirective'));
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'true');
  await expect(page.locator('#diagnostics')).toContainText('Unsupported');
  expect(await diagram.locator('svg').evaluate((svg) => svg.outerHTML)).toBe(beforeInvalid);

  writeFileSync(fixturePath, dsl.replace('Shift supervisor', 'Shift supervisor recovered'));
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(diagram).toContainText('Shift supervisor recovered');
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'false');

  const svg = diagram.locator('svg');
  const beforeZoom = await svg.getAttribute('viewBox');
  await diagram.dispatchEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300 });
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(beforeZoom);

  const beforePan = await svg.getAttribute('viewBox');
  const bounds = await diagram.boundingBox();
  if (!bounds) throw new Error('Diagram canvas has no browser bounds');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + bounds.height / 2 + 20);
  await page.mouse.up();
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(beforePan);

  await page.getByRole('button', { name: 'Fit' }).click();
  await expect.poll(() => svg.getAttribute('viewBox')).toBe(beforeZoom);
});

test('shows diagnostics without inventing a diagram on an invalid initial load', async ({ page }) => {
  writeFileSync(fixturePath, 'workspace "broken');
  await page.goto('/');
  await expect(page.locator('#diagnostics')).toContainText('Unclosed quoted string');
  await expect(page.locator('#diagram svg')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'false');
});

test('shows structured diagnostics returned by a failed local bridge', async ({ page }) => {
  await page.route('**/api/view', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 1,
      status: 'error',
      diagnostics: [{ code: 'host', severity: 'error', message: 'The local Kontur CLI could not be started.', location: null }],
    }),
  }));
  await page.goto('/');
  await expect(page.locator('#diagnostics')).toContainText('The local Kontur CLI could not be started.');
  await expect(page.locator('#diagnostics code')).toHaveText('host');
  await expect(page.locator('#diagram svg')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'false');
});

test('a delayed older reload cannot overwrite a newer successful result', async ({ page }) => {
  const dsl = resolve(repoRoot, 'examples/orders-payments/workspace.dsl');
  const result = JSON.parse(execFileSync('cargo', [
    'run', '--locked', '--quiet', '-p', 'kontur-cli', '--', 'view', dsl, '--view', 'orders-payments',
  ], { cwd: repoRoot, encoding: 'utf8' })) as { view: { elements: { name: string }[] } };
  let requestCount = 0;
  let releaseOlder!: () => void;
  let olderCaptured!: () => void;
  const olderIsCaptured = new Promise<void>((resolveCaptured) => { olderCaptured = resolveCaptured; });
  const olderGate = new Promise<void>((resolveOlder) => { releaseOlder = resolveOlder; });

  await page.route('**/api/view', async (route) => {
    requestCount += 1;
    if (requestCount === 2) {
      olderCaptured();
      await olderGate;
      const older = structuredClone(result);
      older.view.elements[0].name = 'Older response';
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, status: 'ok', view: older.view }) });
    } else {
      const latest = structuredClone(result);
      latest.view.elements[0].name = requestCount === 1 ? 'Initial response' : 'Newest response';
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, status: 'ok', view: latest.view }) });
    }
  });

  await page.goto('/');
  await expect(page.locator('#diagram')).toContainText('Initial response');
  await page.getByRole('button', { name: 'Reload' }).click();
  await olderIsCaptured;
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.locator('#diagram')).toContainText('Newest response');
  releaseOlder();
  await expect(page.locator('#diagram')).toContainText('Newest response');
  await expect(page.locator('#diagram')).not.toContainText('Older response');
});
