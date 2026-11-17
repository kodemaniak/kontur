import { parseKontur, resolveReferences, isSystem, validateModel } from './parser.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const sourceLabel = ({ repo, revision }, index) => {
  const name = repo.trim() || `Quelle ${index + 1}`;
  return revision.trim() ? `${name} @ ${revision.trim()}` : name;
};

function recordClaim(claims, key, value, evidence) {
  if (!claims.has(key)) claims.set(key, new Map());
  const variants = claims.get(key);
  const signature = JSON.stringify(value);
  if (!variants.has(signature)) variants.set(signature, { ...value, evidence: [] });
  const claim = variants.get(signature);
  if (!claim.evidence.some((entry) => same(entry, evidence))) claim.evidence.push(evidence);
}

export function formatEvidence({ label, file, line, column, origin }) {
  const location = file ? ` / ${file}${line ? `:${line}:${column}` : ''}` : '';
  return `${label}${location}${origin ? ` · ${origin}` : ''}`;
}

export function mergeSources(sources) {
  const models = sources.map(({ code }) => parseKontur(code, { validate: false }));
  const namespaces = new Map();
  for (const model of models) {
    if (!namespaces.has(model.namespace)) namespaces.set(model.namespace, { nodes: [], relations: [] });
    const group = namespaces.get(model.namespace);
    group.nodes.push(...model.nodes);
    group.relations.push(...model.relations);
  }
  for (const group of namespaces.values()) resolveReferences(group);
  const labels = sources.map(sourceLabel);
  const diagnostics = models.flatMap((model, sourceIndex) =>
    model.diagnostics.map((entry) => ({ ...entry, sourceIndex })));
  const nodes = new Map();
  const relationshipClaims = new Map();
  const identities = new Map();
  const views = [];
  const conflicts = [];

  for (const [sourceIndex, model] of models.entries()) {
    const qualify = (id) => {
      if (!id) return null;
      const key = JSON.stringify([model.namespace, id]);
      if (!identities.has(key)) identities.set(key, `element_${identities.size + 1}`);
      return identities.get(key);
    };
    const { repo, revision, file } = sources[sourceIndex];
    const evidence = (origin, { line, column }) => ({
      sourceIndex, repo, revision, file: file?.trim() || 'model.kontur',
      label: labels[sourceIndex], origin, line, column,
    });
    for (const node of model.nodes) {
      const id = qualify(node.id);
      const parent = qualify(node.parent);
      const identity = model.namespace ? `${model.namespace}/${node.id}` : node.id;
      if (!nodes.has(id)) {
        nodes.set(id, { ...node, id, parent, identity, sourceIndex, meta: {}, claims: new Map() });
      }
      const merged = nodes.get(id);
      const compatibleTypes = merged.type === node.type || (isSystem(merged) && isSystem(node));
      if (!compatibleTypes || merged.parent !== parent) {
        diagnostics.push({ ...node, sourceIndex, severity: 'error',
          message: `Element „${identity}“ hat einen anderen Typ oder Parent als in „${labels[merged.sourceIndex]}“.` });
        continue;
      }
      if (node.type === 'platform') merged.type = node.type;
      for (const stage of node.stages ?? []) {
        recordClaim(merged.claims, 'stages', { value: stage.value }, evidence(null, stage));
      }
      for (const field of ['name', 'kind', ...Object.keys(node.meta)]) {
        let value = field === 'name' || field === 'kind' ? node[field] : node.meta[field];
        if (field === 'topics') value = Object.fromEntries(Object.entries(value).map(([direction, names]) =>
          [direction, [...new Set(names)].sort()]));
        if (value !== null) recordClaim(merged.claims, field, { value }, evidence(null, node));
      }
      for (const { role, target, origin, ...location } of node.responsibilities) {
        recordClaim(relationshipClaims, 'responsibilities',
          { source: id, role, target: qualify(target) }, evidence(origin, location));
      }
    }
    for (const { origin, line, column, ...relation } of model.relations) {
      const value = { ...relation, source: qualify(relation.source), target: qualify(relation.target) };
      if (value.kind === 'binding') value.environment = qualify(value.environment);
      for (const field of ['operations', 'topics']) value[field] = [...new Set(value[field])].sort();
      recordClaim(relationshipClaims, 'relations', value, evidence(origin, { line, column }));
    }
    for (const view of model.views) {
      views.push({ ...view, scope: qualify(view.scope), environment: qualify(view.environment), name: sources.length > 1 ? `${view.name} (${labels[sourceIndex]})` : view.name, sourceIndex });
    }
  }

  const assertions = [];
  const relations = [];
  const rolesByElement = new Map();
  for (const [category, claims] of relationshipClaims) {
    for (const claim of claims.values()) {
      const { evidence } = claim;
      const assertion = {
        ...claim, category, sourceIndex: evidence[0].sourceIndex,
        line: evidence[0].line, column: evidence[0].column,
        origin: [...new Set(evidence.map(({ origin }) => origin).filter(Boolean))].join(', '),
        confirmed: new Set(evidence.map(({ repo, sourceIndex }) => repo.trim() || sourceIndex)).size > 1,
      };
      assertions.push(assertion);
      if (category === 'relations') {
        relations.push(assertion);
      } else {
        const subject = nodes.get(assertion.source);
        if (!rolesByElement.has(subject.id)) rolesByElement.set(subject.id, new Map());
        const roles = rolesByElement.get(subject.id);
        if (!roles.has(assertion.role)) roles.set(assertion.role, []);
        roles.get(assertion.role).push(assertion);
      }
    }
  }

  const complementaryRelations = new Map();
  for (const rel of relations) {
    if (!['usesCapability', 'binding'].includes(rel.kind)) continue;
    const key = JSON.stringify([rel.kind, rel.source, rel.stage]);
    if (!complementaryRelations.has(key)) complementaryRelations.set(key, []);
    complementaryRelations.get(key).push(rel);
  }
  for (const claims of complementaryRelations.values()) {
    for (const claim of claims) claim.complementary = claims.length > 1;
  }

  for (const node of nodes.values()) {
    const groups = [...(rolesByElement.get(node.id)?.values() ?? [])];
    node.responsibilities = groups.flatMap((group) => {
      for (const assertion of group) assertion.complementary = group.length > 1;
      return group;
    });
    for (const [field, variants] of node.claims) {
      const entries = [...variants.values()];
      if (entries.length > 1 && !['topics', 'stages'].includes(field)) conflicts.push({
        identity: node.identity, field,
        variants: entries.map(({ value, evidence }) => ({
          value: typeof value === 'string' ? value : JSON.stringify(value),
          sources: [...new Set(evidence.map(formatEvidence))].join(', '),
        })),
      });
      if (field === 'stages') node.stages = entries;
      else if (field === 'topics') {
        node.meta.topics = Object.fromEntries(['produces', 'consumes'].map((direction) =>
          [direction, [...new Set(entries.flatMap(({ value }) => value[direction]))]]));
      } else if (field === 'kind') node.kind = entries[0].value;
      else if (field !== 'name') node.meta[field] = entries[0].value;
    }
  }
  if (sources.length > 1 || (!views.some(({ type }) => type === 'ownership') && rolesByElement.size)) {
    views.unshift({ type: 'ownership', name: sources.length > 1 ? 'Gemeinsame Zuständigkeiten' : 'Zuständigkeiten', direction: 'LR', scope: null });
  }
  const model = { nodes: [...nodes.values()], views, diagnostics, conflicts, labels, assertions, relations };
  validateModel(model);
  const readableIds = new Map([...identities].map(([key, id]) => [id, JSON.parse(key).filter(Boolean).join('/')]));
  for (const entry of diagnostics) {
    entry.message = entry.message.replace(/„(element_\d+)“/g, (match, id) =>
      readableIds.has(id) ? `„${readableIds.get(id)}“` : match);
  }
  return model;
}
