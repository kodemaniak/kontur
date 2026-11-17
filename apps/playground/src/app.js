import mermaid from 'mermaid';
import { builtInSources } from './examples.js';
import { isSystem, parseKontur, technicalViews } from './parser.js';
import { formatEvidence, mergeSources } from './merge.js';
import { toMermaid } from './transform.js';

const $ = (selector) => document.querySelector(selector);
const editor = $('#dslEditor');
const lineNumbers = $('#lineNumbers');
const viewSelect = $('#viewSelect');
const canvas = $('#diagramCanvas');
const diagnosticsList = $('#diagnosticsList');
const storageKey = 'kontur-dsl-playground-v1';
const exampleKey = 'kontur-dsl-example-v1';

const mergeKey = 'kontur-dsl-merge-v1';
const workspaceKey = 'kontur-dsl-sources-v2';
const sourceColors = ['#7ebcff', '#67d9b7', '#ffbf78', '#c3a4ff', '#ff9bb3', '#b8dd75', '#80d7e8', '#e1cd87'];
const sourceColor = (index) => sourceColors[index % sourceColors.length];
const blankModel = 'workspace {\n  model {\n  }\n}';

const stageSelect = $('#stageSelect');
let stage = 'prod';

const retiredExamples = new Map([
  ['demo/bookshop', ['fbcad873d3b07f10']],
  ['demo/bpo', ['5aed966e2aeff9ac']],
  ['demo/core-platform', ['74f682921efa45bd']],
  ['demo/core-platform-metering', ['a80f235b23414700']],
  ['demo/architektur', ['617bec5871469a71', '217de94e87e7fb4f']],
  ['demo/betriebskatalog', ['2ff0a2e180914de0', 'bbff0a754da24f5b']],
]);

const previousBookshopApp = 'b2852ff4a2734c1e';

function readDraft(key) {
  try { return JSON.parse(localStorage.getItem(key)); }
  catch { return null; }
}

async function matchesExampleFingerprint(code, fingerprints) {
  if (!fingerprints || !globalThis.crypto?.subtle) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  const fingerprint = Array.from(new Uint8Array(digest, 0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return fingerprints.includes(fingerprint);
}

function matchesRetiredExample(repo, code) {
  return matchesExampleFingerprint(code, retiredExamples.get(repo));
}

async function restoreSource(source) {
  const retired = ['bookshop', 'bpo', 'core-platform', 'core-platform-metering'].includes(source.exampleId)
    || Number.isInteger(source.sampleIndex);
  if (!retired) return { ...source, enabled: source.enabled !== false };

  const originalRepo = Number.isInteger(source.sampleIndex)
    ? ['demo/architektur', 'demo/betriebskatalog'][source.sampleIndex] : `demo/${source.exampleId}`;
  if (source.repo === originalRepo && source.revision === 'main'
    && await matchesRetiredExample(originalRepo, source.code)) return null;

  // Keep edited samples as ordinary sources, separate from the new demo.
  const draft = { ...source, enabled: false };
  delete draft.exampleId;
  delete draft.sampleIndex;
  delete draft.builtInExample;
  return draft;
}

const workspace = readDraft(workspaceKey);
const saved = workspace ?? readDraft(mergeKey);
const restored = saved?.sources?.length && saved.sources.every((item) =>
  ['repo', 'revision', 'code'].every((key) => typeof item?.[key] === 'string'))
  ? await Promise.all(saved.sources.map(restoreSource)) : [];
const sources = restored.filter(Boolean);
let activeSource = Math.max(0, sources.indexOf(restored[saved?.active]));
let editing = false;
let viewKey = sources.length === restored.length ? workspace?.viewKey ?? '' : '';

if (!workspace) {
  const draft = localStorage.getItem(storageKey);
  const exampleId = localStorage.getItem(exampleKey) ?? 'bookshop';
  const example = builtInSources.find(({ id }) => id === exampleId);
  if (draft !== null && draft !== example?.code && !await matchesRetiredExample(`demo/${exampleId}`, draft)) {
    sources.push({ repo: 'lokal/entwurf', revision: '', code: draft, enabled: false });
  }
}

for (const { id, ...sample } of builtInSources) {
  const existing = sources.find((source) => source.exampleId === id && (source.builtInExample || source.repo === sample.repo));
  if (existing) {
    existing.builtInExample = true;
    if (id === 'bookshop-app' && await matchesExampleFingerprint(existing.code, [previousBookshopApp])) {
      existing.code = sample.code;
    }
  } else sources.push({ ...sample, exampleId: id, builtInExample: true });
}
if (!restored[saved?.active]) activeSource = sources.findIndex(({ exampleId }) => exampleId === 'bookshop-app');

let lastTransform = null;
let lastSvg = '';
let renderSequence = 0;
let refreshTimer;
let toastTimer;
let zoom = 1;

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  themeVariables: {
    background: '#0d1b22',
    primaryTextColor: '#eaf4f5',
    lineColor: '#7a9aa4',
    clusterBkg: '#152a32',
    clusterBorder: '#3e6b6b',
    fontFamily: 'DM Sans, Arial, sans-serif',
    fontSize: '13px',
    edgeLabelBackground: '#142730',
  },
  flowchart: {
    useMaxWidth: false,
    htmlLabels: true,
    curve: 'basis',
    nodeSpacing: 40,
    rankSpacing: 65,
    padding: 16,
  },
});

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}

