/** Transform the parsed architecture into Mermaid flowchart source. */

import { apiRelations, deploymentInstances, isSystem, ownershipRelations, technicalViews } from './parser.js';
import { formatEvidence } from './merge.js';
// Merged models use generated IDs. Escape the whole raw ID when it has DSL punctuation.
const graphId = (value) => /^[a-zA-Z0-9_]+$/.test(value)
  ? value
  : `x-${Array.from(value, (char) => char.charCodeAt(0).toString(16)).join('_')}`;
const id = (value) => `n_${graphId(value)}`;
const groupId = (value) => `g_${graphId(value)}`;
const label = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, ' ');

function ancestors(node, index) {
  const result = [];
  let current = node;
  while (current?.parent) {
    current = index.get(current.parent);
    if (current) result.push(current);
  }
  return result;
}

function rootSystem(node, index) {
  if (!node) return null;
  if (isSystem(node)) return node;
  return ancestors(node, index).find((item) => isSystem(item)) || null;
}

function relationLabel(rel, showKind = false) {
  const human = { dependsOn: 'depends on', '->': 'uses' }[rel.kind] ?? rel.kind;
  const details = showKind && rel.description ? [human, rel.description] : [rel.description || human];
  details.push(...rel.operations, ...rel.topics);
  if (rel.origin) details.push(`Quelle: ${rel.origin}`);
  return details.join(' · ');
}

function nodeDefinition(node, marker) {
  const detail = node.type === 'api'
    ? [node.meta.mode, node.meta.style, node.meta.protocol].filter(Boolean).join(' / ') || 'API'
    : node.meta.technology || (node.kind || node.type).toUpperCase();
  const topicLines = Object.entries(node.meta.topics ?? {})
    .filter(([, topics]) => topics.length)
    .map(([direction, topics]) => `${direction}: ${topics.join(', ')}`);
  const kind = ['platform', 'capability'].includes(node.type) ? node.type.toUpperCase() : null;
  const platform = node.type === 'environment' || node.type === 'capability' ? node.platformName : null;
  const content = [node.name + marker, node.instanceLabel ? `Instanz · ${node.instanceLabel}` : null, platform, kind === detail ? null : kind, detail, ...topicLines].filter(Boolean).map(label).join('<br/>');
  if (node.type === 'api') return `  ${id(node.id)}{{"${content}"}}`;
  if (['team', 'person', 'actor'].includes(node.type)) return `  ${id(node.id)}(["${content}"])`;
  if (isSystem(node)) return `  ${id(node.id)}["${content}"]`;
  if (node.type === 'component') return `  ${id(node.id)}("${content}")`;
  return `  ${id(node.id)}["${content}"]`;
}

function className(node) {
  if (['infrastructureNode', 'containerInstance', 'container'].includes(node.type)) return 'container';
  if (node.type === 'api') return 'api';
  if (node.type === 'component') return 'component';
  if (['organization', 'team', 'person'].includes(node.type)) return 'organization';
  if (node.type === 'actor') return 'actor';
  if (node.type === 'capability') return 'capability';
  return 'system';
}

function uniqueEdges(edges) {
  const unique = new Map();
  for (const edge of edges) {
    const key = JSON.stringify([edge.source, edge.target, edge.kind, edge.label]);
    const existing = unique.get(key);
    if (!existing) unique.set(key, edge);
    else if (edge.evidence?.length) {
      unique.set(key, { ...existing, evidence: [...(existing.evidence ?? []), ...edge.evidence] });
    }
  }
  return [...unique.values()];
}

function landscape(model, index) {
  const visible = new Set(model.nodes.filter((node) => (isSystem(node) || node.type === 'actor')).map((node) => node.id));
  const edges = [];
  const addSystemEdge = (sourceId, targetId, name, kind, evidence) => {
    const s = rootSystem(index.get(sourceId), index) || index.get(sourceId);
    const t = rootSystem(index.get(targetId), index) || index.get(targetId);
    if (s && t && s.id !== t.id && visible.has(s.id) && visible.has(t.id)) edges.push({ source: s.id, target: t.id, kind, label: name, evidence });
  };
  const suppliers = model.relations.filter((rel) => ['provides', 'publishes'].includes(rel.kind));
  const users = model.relations.filter((rel) => ['consumes', 'subscribes'].includes(rel.kind));
  for (const user of users) for (const supplier of suppliers) {
    if (user.target !== supplier.target) continue;
    if (user.topics.length && supplier.topics.length && !user.topics.some((topic) => supplier.topics.includes(topic))) continue;
    const api = index.get(user.target);
    addSystemEdge(user.source, supplier.source, api?.name || 'API', 'derived', [...(user.evidence ?? []), ...(supplier.evidence ?? [])]);
  }
  for (const rel of model.relations.filter((rel) => ['dependsOn', '->'].includes(rel.kind))) {
    addSystemEdge(rel.source, rel.target, rel.description || 'depends on', rel.kind, rel.evidence);
  }
  return { visible, edges: uniqueEdges(edges) };
}

