import test from 'node:test';
import assert from 'node:assert/strict';
import { bookshopSources } from '../src/examples.js';
import { mergeSources } from '../src/merge.js';
import { parseKontur } from '../src/parser.js';
import { toMermaid } from '../src/transform.js';

const [application, platform] = bookshopSources;
const platformExample = [platform, application];

const errors = (model) => model.diagnostics.filter(({ severity }) => severity === 'error');
const diagram = (model, type, stage) =>
  toMermaid(model, { type, stage }, { sourceLabels: model.labels });

test('the two synthetic repositories work individually and combine platform, API, and stage assertions', () => {
  for (const sample of platformExample) {
    assert.deepEqual(errors(parseKontur(sample.code)), []);
    assert.deepEqual(errors(mergeSources([sample])), []);
  }
  const model = mergeSources(platformExample);
  assert.deepEqual(errors(model), []);
  assert.deepEqual(model.conflicts, []);
  const platform = model.nodes.find(({ type }) => type === 'platform');
  assert.equal(platform.responsibilities.filter(({ role }) => role === 'productOwner').length, 2);
  const capability = model.nodes.find(({ identity }) => identity.endsWith('core.messaging'));
  assert.equal(capability.claims.get('name').values().next().value.evidence.length, 2);
  assert.equal(model.assertions.filter(({ kind }) => kind === 'usesCapability').length, 2);
  assert.equal(model.assertions.filter(({ kind }) => kind === 'binding').length, 4);
  assert.ok(model.assertions.every(({ kind }) => kind !== 'derived'));
  assert.ok(model.assertions.some(({ kind }) => kind === 'consumes'));

  const defaultView = diagram(model, 'technicalDependencies');
  assert.match(defaultView.source, /subscribes · orders.cancelled/);
  assert.match(defaultView.source, /publishes · orders.created/);
  assert.match(defaultView.source, /usesCapability · prod: Production/);
  for (const stage of ['dev', 'stage']) {
    const view = diagram(model, 'technicalDependencies', stage);
    assert.match(view.source, new RegExp(`usesCapability · ${stage}: Shared`));
    assert.match(view.source, new RegExp(`usesCapability · ${stage}: nicht spezifiziert`));
    assert.doesNotMatch(view.source, /Production/);
  }

  const capabilityView = diagram(model, 'platformCapabilities');
  assert.match(capabilityView.source, /Application Runtime/);
  assert.match(capabilityView.source, /-\.->\|"abgeleitet über Order Events/);
  assert.ok([...capabilityView.provenance.values()].some(({ derived }) => derived));
  assert.ok([...defaultView.provenance.values()].some(({ stageBindings }) =>
    stageBindings?.some(({ assertion }) => assertion.evidence[0].repo === platformExample[1].repo)));
});

test('identical technical assertions retain evidence and additional environments coexist', () => {
  const [platform, application] = platformExample;
  const replica = { ...application, repo: 'demo/bookshop-ops-replica',
    code: application.code.replace('  bindings {', '  bindings {\n    shop.events@prod uses core.messaging@shared') };
  const model = mergeSources([platform, application, replica]);
  assert.deepEqual(errors(model), []);
  assert.deepEqual(model.conflicts, []);
  assert.equal(model.assertions.filter(({ kind }) => kind === 'usesCapability').length, 2);
  assert.ok(model.assertions.filter(({ kind }) => kind === 'usesCapability').every(({ evidence }) => evidence.length === 2));
  const production = diagram(model, 'technicalDependencies', 'prod');
  assert.match(production.source, /usesCapability · prod: Production, Shared/);
  assert.ok([...production.provenance.values()].some(({ stageBindings }) =>
    stageBindings?.some(({ assertion }) => assertion.evidence.length === 2)));
});

test('binding, topic and capability references enforce their respective types', () => {
  const code = platformExample[1].code;
  for (const [from, to, message] of [
    ['usesCapability core.messaging', 'usesCapability core.shared', /API mit einer Capability/],
    ['@dev uses', '@sandbox uses', /Stage „sandbox“/],
    ['messaging@production', 'messaging@prod', /Platform Environment/],
    ['subscribes shop.events.cancelled', 'subscribes shop.events.unknown', /Unbekanntes Beziehungsziel/],
    ['mode async', 'mode sync', /API-Modus „sync“/],
  ]) {
    assert.ok(errors(parseKontur(code.replace(from, to))).some(({ message: diagnostic }) =>
      message.test(diagnostic)), to);
  }
});

test('cross-source references resolve within a namespace before reconciliation', () => {
  const [platform, application] = platformExample;
  const appWithoutPlatform = { ...application,
    code: application.code.replace(/    platform core[\s\S]*?\n    }\n/, '') };
  assert.ok(errors(parseKontur(appWithoutPlatform.code)).length);
  assert.deepEqual(errors(mergeSources([platform, appWithoutPlatform])), []);
});