function updateLineNumbers() {
  const count = editor.value.split('\n').length;
  lineNumbers.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
  $('#lineCount').textContent = `${count} lines`;
  lineNumbers.scrollTop = editor.scrollTop;
}

function updateDiagnostics(diagnostics) {
  diagnosticsList.replaceChildren();
  const errors = diagnostics.filter((item) => item.severity === 'error');
  $('#diagnosticCount').textContent = String(diagnostics.length);
  $('#parseDot').classList.toggle('error', errors.length > 0);
  $('#parseStatus').textContent = errors.length
    ? `${errors.length} error${errors.length > 1 ? 's' : ''}`
    : diagnostics.length ? `${diagnostics.length} warning${diagnostics.length > 1 ? 's' : ''}` : 'Valid model';

  $('#diagnosticsPanel').hidden = !editing && !diagnostics.length;
  if (!diagnostics.length) {
    const empty = document.createElement('div');
    empty.className = 'diagnostic-empty';
    empty.textContent = '✓ Keine Probleme gefunden. Modell erfolgreich analysiert.';
    diagnosticsList.append(empty);
    return;
  }
  for (const item of diagnostics) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `diagnostic-item ${item.severity}`;
    const line = document.createElement('em');
    line.textContent = `${item.line}:${item.column}`;
    const desc = document.createElement('span');
    desc.textContent = `${item.severity === 'error' ? '✕' : '⚠'} ${Number.isInteger(item.sourceIndex) ? `${sourceName(item.sourceIndex)} · ` : ''}${item.message}`;
    button.append(line, desc);
    button.addEventListener('click', () => {
      if (Number.isInteger(item.sourceIndex)) setWorkspaceTab(true, item.sourceIndex);
      jumpToLine(item.line);
    });
    diagnosticsList.append(button);
  }
}

function jumpToLine(line) {
  const lines = editor.value.split('\n');
  let offset = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) offset += lines[i].length + 1;
  editor.focus();
  editor.setSelectionRange(offset, offset + (lines[Math.max(0, line - 1)]?.length || 0));
  editor.scrollTop = Math.max(0, line - 4) * 22;
  lineNumbers.scrollTop = editor.scrollTop;
}

function populateViews(views) {
  const groups = new Map();
  viewSelect.replaceChildren();
  for (const [index, view] of views.entries()) {
    const label = { apis: 'APIs', containers: 'Container nach System', deployment: 'Deployment' }[view.type] ?? 'Weitere Sichten';
    if (!groups.has(label)) {
      const group = document.createElement('optgroup');
      group.label = label;
      groups.set(label, group);
      viewSelect.append(group);
    }
    const option = new Option(view.scope && ['apis', 'containers'].includes(view.type)
      ? view.name : `${view.name} · ${view.type}`, index);
    option.dataset.key = view.selectionKey;
    groups.get(label).append(option);
  }
  viewSelect.disabled = !views.length;
  const index = views.findIndex((view) => view.selectionKey === viewKey);
  if (index >= 0) viewSelect.value = String(index);
}

function showPreviewError(title, message) {
  canvas.replaceChildren();
  const el = document.createElement('div');
  el.className = 'error-preview';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const body = document.createElement('div');
  body.textContent = message;
  el.append(heading, body);
  canvas.append(el);
}

