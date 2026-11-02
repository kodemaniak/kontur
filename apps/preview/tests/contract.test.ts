import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parsePreviewJson, type PreviewResult } from '../src/contract';
import { parsePreviewResponse } from '../src/serviceContract';

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
    expect(actual.view.elements).toHaveLength(7);
    expect(actual.view.boundaries).toHaveLength(3);
    expect(actual.view.relationships).toHaveLength(9);
    expect(actual.view.elements.filter((element) => element.kind === 'container' && element.tags.includes('Database'))).toHaveLength(2);
  });

  it('accepts the actual Rust preview-service envelope and preserves identities and source locations', () => {
    const dslPath = resolve(root, 'examples/orders-payments/workspace.dsl');
    const documentUri = pathToFileURL(dslPath).toString();
    const request = { schemaVersion: 1, revision: 17, documentUri, text: readFileSync(dslPath, 'utf8') };
    const output = execFileSync('cargo', [
      'run', '--locked', '--quiet', '-p', 'kontur-cli', '--', 'preview-service',
    ], { cwd: root, encoding: 'utf8', input: `${JSON.stringify(request)}\n` });
    const response = parsePreviewResponse(output, { revision: request.revision, documentUri });

    expect(response.revision).toBe(17);
    expect(response.documentUri).toBe(documentUri);
    expect(response.result.status).toBe('ok');
    if (response.result.status !== 'ok' || actual.status !== 'ok') throw new Error('expected a successful view');
    expect(response.result.view.elements.map(({ id }) => id)).toEqual(actual.view.elements.map(({ id }) => id));
    expect(response.result.view.relationships.map(({ id }) => id)).toEqual(actual.view.relationships.map(({ id }) => id));
    expect(response.result.view.relationships[0].source?.file).toBe(documentUri);
    expect(response.result.view.relationships[0].source?.line).toBe(26);
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

  it('accepts a correlated service response and rejects a mismatched revision', () => {
    const expected = { revision: 7, documentUri: 'file:///workspace.dsl' };
    const response = { schemaVersion: 1, ...expected, result: actual };
    expect(parsePreviewResponse(JSON.stringify(response), expected)).toEqual(response);
    expect(() => parsePreviewResponse(
      JSON.stringify({ ...response, revision: 8 }), expected,
    )).toThrow(/revision|correlat/i);
  });

  it('rejects a service response for a different document URI', () => {
    const expected = { revision: 7, documentUri: 'file:///workspace.dsl' };
    const response = { schemaVersion: 1, ...expected, result: actual };
    expect(() => parsePreviewResponse(
      JSON.stringify({ ...response, documentUri: 'file:///other.dsl' }), expected,
    )).toThrow(/URI|document|correlat/i);
  });

  it('rejects a corrupted nested preview result', () => {
    const expected = { revision: 7, documentUri: 'file:///workspace.dsl' };
    const response = { schemaVersion: 1, ...expected, result: actual };
    expect(() => parsePreviewResponse(
      JSON.stringify({ ...response, result: { schemaVersion: 1, status: 'ok', view: {} } }), expected,
    )).toThrow(/result|view|shape/i);
  });
});