function technicalView(model, view, index) {
  const stage = view.stage ?? 'prod';
  const visible = new Set();
  const edges = [];
  const bindings = new Map();
  const interactions = new Map();
  const key = ({ source, target }) => JSON.stringify([source, target]);
  const declarationEvidence = (node) => [...(node.claims?.get('name')?.values() ?? [])]
    .flatMap(({ evidence }) => evidence);
  const add = (edge) => {
    visible.add(edge.source);
    visible.add(edge.target);
    edges.push(edge);
  };
  for (const rel of model.relations) {
    if (rel.kind === 'binding' && rel.stage === stage) {
      const id = key(rel);
      if (!bindings.has(id)) bindings.set(id, []);
      bindings.get(id).push(rel);
    }
    if (apiRelations.includes(rel.kind)) {
      if (!interactions.has(rel.target)) interactions.set(rel.target, []);
      interactions.get(rel.target).push(rel);
    }
  }
  const inScope = (node) => !view.scope || node?.id === view.scope ||
    ancestors(node, index).some(({ id }) => id === view.scope);
  for (const rel of model.relations) {
    if (rel.kind !== 'usesCapability') continue;
    const api = index.get(rel.source);
    const capability = index.get(rel.target);
    if (api?.type !== 'api' || capability?.type !== 'capability') continue;
    const participants = interactions.get(api.id) ?? [];
    if (!inScope(api) && !inScope(capability) && !participants.some(({ source }) => inScope(index.get(source)))) continue;

    const stageBindings = (bindings.get(key(rel)) ?? []).map((binding) => ({
      assertion: binding,
      environment: index.get(binding.environment)?.name ?? binding.environment,
    }));
    const environments = [...new Set(stageBindings.map(({ environment }) => environment))];
    add({ ...rel, assertion: rel, stageBindings, label: `usesCapability · ${stage}: ${environments.join(', ') || 'nicht spezifiziert'}` });
    for (const interaction of participants) {
      if (view.type === 'technicalDependencies') {
        add({ ...interaction, assertion: interaction, label: relationLabel(interaction, true) });
      } else {
        add({ source: interaction.source, target: capability.id, kind: 'derived',
          label: `abgeleitet über ${api.name}`,
          evidence: [...(interaction.evidence ?? []), ...(rel.evidence ?? [])] });
      }
    }
  }
  for (const node of model.nodes) {
    if (node.type === 'platform' && inScope(node)) visible.add(node.id);
    if (node.type === 'capability' && (visible.has(node.id) || inScope(node)) && index.has(node.parent)) {
      add({ source: node.id, target: node.parent, kind: 'platformMembership',
        label: 'bereitgestellt von', evidence: declarationEvidence(node) });
    }
  }
  return { visible, edges: uniqueEdges(edges) };
}

