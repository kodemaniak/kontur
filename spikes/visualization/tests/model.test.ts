import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import small from '../fixtures/small.json';
import large from '../fixtures/large.json';
import { mutateFixture, validateFixture, type ArchitectureFixture } from '../webview/src/model';
import { buildElkGraph, getAbsolutePosition, isCurrentLayoutRevision, mapElkEdges, mapElkNodes, preserveNodeGeometry } from '../webview/src/layout';
import { resolveRevealTarget } from '../extension/src/protocol';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smallFixture = small as unknown as ArchitectureFixture;
const largeFixture = large as unknown as ArchitectureFixture;

async function validate(fixture: ArchitectureFixture): Promise<string[]> {
  const source = await readFile(path.join(root, fixture.sourceFile), 'utf8');
  return validateFixture(fixture, new Map([[fixture.sourceFile, source]])).map((issue) => `${issue.path}: ${issue.message}`);
}

describe('architecture fixtures', () => {
  it('has valid element IDs, edges and source ranges in the representative fixture', async () => {
    expect(await validate(smallFixture)).toEqual([]);
  });

  it('has a deterministic 101-element stress fixture with valid source mappings', async () => {
    expect(large.elements).toHaveLength(101);
    expect(await validate(largeFixture)).toEqual([]);
  });

  it('replays rename, add and remove deterministically with valid source and endpoints', async () => {
    const renamed = mutateFixture(smallFixture, 'rename');
    expect(renamed.elements.find((element) => element.id === 'order-api')?.id).toBe('order-api');

    const added = mutateFixture(renamed, 'add');
    expect(added.elements.find((element) => element.id === 'notification-service')?.source.line).toBe(17);
    expect(mutateFixture(added, 'add')).toEqual(added);
    expect(await validate(added)).toEqual([]);

    const removed = mutateFixture(added, 'remove');
    expect(removed.elements.some((element) => element.id === 'notification-service')).toBe(false);
    expect(removed.relationships.every((relationship) => removed.elements.some((element) => element.id === relationship.sourceId) && removed.elements.some((element) => element.id === relationship.targetId))).toBe(true);
    expect(mutateFixture(mutateFixture(mutateFixture(smallFixture, 'rename'), 'add'), 'remove')).toEqual(removed);
    const largeAdded = mutateFixture(largeFixture, 'add');
    expect(await validate(largeAdded)).toEqual([]);
    expect(largeAdded.elements.find((element) => element.id === 'notification-service')?.parentId).toBe('commerce');
    expect(largeAdded.elements.find((element) => element.id === 'notification-service')?.source).toEqual(largeFixture.mutationSource);
  });

  it('maps hierarchical ELK geometry, sections, labels and source identities to React Flow', async () => {
    const sizes = new Map(smallFixture.elements.map((element) => [element.id, { width: 220, height: element.kind === 'system' ? 0 : 96 }]));
    const graph = await new ELK().layout(buildElkGraph(smallFixture, sizes));
    const nodes = mapElkNodes(graph, smallFixture);
    const edges = mapElkEdges(graph, smallFixture);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    expect(nodes.map((node) => node.id).sort()).toEqual(smallFixture.elements.map((element) => element.id).sort());
    for (const element of smallFixture.elements) {
      expect(nodeById.get(element.id)?.data.element.source).toEqual(element.source);
    }
    for (const child of nodes.filter((node) => node.parentId)) {
      const parent = nodeById.get(child.parentId!)!;
      expect(child.position.x).toBeGreaterThanOrEqual(0);
      expect(child.position.y).toBeGreaterThanOrEqual(0);
      expect(child.position.x + Number(child.style?.width)).toBeLessThanOrEqual(Number(parent.style?.width));
      expect(child.position.y + Number(child.style?.height)).toBeLessThanOrEqual(Number(parent.style?.height));
      const absolute = getAbsolutePosition(child.id, nodes)!;
      expect(absolute.x).toBeCloseTo(child.position.x + parent.position.x);
      expect(absolute.y).toBeCloseTo(child.position.y + parent.position.y);
    }
    expect(edges).toHaveLength(smallFixture.relationships.length);
    expect(edges.every((edge) => (edge.data?.sections?.length ?? 0) > 0)).toBe(true);
    expect(edges.every((edge) => edge.data?.label && Number.isFinite(edge.data.label.x) && Number.isFinite(edge.data.label.y))).toBe(true);
    expect(edges.map((edge) => edge.id).sort()).toEqual(smallFixture.relationships.map((relationship) => relationship.id).sort());
  });

  it('keeps all stress-fixture children within their rendered system boundaries', async () => {
    const sizes = new Map(largeFixture.elements.map((element) => [element.id, { width: 220, height: element.kind === 'system' ? 0 : 76 }]));
    const graph = await new ELK().layout(buildElkGraph(largeFixture, sizes));
    const nodes = mapElkNodes(graph, largeFixture);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    for (const child of nodes.filter((node) => node.parentId)) {
      const parent = nodeById.get(child.parentId!)!;
      expect(child.position.x, child.id).toBeGreaterThanOrEqual(0);
      expect(child.position.y, child.id).toBeGreaterThanOrEqual(0);
      expect(child.position.x + Number(child.style?.width), child.id).toBeLessThanOrEqual(Number(parent.style?.width));
      expect(child.position.y + Number(child.style?.height), child.id).toBeLessThanOrEqual(Number(parent.style?.height));
    }
  });

  it('keeps geometry and selection while refreshing renamed model data', () => {
    const orderApi = smallFixture.elements.find((element) => element.id === 'order-api')!;
    const otherElement = smallFixture.elements.find((element) => element.id !== 'order-api')!;
    const nodes = [{
      id: 'order-api', type: 'c4' as const, position: { x: 42, y: 17 }, selected: true,
      data: { element: orderApi },
    }, {
      id: otherElement.id, type: 'c4' as const, position: { x: 10, y: 12 }, data: { element: otherElement },
    }];
    const renamed = mutateFixture(smallFixture, 'rename');
    const updated = preserveNodeGeometry(nodes, renamed);
    expect(updated[0].position).toEqual({ x: 42, y: 17 });
    expect(updated[0].selected).toBe(true);
    expect(updated[0].data.element.name).toBe('Order API');
    expect(updated[1]).toBe(nodes[1]);
  });

  it('discards an obsolete layout that finishes after the current one', async () => {
    let activeRevision = 0;
    const obsoleteRevision = ++activeRevision;
    const currentRevision = ++activeRevision;
    const applied: string[] = [];
    let finishObsolete!: (value: string) => void;
    let finishCurrent!: (value: string) => void;
    const obsolete = new Promise<string>((resolve) => { finishObsolete = resolve; }).then((value) => {
      if (isCurrentLayoutRevision(obsoleteRevision, activeRevision)) applied.push(value);
    });
    const current = new Promise<string>((resolve) => { finishCurrent = resolve; }).then((value) => {
      if (isCurrentLayoutRevision(currentRevision, activeRevision)) applied.push(value);
    });

    finishCurrent('current');
    await current;
    finishObsolete('obsolete');
    await obsolete;
    expect(applied).toEqual(['current']);
  });

  it('rejects malformed and unknown reveal messages before opening a source', () => {
    const targets = new Map([['order-api', { file: 'fixtures/small.arch', line: 4 }]]);
    expect(resolveRevealTarget({ type: 'reveal-source', id: 'order-api' }, targets)?.[0]).toBe('order-api');
    expect(resolveRevealTarget({ type: 'reveal-source', id: '../README.md' }, targets)).toBeUndefined();
    expect(resolveRevealTarget({ type: 'reveal-source', id: 42 }, targets)).toBeUndefined();
    expect(resolveRevealTarget({ type: 'execute-command', id: 'order-api' }, targets)).toBeUndefined();
    expect(resolveRevealTarget(null, targets)).toBeUndefined();
  });
});
