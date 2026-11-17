import test from 'node:test';
import assert from 'node:assert/strict';
import { bookshopSources } from '../src/examples.js';
import { parseKontur } from '../src/parser.js';
import { mergeSources } from '../src/merge.js';
import { toMermaid } from '../src/transform.js';

const [application, , operations] = bookshopSources;
const mergeExample = [application, operations];

test('business owners complement each other within and across repositories', () => {
  const owners = (model) => {
    const shops = model.nodes.filter(({ identity }) => identity === 'demo.harbor-books/shop');
    assert.equal(shops.length, 1);
    const [system] = shops;
    assert.deepEqual(model.diagnostics, []);
    assert.deepEqual(model.conflicts, []);
    return system.responsibilities.filter(({ role }) => role === 'businessOwner')
      .map(({ target }) => model.nodes.find(({ id }) => id === target).name);
  };
  assert.deepEqual(owners(mergeSources(mergeExample.slice(0, 1))), ['Anna Berger', 'Ben Hoffmann']);
  assert.deepEqual(owners(mergeSources(mergeExample)), ['Anna Berger', 'Ben Hoffmann', 'Mara Düne']);
});

test('shared assertions render once with all evidence and missing claims do not remove roles', () => {
  const model = mergeSources(mergeExample);
  const technicalOwners = model.assertions.filter(({ role }) => role === 'technicalOwner');
  assert.equal(technicalOwners.length, 1);
  const [shared] = technicalOwners;
  assert.equal(shared.confirmed, true);
  assert.equal(shared.complementary, false);
  assert.deepEqual(shared.evidence.map(({ repo, file }) => [repo, file]), [
    ['demo/bookshop', 'bookshop.kontur'], ['demo/bookshop-operations', 'operations.kontur'],
  ]);
  assert.ok(shared.evidence.every(({ line, column }) => line > 0 && column > 0));
  assert.equal(model.assertions.filter(({ role }) => role === 'businessTeam').length, 1);
  const diagram = toMermaid(model, model.views.find(({ type }) => type === 'ownership'), { sourceLabels: model.labels });
  assert.equal(diagram.source.match(/"technicalOwner ⓘ"/g).length, 1);
  const edge = [...diagram.provenance.values()].find(({ assertion }) => assertion === shared);
  assert.equal(edge.labels.length, 2);
  for (const [sample, origin] of [[application, 'Architekturmodell'], [operations, 'Betriebskatalog']]) {
    const single = parseKontur(sample.code);
    const view = single.views.find(({ type }) => type === 'ownership');
    assert.ok(toMermaid(single, view).source.includes(`owner · Quelle: ${origin}`));
  }
  assert.match(diagram.source, /partOf · Quelle: Organigramm/);
  assert.match(diagram.source, /operatedBy · Quelle: Betriebsvertrag/);
});

test('identical repeats from one repository retain distinct locations', () => {
  const model = mergeSources([{ repo: 'demo/architektur', revision: '', code:
    'model bookshop { person ida "Anna Berger" system app "App" { businessOwner ida; businessOwner ida } }' }]);
  assert.deepEqual(model.diagnostics, []);
  assert.equal(model.assertions.length, 1);
  const [assertion] = model.assertions;
  assert.equal(assertion.confirmed, false);
  assert.equal(assertion.evidence.length, 2);
  assert.notEqual(assertion.evidence[0].column, assertion.evidence[1].column);
});

test('invalid shared role targets are reported at each source and are not conflicts', () => {
  const code = 'model bookshop { team ops "Ops" system app "App" { technicalOwner ops } }';
  const model = mergeSources([{ repo: 'a', revision: '', code }, { repo: 'b', revision: '', code }]);
  assert.deepEqual(model.conflicts, []);
  assert.deepEqual(model.diagnostics.map(({ sourceIndex }) => sourceIndex), [0, 1]);
  assert.ok(model.diagnostics.every(({ message }) => message.includes('person')));
});

test('conflicting scalar claims retain both values while event topics are additive', () => {
  const sources = ['one', 'two'].map((name) => ({ repo: name, revision: '', code:
    `workspace { model { events = api "Events" { protocol ${name} contract asyncapi "events.yaml" produces ${name} } } }` }));
  const model = mergeSources(sources);
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(model.conflicts.map(({ field }) => field), ['protocol']);
  assert.deepEqual(model.conflicts[0].variants.map(({ value }) => value), ['one', 'two']);
  assert.deepEqual(model.nodes[0].meta.topics.produces, ['one', 'two']);
});

test('different namespaces keep equal local identifiers separate', () => {
  const source = (namespace) => ({ repo: namespace, revision: '', code:
    `workspace { namespace ${namespace} model { app = system "App" } }` });
  const model = mergeSources([source('one'), source('two')]);
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(model.nodes.map(({ identity }) => identity), ['one/app', 'two/app']);
});

test('cross-model diagnostics identify their source and reject structural conflicts', () => {
  const sources = [
    { repo: 'architecture', revision: '', code: 'workspace { model { app = system "App" } }' },
    { repo: 'operations', revision: '', code: 'workspace { model { app = organization "App"; app -> missing } }' },
  ];
  const model = mergeSources(sources);
  assert.equal(model.diagnostics.length, 2);
  assert.ok(model.diagnostics.every(({ sourceIndex }) => sourceIndex === 1));
  assert.match(model.diagnostics[0].message, /anderen Typ/);
  assert.match(model.diagnostics[1].message, /„missing“/);
});

test('the Bookshop inventory adds one visible conflict when selected', () => {
  const defaults = bookshopSources.filter(({ enabled }) => enabled);
  assert.deepEqual(mergeSources(defaults).conflicts, []);
  const model = mergeSources(bookshopSources);
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(model.conflicts.map(({ field }) => field), ['technology']);
  const [conflict] = model.conflicts;
  assert.deepEqual(conflict.variants.map(({ value }) => value), ['React', 'Vue']);
});
