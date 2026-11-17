import { expect, test } from '@playwright/test';

test('Playground renders and recompiles with WASM under the Pages path', async ({ page }) => {
  test.skip(process.env.KONTUR_TEST_PLAYGROUND !== '1', 'Requires the built Playground.');
  await page.route('https://fonts.*/**', (route) => route.abort());
  await page.goto('/kontur/playground/index.html');
  await page.getByRole('link', { name: 'Rust-Vorschau' }).click();
  const diagram = page.locator('#diagram');
  await expect(diagram.locator('svg')).toBeVisible();
  await expect(diagram).toContainText('Order Hub');

  const editor = page.getByRole('textbox', { name: /Orders/ });
  const source = await editor.inputValue();
  await editor.fill('workspace "broken');
  await expect(page.locator('#diagnostics')).toContainText('syntax');
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'true');
  await editor.fill(source.replace('Order Hub', 'Bücher 📚'));
  await expect(diagram).toContainText('Bücher 📚');
  await expect(page.locator('#status')).toHaveAttribute('data-stale', 'false');
});