function deploymentView(model, view, index) {
  const visible = new Set();
  const edges = [];
  const instances = new Map();
  const environmentNodes = new Set(model.nodes.filter((node) =>
    ancestors(node, index).some(({ id }) => id === view.environment)).map(({ id }) => id));
  const reveal = (node) => {
    visible.add(node.id);
    for (const parent of ancestors(node, index)) {
      if (environmentNodes.has(parent.id) || parent.id === view.environment) visible.add(parent.id);
    }
  };
  const add = (source, target, rel, edgeLabel = relationLabel(rel), details = {}) => {
    edges.push({ ...rel, source, target, label: edgeLabel, assertion: rel, ...details });
  };

  const environment = index.get(view.environment);
  if (environment) visible.add(environment.id);
  for (const rel of model.relations) {
    if (rel.kind !== 'instanceOf' || !environmentNodes.has(rel.source)) continue;
    const definition = index.get(rel.target);
    const instance = index.get(rel.source);
    if (!definition || !instance) continue;
    if (view.scope && rootSystem(definition, index)?.id !== view.scope) continue;
    if (!instances.has(definition.id)) instances.set(definition.id, []);
    instances.get(definition.id).push(instance.id);
    const instanceLabel = instance.identity?.split('.').at(-1) ?? instance.id.split('.').at(-1);
    index.set(instance.id, { ...instance, name: definition.name, kind: definition.kind, instanceLabel,
      meta: { ...definition.meta, ...instance.meta } });
    reveal(instance);
  }
  for (const nodeId of environmentNodes) {
    const node = index.get(nodeId);
    if (node.type === 'deploymentNode' && !view.scope) reveal(node);
    if (node.type === 'infrastructureNode' && (!view.scope || visible.has(node.parent))) reveal(node);
  }

  const apiIds = new Set();
  for (const rel of model.relations) {
    if (['->', 'dependsOn'].includes(rel.kind)) {
      const from = instances.get(rel.source) ?? (environmentNodes.has(rel.source) && visible.has(rel.source) ? [rel.source] : []);
      const to = instances.get(rel.target) ?? (environmentNodes.has(rel.target) && visible.has(rel.target) ? [rel.target] : []);
      for (const source of from) for (const target of to) add(source, target, rel);
    }
    if (apiRelations.includes(rel.kind) && index.get(rel.target)?.type === 'api') {
      for (const source of instances.get(rel.source) ?? []) {
        apiIds.add(rel.target);
        visible.add(rel.target);
        add(source, rel.target, rel, relationLabel(rel, true));
      }
    }
    if (rel.kind === 'runsIn' && environmentNodes.has(rel.source) && visible.has(rel.source)) {
      const platformEnvironment = index.get(rel.target);
      if (!platformEnvironment) continue;
      visible.add(platformEnvironment.id);
      add(rel.source, rel.target, rel, 'runsIn');
    }
  }

  for (const rel of model.relations) {
    if (rel.kind !== 'usesCapability' || !apiIds.has(rel.source)) continue;
    const capability = index.get(rel.target);
    if (!capability) continue;
    const bindings = model.relations.filter((binding) => binding.kind === 'binding' &&
      binding.source === rel.source && binding.target === rel.target && binding.stage === view.stage);
    if (!bindings.length) {
      visible.add(capability.id);
      add(rel.source, capability.id, rel, view.stage ? `usesCapability · ${view.stage}: nicht spezifiziert` : 'usesCapability');
    }
    for (const binding of bindings) {
      const platformEnvironment = index.get(binding.environment);
      if (!platformEnvironment) continue;
      const capabilityId = `capability:${capability.id}:${binding.environment}`;
      index.set(capabilityId, { ...capability, id: capabilityId, parent: platformEnvironment.id });
      visible.add(platformEnvironment.id);
      visible.add(capabilityId);
      add(rel.source, capabilityId, rel, `usesCapability · ${view.stage}`, {
        stageBindings: [{ assertion: binding, environment: platformEnvironment.name }],
      });
    }
  }
  return { visible, edges: uniqueEdges(edges) };
}