function updateZoom() {
  $('#zoomValue').textContent = `${Math.round(zoom * 100)}%`;
  const svg = canvas.querySelector('svg');
  if (svg) {
    svg.style.width = `${Math.round(zoom * 100)}%`;
    svg.style.flexShrink = '0';
  }
}

const sourceDetails = $('#sourceDetails');
const sourceDetailsList = $('#sourceDetailsList');

function evidenceList(labels) {
  return labels.map((label) => {
    const item = document.createElement('li');
    item.textContent = label;
    return item;
  });
}

function assertionStatus({ confirmed, complementary, category }) {
  return [
    confirmed && 'Durch mehrere Repositories bestätigt',
    complementary && (category === 'relations' ? 'Weitere ergänzende Aussagen vorhanden' : 'Mehrere Zuordnungen in dieser Rolle'),
  ].filter(Boolean).join(' · ');
}

function showSourceDetails({ title, labels, assertion, derived, stageBindings = [], responsibilities = [] }) {
  $('#sourceDetailsTitle').textContent = title || 'Quellen';
  const status = $('#sourceDetailsStatus');
  status.textContent = derived ? 'Abgeleitete Beziehung · Quellen der Ausgangsaussagen' : assertion ? assertionStatus(assertion) : '';
  status.hidden = !status.textContent;
  sourceDetailsList.replaceChildren(...evidenceList(labels));
  const list = $('#sourceResponsibilityList');
  list.replaceChildren();
  for (const responsibility of responsibilities) {
    const { role, assignee, evidence } = responsibility;
    const detail = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${role} · ${assignee}`;
    detail.append(summary);
    const description = assertionStatus(responsibility);
    if (description) {
      const state = document.createElement('p');
      state.className = 'assertion-status';
      state.textContent = description;
      detail.append(state);
    }
    const origins = document.createElement('ul');
    origins.append(...evidenceList(evidence.map(formatEvidence)));
    detail.append(origins);
    list.append(detail);
  }
  for (const { environment, assertion: binding } of stageBindings) {
    const detail = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `Binding · ${binding.stage} → ${environment}`;
    const origins = document.createElement('ul');
    origins.append(...evidenceList(binding.evidence.map(formatEvidence)));
    detail.append(summary, origins);
    list.append(detail);
  }
  list.hidden = !list.childElementCount;
  sourceDetails.showModal();
}

$('#closeSourceDetails').addEventListener('click', () => sourceDetails.close());

function enableSourceDetails(element, details) {
  const target = element.closest('g.edgeLabel') ?? element;
  if (target.classList.contains('source-details-target')) return;
  target.classList.add('source-details-target');
  target.setAttribute('tabindex', '0');
  target.setAttribute('role', 'button');
  target.setAttribute('aria-label', details.title ? `Details zu ${details.title}` : 'Quellen anzeigen');
  target.addEventListener('click', (event) => {
    event.stopPropagation();
    showSourceDetails(details);
  });
  target.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    showSourceDetails(details);
  });
}

function annotateSources(svg, provenance, selected) {
  for (const element of svg.querySelectorAll('[data-id], g.node[id], g.cluster[id]')) {
    const nodeKey = element.id.match(/(?:^|-)flowchart-(n_.*)-\d+$/)?.[1];
    const clusterKey = element.id.match(/(?:^|-)([gn]_.*)$/)?.[1];
    const key = element.getAttribute('data-id') ?? nodeKey ?? clusterKey ?? element.id;
    const details = provenance.get(key);
    if (!details) continue;
    const title = document.createElementNS(svg.namespaceURI, 'title');
    title.textContent = `Quellen: ${details.labels.join(' · ')}`;
    element.prepend(title);
    const color = details.sources.length === 1
      ? sourceColor(selected[details.sources[0]]) : '#e4edf0';
    const shape = element.matches('path') ? element
      : element.querySelector(':scope > rect, :scope > circle, :scope > polygon, :scope > path, :scope > g > path, :scope > g > rect, :scope > g > polygon');
    shape?.style.setProperty('stroke', color, 'important');
    enableSourceDetails(element, details);
  }
}

async function renderDiagram(transform, selected) {
  const sequence = ++renderSequence;
  lastSvg = '';
  if (!transform) return;
  canvas.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'loading-message';
  loading.textContent = 'Diagramm wird erzeugt …';
  canvas.append(loading);
  try {
    const result = await mermaid.render(`kontur-svg-${sequence}`, transform.source);
    if (sequence !== renderSequence) return;
    // Mermaid sanitizes its SVG. Only the bundled renderer, never DSL text, sets HTML.
    canvas.innerHTML = result.svg;
    result.bindFunctions?.(canvas);
    const svg = canvas.querySelector('svg');
    annotateSources(svg, transform.provenance, selected);
    lastSvg = new XMLSerializer().serializeToString(svg);
    updateZoom();
  } catch (error) {
    if (sequence !== renderSequence) return;
    lastSvg = '';
    showPreviewError('Mermaid konnte diese Sicht nicht rendern.', error?.message?.slice(0, 450) || 'Unbekannter Rendering-Fehler.');
  }
}

function compile() {
  const selected = sources.flatMap((source, index) => source.enabled ? [index] : []);
  const model = selected.length ? mergeSources(selected.map((index) => sources[index])) : null;
  const currentDiagnostics = (model?.diagnostics ?? []).map((item) => ({
    ...item, sourceIndex: selected[item.sourceIndex ?? 0],
  }));
  const diagnostics = editing && !selected.includes(activeSource)
    ? parseKontur(editor.value, { validate: false }).diagnostics.map((item) => ({ ...item, sourceIndex: activeSource }))
    : currentDiagnostics;
  updateDiagnostics(diagnostics);
  renderMergeReport(model, selected.length);
  if (editing) return;

  const views = (model?.views ?? []).filter(({ type }) => !['apis', 'containers'].includes(type)).map((view) => {
    const sourceIndex = selected.length === 1 ? selected[0] : selected[view.sourceIndex];
    const repoLabel = selected.length > 1 && model.labels?.[view.sourceIndex];
    const name = repoLabel ? view.name.slice(0, -(repoLabel.length + 3)) : view.name;
    const environment = view.environment && model.nodes.find(({ id }) => id === view.environment)?.identity;
    return { ...view, selectionKey: JSON.stringify([sourceIndex, name, view.type, ...(environment ? [environment] : [])]) };
  });
  if (model?.nodes.some(({ type }) => type === 'platform')) {
    for (const [type, name] of [['platformCapabilities', 'Platform Capabilities'], ['technicalDependencies', 'Technical Dependencies']]) {
      if (!views.some((view) => view.type === type && !view.scope)) {
        views.push({ type, name, selectionKey: type });
      }
    }
  }
  for (const [type, elementType] of [['apis', 'api'], ['containers', 'system']]) {
    const elements = (model?.nodes ?? []).filter((node) => elementType === 'system' ? isSystem(node) : node.type === elementType);
    const nameCounts = new Map();
    for (const node of elements) nameCounts.set(node.name, (nameCounts.get(node.name) ?? 0) + 1);
    for (const node of elements.sort((a, b) => a.name.localeCompare(b.name, 'de'))) {
      const identity = node.identity ?? [model.namespace, node.id].filter(Boolean).join('/');
      const name = nameCounts.get(node.name) > 1 ? `${node.name} (${identity})` : node.name;
      const layout = model.views.find((view) => view.type === type && view.scope === node.id)
        ?? model.views.find((view) => view.type === type && !view.scope);
      views.push({ type, name, scope: node.id, direction: layout?.direction, selectionKey: JSON.stringify([type, identity]) });
    }
  }
  if (!views.length && model?.views.length) {
    views.push({ ...model.views[0], selectionKey: '' });
  }
  populateViews(views);
  $('#modelStats').textContent = `${model?.nodes.length ?? 0} Elemente · ${model?.assertions.length ?? 0} Beziehungen`;
  const view = views[Number(viewSelect.value)];
  $('#stageControl').hidden = !technicalViews.includes(view?.type);
  if (!$('#stageControl').hidden) {
    const stages = new Set(['dev', 'stage', 'prod', ...model.nodes.flatMap((node) =>
      (node.stages ?? []).map(({ value }) => value)), stage]);
    stageSelect.replaceChildren(...[...stages].map((value) => new Option(value, value)));
    stageSelect.value = stage;
  }
  const failed = currentDiagnostics.some((item) => item.severity === 'error');
  if (!model || failed) {
    renderSequence++;
    lastTransform = null;
    lastSvg = '';
    $('#mermaidSource').textContent = '';
    if (failed) {
      showPreviewError('DSL-Validierung fehlgeschlagen', 'Wähle eine Meldung unter dem Diagramm, um die Stelle im Editor zu öffnen.');
    } else {
      const message = document.createElement('p');
      message.className = 'empty-preview';
      message.textContent = 'Wähle mindestens eine Quelle aus, um eine Sicht zu öffnen.';
      canvas.replaceChildren(message);
      setTab(false);
    }
    return;
  }
  lastTransform = toMermaid(model, technicalViews.includes(view.type) ? { ...view, stage } : view, { sourceLabels: selected.map(sourceName) });
  $('#mermaidSource').textContent = lastTransform.source;
  renderDiagram(lastTransform, selected);
}

function saveSources() {
  localStorage.setItem(workspaceKey, JSON.stringify({ sources, active: activeSource, viewKey }));
}

function sourceName(index) {
  const { repo, revision } = sources[index];
  return [repo.trim() || `Quelle ${index + 1}`, revision.trim()].filter(Boolean).join(' @ ');
}

function updateSourceCount() {
  $('#sourceCount').textContent = `${sources.filter(({ enabled }) => enabled).length} / ${sources.length} aktiv`;
}

function renderSourceList() {
  $('#sourceList').replaceChildren(...sources.map(({ enabled, repo, revision }, index) => {
    const label = document.createElement('label');
    label.className = 'source-choice';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = enabled;
    checkbox.addEventListener('change', () => {
      sources[index].enabled = checkbox.checked;
      updateSourceCount();
      saveSources();
      compile();
    });
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = repo.trim() || `Quelle ${index + 1}`;
    const swatch = document.createElement('i');
    swatch.className = 'source-swatch';
    swatch.style.backgroundColor = sourceColor(index);
    swatch.setAttribute('aria-hidden', 'true');
    name.prepend(swatch);
    text.append(name);
    if (revision.trim()) {
      const branch = document.createElement('small');
      branch.textContent = revision.trim();
      text.append(branch);
    }
    label.append(checkbox, text);
    return label;
  }));
  updateSourceCount();
}

function renderSourceOptions() {
  const select = $('#sourceSelect');
  select.replaceChildren(...sources.map((_, index) => new Option(sourceName(index), index)));
  select.value = String(activeSource);
  $('#removeSource').disabled = sources.length === 1 || sources[activeSource].builtInExample === true;
}

function selectSource(index) {
  activeSource = index;
  const source = sources[index];
  renderSourceOptions();
  $('#sourceRepo').value = source.repo;
  $('#sourceRevision').value = source.revision;
  $('#sourceFile').value = source.file || '';
  $('#editorSubtitle').textContent = sourceName(index);
  $('#resetButton').hidden = !source.builtInExample;
  editor.value = source.code;
  editor.scrollTop = 0;
  updateLineNumbers();
  saveSources();
}

function renderMergeReport(model, count) {
  $('#mergeReport').hidden = editing || count < 2;
  if (count < 2 || editing) return;
  const confirmed = model.assertions.filter((assertion) => assertion.confirmed).length;
  const complementaryRoles = model.assertions.filter(({ category, complementary }) =>
    category === 'responsibilities' && complementary).length;
  const complementaryTechnical = model.assertions.filter(({ category, complementary }) =>
    category === 'relations' && complementary).length;
  const technicalSummary = complementaryTechnical ? ` · ${complementaryTechnical} ergänzende technische Aussagen` : '';
  $('#mergeSummary').textContent = `${count} Quellen · ${confirmed} mehrfach bestätigte Aussagen · ${complementaryRoles} ergänzende Rollenzuordnungen${technicalSummary} · ${model.conflicts.length} Konflikte`;
  const list = $('#mergeConflicts');
  list.replaceChildren();
  for (const conflict of model.conflicts) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = `${conflict.identity} · ${conflict.field}`;
    const variants = document.createElement('ul');
    for (const { value, sources } of conflict.variants) {
      const variant = document.createElement('li');
      variant.textContent = `${value} (${sources})`;
      variants.append(variant);
    }
    item.append(title, variants);
    list.append(item);
  }
}

function setWorkspaceTab(openEditor, index = activeSource) {
  clearTimeout(refreshTimer);
  editing = openEditor;
  $('#editorMode').setAttribute('aria-pressed', String(editing));
  $('#visualizationMode').setAttribute('aria-pressed', String(!editing));
  $('#editorPanel').hidden = !editing;
  $('#visualizationPanel').hidden = editing;
  if (editing && index !== activeSource) selectSource(index);
  compile();
}

function scheduleCompile() {
  sources[activeSource].code = editor.value;
  saveSources();
  updateLineNumbers();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(compile, 360);
}

function addSource() {
  sources.push({ repo: '', revision: '', code: blankModel, enabled: false });
  renderSourceList();
  setWorkspaceTab(true, sources.length - 1);
  $('#sourceRepo').focus();
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text, successMessage) {
  if (!text) return toast('Noch kein Code vorhanden.');
  try { await navigator.clipboard.writeText(text); toast(successMessage); }
  catch { toast('Zwischenablage nicht verfügbar.'); }
}

function setTab(source) {
  $('#diagramPane').hidden = source;
  $('#sourcePane').hidden = !source;
  $('#diagramTab').classList.toggle('active', !source);
  $('#mermaidTab').classList.toggle('active', source);
  $('#diagramTab').setAttribute('aria-selected', String(!source));
  $('#mermaidTab').setAttribute('aria-selected', String(source));
}

editor.addEventListener('input', scheduleCompile);
editor.addEventListener('scroll', () => { lineNumbers.scrollTop = editor.scrollTop; });
editor.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = editor.selectionStart;
    editor.setRangeText('  ', start, editor.selectionEnd, 'end');
    scheduleCompile();
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    clearTimeout(refreshTimer);
    compile();
    toast('Modell neu kompiliert.');
  }
});

stageSelect.addEventListener('change', () => {
  stage = stageSelect.value;
  compile();
});

viewSelect.addEventListener('change', () => {
  viewKey = viewSelect.selectedOptions[0]?.dataset.key ?? '';
  saveSources();
  compile();
});
$('#visualizationMode').addEventListener('click', () => setWorkspaceTab(false));
$('#editorMode').addEventListener('click', () => setWorkspaceTab(true));
$('#sourceSelect').addEventListener('change', (event) => {
  selectSource(Number(event.target.value));
  compile();
});
for (const [selector, field] of [['#sourceRepo', 'repo'], ['#sourceRevision', 'revision'], ['#sourceFile', 'file']]) {
  $(selector).addEventListener('input', (event) => {
    sources[activeSource][field] = event.target.value;
    renderSourceOptions();
    renderSourceList();
    $('#editorSubtitle').textContent = sourceName(activeSource);
    scheduleCompile();
  });
}
$('#addSource').addEventListener('click', () => addSource());
$('#removeSource').addEventListener('click', () => {
  if (sources.length < 2 || sources[activeSource].builtInExample || !confirm('Dieses Quellmodell entfernen?')) return;
  sources.splice(activeSource, 1);
  viewKey = '';
  selectSource(Math.min(activeSource, sources.length - 1));
  renderSourceList();
  compile();
});
$('#resetButton').addEventListener('click', () => {
  const source = sources[activeSource];
  const example = builtInSources.find(({ id }) => id === source.exampleId);
  if (!example || !confirm('DSL-Text dieser Quelle auf den Beispielstand zurücksetzen?')) return;
  source.code = example.code;
  if (example.file) source.file = example.file;
  selectSource(activeSource);
  compile();
});
$('#downloadDslButton').addEventListener('click', () => download('model.kontur', editor.value, 'text/plain;charset=utf-8'));
$('#copyMermaidButton').addEventListener('click', () => copy(lastTransform?.source, 'Mermaid-Code kopiert.'));
$('#downloadSvgButton').addEventListener('click', () => {
  if (!lastSvg) return toast('Noch kein SVG zum Exportieren vorhanden.');
  download('kontur-diagram.svg', lastSvg, 'image/svg+xml;charset=utf-8');
  toast('SVG heruntergeladen.');
});
$('#diagramTab').addEventListener('click', () => setTab(false));
$('#mermaidTab').addEventListener('click', () => setTab(true));
$('#zoomIn').addEventListener('click', () => { zoom = Math.min(2, Math.round((zoom + .15) * 100) / 100); updateZoom(); });
$('#zoomOut').addEventListener('click', () => { zoom = Math.max(.5, Math.round((zoom - .15) * 100) / 100); updateZoom(); });
$('#zoomFit').addEventListener('click', () => { zoom = 1; updateZoom(); });

const dialog = $('#referenceDialog');
$('#referenceButton').addEventListener('click', () => dialog.showModal());
$('#closeReferenceButton').addEventListener('click', () => dialog.close());
$('#referenceDoneButton').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

renderSourceList();
selectSource(activeSource);
setWorkspaceTab(false);
