import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relativeSource = 'fixtures/large.arch';
const lines = [];
const elements = [];
const relationships = [];

function source() {
  const line = lines.length;
  return { file: relativeSource, line, column: 1, endLine: line, endColumn: lines.at(-1).length + 1 };
}

function addElement(element, line) {
  lines.push(line);
  elements.push({ ...element, source: source() });
}

function addRelationship(id, sourceId, targetId, label, line) {
  lines.push(line);
  relationships.push({ id, sourceId, targetId, label, source: source() });
}

addElement({ id: 'person-ops', kind: 'person', name: 'Operations analyst', description: 'Follows order and payment health.' }, 'person person-ops "Operations analyst"');
const systems = [
  { id: 'commerce', name: 'Commerce platform' },
  { id: 'payments', name: 'Payments platform' },
];
const containersBySystem = new Map();

for (const [systemIndex, system] of systems.entries()) {
  addElement({ id: system.id, kind: 'system', name: system.name, description: `${system.name} architecture boundary.` }, `system ${system.id} "${system.name}"`);
  const containers = [];
  for (let index = 1; index <= 49; index++) {
    const id = `${system.id}-service-${String(index).padStart(2, '0')}`;
    const database = index === 49;
    addElement({
      id,
      kind: database ? 'database' : 'container',
      name: database ? `${system.name} ledger database` : `${system.name} service ${index}`,
      description: database ? 'Persists the platform ledger and audit trail.' : `Handles ${system.name.toLowerCase()} workflow ${index}.`,
      technology: database ? 'PostgreSQL' : (index % 2 ? 'Rust · HTTP/JSON' : 'TypeScript · events'),
      parentId: system.id,
    }, `${database ? 'database' : 'container'} ${id} "${database ? 'Ledger database' : `Service ${index}`}" in ${system.id}`);
    containers.push(id);
  }
  containersBySystem.set(system.id, containers);
  if (systemIndex === 0) addRelationship('ops-commerce', 'person-ops', containers[0], 'Checks platform health and order exceptions', 'rel person-ops ' + containers[0] + ' "Checks platform health and order exceptions"');
  for (let index = 0; index < containers.length - 1; index++) {
    addRelationship(`${system.id}-flow-${index + 1}`, containers[index], containers[index + 1], `Passes workflow ${index + 1} state`, `rel ${containers[index]} ${containers[index + 1]} "Passes workflow ${index + 1} state"`);
    if (index > 0 && index % 12 === 0) {
      addRelationship(`${system.id}-parallel-${index}`, containers[index - 1], containers[index + 1], 'Publishes an independent audit event', `rel ${containers[index - 1]} ${containers[index + 1]} "Publishes an independent audit event"`);
    }
  }
}

const commerce = containersBySystem.get('commerce');
const payments = containersBySystem.get('payments');
addRelationship('commerce-to-payments', commerce[20], payments[0], 'Requests payment authorization across the platform boundary', `rel ${commerce[20]} ${payments[0]} "Requests payment authorization across the platform boundary"`);
addRelationship('payments-to-commerce', payments[5], commerce[30], 'Publishes the final provider settlement status', `rel ${payments[5]} ${commerce[30]} "Publishes the final provider settlement status"`);
lines.push('# simulated addition source');
const mutationSource = source();

const fixture = {
  id: 'large',
  title: 'Generated architecture — 101 elements',
  sourceFile: relativeSource,
  mutationSource,
  elements,
  relationships,
};

await writeFile(path.join(root, 'fixtures/large.json'), `${JSON.stringify(fixture, null, 2)}\n`);
await writeFile(path.join(root, relativeSource), `${lines.join('\n')}\n`);
console.log(`Wrote ${elements.length} elements and ${relationships.length} relationships.`);