function selectView(model, view, index) {
  if (view.type === 'deployment') return deploymentView(model, view, index);
  if (technicalViews.includes(view.type)) return technicalView(model, view, index);
  if (view.type === 'landscape') return landscape(model, index);

  const visible = new Set();
  const edges = [];
  const rels = model.relations;
  if (view.type === 'ownership') {
    for (const node of model.nodes) {
      if (['system', 'platform', 'api', 'organization', 'team', 'person', 'businessProcess'].includes(node.type) || node.responsibilities.length) {
        visible.add(node.id);
      }
      for (const assertion of node.responsibilities) {
        const { role, target, origin, evidence } = assertion;
        visible.add(target);
        edges.push({ source: target, target: node.id, kind: 'ownership', evidence, assertion, label: origin && !evidence ? `${role} · Quelle: ${origin}` : role });
      }
    }
    for (const rel of rels) {
      if (!ownershipRelations.includes(rel.kind)) continue;
      visible.add(rel.source);
      visible.add(rel.target);
      edges.push({ source: rel.source, target: rel.target, kind: rel.kind, evidence: rel.evidence, label: relationLabel(rel) });
    }
    return { visible, edges };
  }

  if (view.type === 'apis') {
    for (const node of model.nodes) {
      if (node.type === 'api' && (!view.scope || node.id === view.scope)) visible.add(node.id);
    }
    for (const rel of rels) {
      if (visible.has(rel.target) && index.get(rel.target)?.type === 'api' &&
          ['provides', 'consumes', 'publishes', 'subscribes'].includes(rel.kind)) {
        visible.add(rel.source);
        visible.add(rel.target);
      }
    }
  } else if (view.type === 'components') {
    for (const node of model.nodes.filter((n) => n.type === 'component')) visible.add(node.id);
    for (const rel of rels) {
      if (visible.has(rel.source) || visible.has(rel.target)) {
        visible.add(rel.source);
        visible.add(rel.target);
      }
    }
    if (!visible.size) for (const node of model.nodes.filter((n) => n.type === 'container')) visible.add(node.id);
  } else {
    // Container view includes contracts, making actual API relationships inspectable.
    for (const node of model.nodes.filter((n) => ['container', 'api'].includes(n.type))) visible.add(node.id);
    if (view.scope) {
      const scoped = new Set([...visible].filter((nodeId) => {
        const node = index.get(nodeId);
        return node?.id === view.scope || ancestors(node, index).some((parent) => parent.id === view.scope);
      }));
      scoped.add(view.scope);
      const scopeMembers = new Set(scoped);
      for (const rel of rels) {
        if (scopeMembers.has(rel.source) || scopeMembers.has(rel.target)) {
          scoped.add(rel.source);
          scoped.add(rel.target);
        }
      }
      // An API appearing in the scoped model should show its other participants.
      for (const rel of rels) if (scoped.has(rel.target) && index.get(rel.target)?.type === 'api') scoped.add(rel.source);
      visible.clear();
      for (const nodeId of scoped) visible.add(nodeId);
    }
  }

  // Parent containers/systems become visible as boundaries of included children.
  for (const nodeId of [...visible]) {
    const node = index.get(nodeId);
    for (const parent of ancestors(node, index)) visible.add(parent.id);
  }
  for (const rel of rels) {
    if (!['binding', 'usesCapability', 'instanceOf', 'runsIn'].includes(rel.kind) && visible.has(rel.source) && visible.has(rel.target)) {
      edges.push({ source: rel.source, target: rel.target, kind: rel.kind, evidence: rel.evidence, label: relationLabel(rel) });
    }
  }
  return { visible, edges: uniqueEdges(edges) };
}

