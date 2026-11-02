import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import { parsePreviewJson, type ResolvedViewDto } from '../src/contract';
import { buildMermaidDefinition } from '../src/mermaid';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let view!: ResolvedViewDto;

beforeAll(() => {
  const dsl = resolve(root, 'examples/orders-payments/workspace.dsl');
  const output = execFileSync('cargo', [
    'run', '--locked', '--quiet', '-p', 'kontur-cli', '--', 'view', dsl, '--view', 'orders-payments',
  ], { cwd: root, encoding: 'utf8' });
  const result = parsePreviewJson(output);
  if (result.status !== 'ok') throw new Error('Expected the example view to compile');
  view = result.view;
});

it('renders the selected people, containers, boundaries and all labeled relationships', () => {
  const definition = buildMermaidDefinition(view);
  expect(definition.startsWith('flowchart LR')).toBe(true);
  expect((definition.match(/^subgraph /gm) ?? [])).toHaveLength(3);
  expect((definition.match(/-->/g) ?? [])).toHaveLength(9);
  expect(definition).toContain('Operations Analyst');
  expect(definition).toContain('Orders and audit database');
  expect(definition).toContain('class n');
  expect(definition).not.toContain('r_user_storefront');
});

it('keeps hostile Mermaid and HTML punctuation inside escaped labels', () => {
  const hostile: ResolvedViewDto = {
    ...view,
    elements: view.elements.map((element, index) => index === 0
      ? { ...element, name: 'name"]\nSENTINEL <script> & |' }
      : element),
    relationships: view.relationships.map((relationship, index) => index === 0
      ? { ...relationship, label: 'click"]\nSENTINEL <svg onload=x> |' }
      : relationship),
  };
  const definition = buildMermaidDefinition(hostile);
  expect(definition).toContain('name&quot;]&#10;SENTINEL &lt;script&gt; &amp; &#124;');
  expect(definition).toContain('click&quot;]&#10;SENTINEL &lt;svg onload=x&gt; &#124;');
  expect(definition).not.toContain('<script>');
  expect(definition).not.toContain('<svg');
});
