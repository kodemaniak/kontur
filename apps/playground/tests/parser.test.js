import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bookshopSources, standaloneExamples } from '../src/examples.js';
import { parseKontur, responsibilityRoles } from '../src/parser.js';
import { toMermaid } from '../src/transform.js';

test('all synthetic examples compile into a model with multiple projections', () => {
  for (const example of [bookshopSources[0], ...standaloneExamples]) {
    const model = parseKontur(example.code);
    assert.deepEqual(model.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), [], example.id);
    assert.ok(model.nodes.length >= 5, example.id);
    assert.ok(model.relations.length >= 2, example.id);
    assert.ok(model.views.length >= 2, example.id);
    for (const view of model.views) {
      const transformed = toMermaid(model, view);
      assert.match(transformed.source, /^flowchart (LR|RL|TB|BT)/);
      assert.ok(transformed.source.includes('classDef api'));
    }
  }
});

test('operation-level usage is parsed as part of a typed consumes relation', () => {
  const model = parseKontur(bookshopSources[0].code);
  const relation = model.relations.find((rel) => rel.source === 'web' && rel.kind === 'consumes');
  assert.deepEqual(relation?.operations, ['listOrders', 'createOrder']);
  const api = model.nodes.find((node) => node.id === 'ordersApi');
  assert.equal(api.meta.contract.format, 'openapi');
});

test('validates target identity and type', () => {
  const model = parseKontur(`workspace "Broken" {
    model {
      one = system "A"
      other = system "B"
      one consumes other
      other dependsOn missing
    }
  }`);
  assert.equal(model.diagnostics.filter((entry) => entry.severity === 'error').length, 2);
});

test('detects syntax errors with line coordinates', () => {
  const model = parseKontur('workspace "Broken" {\n  model {\n    x = system "X"\n  }');
  assert.equal(model.diagnostics[0].severity, 'error');
  assert.ok(model.diagnostics[0].line >= 4);
});

test('organization references must point to teams or people', () => {
  const model = parseKontur(`workspace "Owners" {
    model {
      wrong = system "Wrong"
      app = system "App" {
        owner wrong
      }
    }
  }`);
  assert.ok(model.diagnostics.some((d) => d.message.includes('Team oder eine Person')));
});

test('does not interpolate or execute DSL content', () => {
  const model = parseKontur('workspace "Demo" { model { example = system "<script>alert(1)</script>" } }');
  assert.equal(model.nodes[0].name, '<script>alert(1)</script>');
  const source = toMermaid(model, model.views[0]).source;
  assert.ok(!source.includes('<script>'));
});

test('event APIs retain produced and consumed topics and validate selected topics', () => {
  const example = standaloneExamples.find((entry) => entry.id === 'events');
  const model = parseKontur(example.code);
  const api = model.nodes.find((node) => node.id === 'observations');
  assert.deepEqual(api.meta.topics.produces, ['weather.observations', 'weather.station-status']);
  assert.deepEqual(api.meta.topics.consumes, ['weather.calibration']);
  const view = model.views.find((entry) => entry.type === 'apis');
  assert.match(toMermaid(model, view).source, /consumes: weather\.calibration/);
  const invalid = parseKontur(example.code.replace('topics "weather.calibration"', 'topics "missing.topic"'));
  assert.ok(invalid.diagnostics.some((entry) => entry.message.includes('missing.topic')));
});

test('existing models can still declare teams in a workspace organization block', () => {
  const model = parseKontur('workspace { organization { ops = team "Ops" } model { app = system "App" { owner ops } } }');
  assert.deepEqual(model.diagnostics, []);
  assert.match(toMermaid(model, { type: 'ownership' }).source, /n_ops -.->\|"owner"\| n_app/);
});


test('direct and block roles follow the types in the integrated reference', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const reference = html.split('<h3>Verantwortlichkeiten und Quellen</h3>')[1].split('</div>')[0];
  for (const [role, targetType] of Object.entries(responsibilityRoles)) {
    assert.ok(reference.includes(`<code>${role}</code>`), role);
    const valid = targetType === 'person' ? 'ida' : 'ops';
    const invalid = targetType === 'person' ? 'ops' : 'ida';
    const parse = (declaration) => parseKontur(`model bookshop {
      organization utility "Harbor Books"
      team ops "Betrieb"
      person ida "Ida Ufer"
      system app "Bookshop" { ${declaration} }
    }`);
    assert.deepEqual(parse(`${role} ${valid} responsibilities { ${role} ${valid} }`).diagnostics, []);
    assert.equal(parse(`${role} ${invalid}`).diagnostics[0].severity, 'error');
    assert.equal(parse(`responsibilities { ${role} ${invalid} }`).diagnostics[0].severity, 'error');
  }
  for (const snippet of reference.matchAll(/^        <code>(.*)<\/code>$/gm)) {
    const model = parseKontur(`workspace { model { anna = person "Anna Berger" ben = person "Ben Hoffmann" clara = person "Clara Nguyen"
      commerce = team "Commerce" app = system "Bookshop" { ${snippet[1]} } } }`);
    assert.deepEqual(model.diagnostics, [], snippet[1]);
  }
});