export function toMermaid(model, view, { sourceLabels = [] } = {}) {
  const index = new Map(model.nodes.map((node) => [node.id, node]));
  const selection = selectView(model, view, index);
  const visibleNodes = [...index.values()].filter((node) => selection.visible.has(node.id));
  const lines = [
    `flowchart ${view.direction || 'LR'}`,
    '  %% Generated locally in the browser from an experimental Kontur DSL subset',
  ];
  const nested = !['deployment', 'landscape', 'ownership', ...technicalViews].includes(view.type);
  const emitted = new Set();
  const provenance = new Map();
  const mark = (key, evidence, details = {}) => {
    if (!sourceLabels.length) return '';
    const entries = evidence?.length ? evidence : [{ sourceIndex: 0, label: sourceLabels[0] }];
    const labels = [...new Set(entries.map(formatEvidence))];
    if (!labels.length) return '';
    provenance.set(key, { ...details, labels, sources: [...new Set(entries.map(({ sourceIndex }) => sourceIndex))] });
    return ' ⓘ';
  };
  const nodeMark = (key, node) => mark(key, node.claims && [...node.claims.values()]
    .flatMap((variants) => [...variants.values()].flatMap(({ evidence }) => evidence)), {
    title: node.name,
    responsibilities: node.responsibilities.map((assertion) => ({
      ...assertion, assignee: index.get(assertion.target)?.name ?? assertion.target,
    })),
  });
  const defineNode = (node) => {
    const platform = node.type === 'environment' ? index.get(node.parent) : null;
    return nodeDefinition({ ...node, platformName: platform?.name }, nodeMark(id(node.id), node));
  };


  if (view.type === 'deployment') {
    const parentOf = (node) => node.type === 'capability' && index.get(node.parent)?.type !== 'environment'
      ? null : node.parent;
    const groups = new Map();
    for (const node of visibleNodes) {
      const parent = parentOf(node);
      if (!selection.visible.has(parent)) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(node);
    }
    const emit = (node) => {
      if (emitted.has(node.id)) return;
      emitted.add(node.id);
      const children = groups.get(node.id);
      if (!children?.length) {
        lines.push(defineNode(node));
        return;
      }
      const platform = node.type === 'environment' && index.get(node.parent);
      const name = [platform?.name, node.name, node.meta.technology].filter(Boolean).join(' · ');
      lines.push(`  subgraph ${id(node.id)}["${label(name + nodeMark(id(node.id), node))}"]`);
      for (const child of children) emit(child);
      lines.push('  end');
    };
    for (const node of visibleNodes) if (!selection.visible.has(parentOf(node))) emit(node);
  }
  if (nested) {
    for (const system of visibleNodes.filter(isSystem)) {
      const children = visibleNodes.filter((node) => node.id !== system.id && rootSystem(node, index)?.id === system.id);
      if (!children.length) continue;
      lines.push(`  subgraph ${groupId(system.id)}["${label(system.name + nodeMark(groupId(system.id), system))}"]`);
      lines.push('    direction TB');
      // Explicit system node only when a relationship uses the system itself.
      const hasOwnEdge = selection.edges.some((edge) => edge.source === system.id || edge.target === system.id);
      if (hasOwnEdge) { lines.push('  ' + defineNode(system)); emitted.add(system.id); }
      for (const child of children) {
        lines.push('  ' + defineNode(child));
        emitted.add(child.id);
      }
      lines.push('  end');
    }
  }
  for (const node of visibleNodes) {
    if (emitted.has(node.id)) continue;
    if (nested && isSystem(node) && !selection.edges.some((edge) => edge.source === node.id || edge.target === node.id)) {
      // Empty scopes still receive a node.
      if (visibleNodes.some((child) => rootSystem(child, index)?.id === node.id && child.id !== node.id)) continue;
    }
    lines.push(defineNode(node));
  }

  for (const [edgeIndex, edge] of selection.edges.entries()) {
    if (!selection.visible.has(edge.source) || !selection.visible.has(edge.target)) continue;
    const arrow = (['dependsOn', 'ownership'].includes(edge.kind) || (edge.kind === 'derived' && technicalViews.includes(view.type))) ? '-.->' : '-->';
    const key = `edge_${edgeIndex}`;
    const assertion = edge.assertion;
    const title = assertion?.role
      ? `${index.get(edge.target)?.name} · ${assertion.role} · ${index.get(edge.source)?.name}`
      : edge.label;
    const marker = mark(key, edge.evidence, {
      title, assertion, derived: edge.kind === 'derived', stageBindings: edge.stageBindings,
    });
    const operator = marker ? `${key}@${arrow}` : arrow;
    lines.push(`  ${id(edge.source)} ${operator}|"${label(edge.label + marker)}"| ${id(edge.target)}`);
  }
  lines.push('  classDef system fill:#203851,stroke:#6c9cc7,color:#eef6ff,stroke-width:1.3px');
  lines.push('  classDef container fill:#1b3240,stroke:#52758b,color:#e8f6fb,stroke-width:1.3px');
  lines.push('  classDef component fill:#293049,stroke:#8575d8,color:#f2edff,stroke-width:1.2px');
  lines.push('  classDef api fill:#143b38,stroke:#3dd4b4,color:#e0fff8,stroke-width:1.8px');
  lines.push('  classDef organization fill:#423522,stroke:#e2b76f,color:#fff4d9,stroke-width:1.3px');
  lines.push('  classDef capability fill:#392c48,stroke:#c7a1e8,color:#faefff,stroke-width:1.3px');
  lines.push('  classDef actor fill:#30334c,stroke:#aab0e7,color:#f2f1ff,stroke-width:1.3px');
  for (const node of visibleNodes) {
    if (!emitted.has(node.id) && nested && isSystem(node) && visibleNodes.some((child) => rootSystem(child, index)?.id === node.id && child.id !== node.id) && !selection.edges.some((edge) => edge.source === node.id || edge.target === node.id)) continue;
    lines.push(`  class ${id(node.id)} ${className(node)}`);
  }

  return {
    source: lines.join('\n'),
    nodeCount: visibleNodes.length,
    edgeCount: selection.edges.length,
    view,
    provenance,
  };
}
