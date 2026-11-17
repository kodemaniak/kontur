import assert from 'node:assert/strict';
import test from 'node:test';
import { bookshopSources } from '../src/examples.js';
import { mergeSources } from '../src/merge.js';
import { parseKontur } from '../src/parser.js';
import { toMermaid } from '../src/transform.js';

test('deployment views isolate environments and resolve only their configured stage bindings', () => {
  const model = mergeSources(bookshopSources.filter(({ enabled }) => enabled));
  assert.deepEqual(model.diagnostics, []);
  const views = model.views.filter(({ type }) => type === 'deployment');
  const [production, development] = views.map((view) =>
    toMermaid(model, view, { sourceLabels: model.labels }));

  assert.match(production.source, /subgraph .*EKS Production/);
  assert.match(production.source, /subgraph .*Namespace bookshop/);
  assert.match(production.source, /Ingress Controller/);
  assert.match(production.source, /Speichert Bestellungen/);
  assert.match(production.source, /runsIn/);
  assert.match(production.source, /Core Platform · Production/);
  assert.match(production.source, /publishes · orders.created/);
  assert.match(production.source, /subscribes · orders.created/);
  assert.doesNotMatch(production.source, /Shared|Entwicklungsrechner/);
  assert.match(development.source, /Entwicklungsrechner/);
  assert.match(development.source, /Core Platform · Shared/);
  assert.match(development.source, /usesCapability · dev: nicht spezifiziert/);
  assert.doesNotMatch(development.source, /EKS Production|Fulfillment|Core Platform · Production/);

  const bindingDetails = [...production.provenance.values()].flatMap(({ stageBindings }) => stageBindings ?? []);
  assert.equal(bindingDetails.length, 2);
  assert.ok(bindingDetails.every(({ environment, assertion }) =>
    environment === 'Production' && assertion.evidence[0].file === 'bookshop.kontur'));

  const shop = model.nodes.find(({ identity }) => identity.endsWith('/shop'));
  const scoped = toMermaid(model, { ...views[0], scope: shop.id }).source;
  assert.match(scoped, /Storefront/);
  assert.doesNotMatch(scoped, /Namespace shipping|Fulfillment/);
});

test('deployment declarations can reference systems from another selected repository', () => {
  const source = (repo, code) => ({ repo, code, revision: '', file: 'model.kontur' });
  const topology = source('topology', `workspace {
    namespace "shared"
    model {
      prod = deploymentEnvironment "Production" {
        host = deploymentNode "VM" {
          instance = softwareSystemInstance service
        }
      }
    }
    views { deployment "Production" { environment prod scope service } }
  }`);
  const service = source('service', 'workspace { namespace "shared" model { service = system "Service" } }');
  assert.ok(parseKontur(topology.code).diagnostics.some(({ severity }) => severity === 'error'));
  const model = mergeSources([topology, service]);
  assert.deepEqual(model.diagnostics, []);
  assert.match(toMermaid(model, model.views.find(({ type }) => type === 'deployment')).source, /Service<br\/>Instanz/);
  assert.ok(parseKontur(topology.code.replace('softwareSystemInstance service', 'containerInstance prod.host'))
    .diagnostics.some(({ message }) => message.includes('erwartet eine Referenz auf einen Container')));
});
