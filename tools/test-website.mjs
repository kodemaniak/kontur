import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../website/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../website/styles.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../website/script.js', import.meta.url), 'utf8');

test('landing page has a coherent vision and an honest project status', () => {
  assert.match(html, /Architecture that knows when reality changes/i);
  assert.match(html, /Reconciliation is a vision, not a shipped feature/i);
  assert.match(html, /Current prototype/i);
  assert.match(html, /Linux x64/i);
});

test('all sections referenced by internal links exist', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const [, hash] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.has(hash), `Missing section target #${hash}`);
  }
});

test('site is self-contained, responsive and motion-aware', () => {
  assert.match(html, /name="viewport"/);
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/script\.js"/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media\s*\(max-width:/);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\/(?:fonts|cdn)\./);
});

test('illustrative architecture comparison is keyboard operable', () => {
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /data-mode="diff"/);
  assert.match(js, /setAttribute\('aria-pressed'/);
  assert.match(js, /addEventListener\('click'/);
});
