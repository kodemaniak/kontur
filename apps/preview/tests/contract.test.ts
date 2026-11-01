import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parsePreviewJson, type PreviewResult } from '../src/contract';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let actualRustOutput = '';
let actual!: PreviewResult;

beforeAll(() => {
  const dsl = resolve(root, 'examples/orders-payments/workspace.dsl');
  actualRustOutput = execFileSync('cargo', [
    'run', '--locked', '--quiet', '-p', 'kontur-cli', '--', 'view', dsl, '--view', 'orders-payments',
  ], { cwd: root, encoding: 'utf8' });
  actual = parsePreviewJson(actualRustOutput);
});

function mutateView(change: (view: Record<string, unknown>) => void): string {
  const value = JSON.parse(actualRustOutput) as { view: Record<string, unknown> };
  change(value.view);
  return JSON.stringify(value);
}

describe('Rust CLI transport contract', () => {
  it('accepts actual Rust output and preserves the projected view', () => {
    expect(actual.status).toBe('ok');
    if (actual.status !== 'ok') throw new Error('expected a successful view');
    expect(actual.schemaVersion).toBe(1);
    expect(actual.view.elements).toHaveLength(6);
    expect(actual.view.boundaries).toHaveLength(2);
    expect(actual.view.relationships).toHaveLength(8);
    expect(actual.view.elements.filter((element) => element.kind === 'container' && element.tags.includes('Database'))).toHaveLength(2);
  });

  it('rejects malformed JSON, incompatible versions, and mixed success/error fields', () => {
    expect(() => parsePreviewJson('{')).toThrow(/JSON/i);
    expect(() => parsePreviewJson(JSON.stringify({ ...actual, schemaVersion: 2 }))).toThrow(/version/i);
    expect(() => parsePreviewJson(JSON.stringify({ ...actual, diagnostics: [] }))).toThrow(/shape/i);
  });

  it('rejects duplicate IDs, missing boundaries, and relationships with omitted endpoints', () => {
    const duplicate = mutateView((view) => {
      const elements = view.elements as { id: string }[];
      elements[1].id = elements[0].id;
    });
    expect(() => parsePreviewJson(duplicate)).toThrow(/duplicate.*id/i);

    const missingBoundary = mutateView((view) => {
      const elements = view.elements as { kind: string; parentId: string | null }[];
      const container = elements.find((element) => element.kind === 'container')!;
      container.parentId = 'absent-system';
    });
    expect(() => parsePreviewJson(missingBoundary)).toThrow(/parent|boundary/i);

    const missingEndpoint = mutateView((view) => {
      const relationships = view.relationships as { sourceId: string }[];
      relationships[0].sourceId = 'omitted-element';
    });
    expect(() => parsePreviewJson(missingEndpoint)).toThrow(/endpoint/i);
  });

  it('accepts a well-shaped diagnostic result without a partial view', () => {
    const error = { schemaVersion: 1, status: 'error', diagnostics: [{
      code: 'syntax', severity: 'error', message: 'Unexpected token', location: {
        file: 'x.dsl', line: 1, column: 1, endLine: 1, endColumn: 2,
      },
    }] };
    expect(parsePreviewJson(JSON.stringify(error))).toEqual(error);
  });
});
