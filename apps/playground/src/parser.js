/**
 * Tiny, deliberately explicit Kontur DSL experiment. No eval and no server calls.
 * The grammar is an exploration tool, not the eventual Rust grammar.
 */

const organizationTypes = ['organization', 'team', 'person'];
export const ownershipRelations = ['partOf', 'developedBy', 'operatedBy', 'providedBy', 'customer', 'basedOn', 'supportedBy'];
export const isSystem = (node) => ['system', 'platform'].includes(node?.type);
export const technicalViews = ['platformCapabilities', 'technicalDependencies'];
export const apiRelations = ['provides', 'consumes', 'publishes', 'subscribes'];
export const deploymentInstances = ['softwareSystemInstance', 'containerInstance'];
const deploymentTypes = ['deploymentEnvironment', 'deploymentNode', 'infrastructureNode', ...deploymentInstances];
const scopedTypes = new Set(['api', 'capability', 'environment', 'topic', ...deploymentTypes]);
const elementTypes = new Set(['system', 'platform', 'capability', 'environment', 'topic', 'container', 'service', 'datastore', 'component', 'api', 'actor', 'businessProcess', ...organizationTypes, ...deploymentTypes]);
const relationshipTypes = new Set(['provides', 'consumes', 'publishes', 'subscribes', 'dependsOn', 'usesCapability', 'runsIn', '->', ...ownershipRelations]);
export const responsibilityRoles = Object.freeze({
  productOwner: 'person', businessOwner: 'person', technicalOwner: 'person', architect: 'person',
  businessTeam: 'team', technicalTeam: 'team',
});
const isTypedRole = (role) => Object.hasOwn(responsibilityRoles, role);
const propertyNames = new Set([ 'description', 'technology', 'protocol', 'style', 'interaction', 'lifecycle', 'contract', 'external', 'kind', 'url', 'email']);

class ParseFailure extends Error {
  constructor(message, token) {
    super(message);
    this.line = token.line;
    this.column = token.column;
  }
}

function lex(source) {
  const tokens = [];
  let pos = 0;
  let line = 1;
  let column = 1;
  const advance = () => {
    const char = source[pos++];
    if (char === '\n') { line++; column = 1; } else { column++; }
    return char;
  };

  while (pos < source.length) {
    const char = source[pos];
    if (/\s/.test(char)) { advance(); continue; }
    if (char === '#' || (char === '/' && source[pos + 1] === '/')) {
      while (pos < source.length && source[pos] !== '\n') advance();
      continue;
    }
    if (char === '/' && source[pos + 1] === '*') {
      const start = { line, column };
      advance(); advance();
      while (pos < source.length && !(source[pos] === '*' && source[pos + 1] === '/')) advance();
      if (pos >= source.length) throw new ParseFailure('Nicht abgeschlossener Kommentar.', start);
      advance(); advance();
      continue;
    }
    const start = { line, column };
    if (char === '"' || char === "'") {
      const quote = advance();
      let value = '';
      let closed = false;
      while (pos < source.length) {
        const c = advance();
        if (c === quote) { closed = true; break; }
        if (c === '\\' && pos < source.length) {
          const next = advance();
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        } else value += c;
      }
      if (!closed) throw new ParseFailure('Nicht abgeschlossener String.', start);
      tokens.push({ kind: 'string', value, ...start });
      continue;
    }
    if (char === '-' && source[pos + 1] === '>') {
      advance(); advance();
      tokens.push({ kind: 'symbol', value: '->', ...start });
      continue;
    }
    if ('{}=,;*.@'.includes(char)) {
      tokens.push({ kind: 'symbol', value: advance(), ...start });
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      let value = '';
      while (pos < source.length && /[a-zA-Z0-9_-]/.test(source[pos])) value += advance();
      tokens.push({ kind: 'id', value, ...start });
      continue;
    }
    throw new ParseFailure(`Unerwartetes Zeichen „${char}“.`, start);
  }
  tokens.push({ kind: 'eof', value: '<EOF>', line, column });
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
    this.nodes = [];
    this.relations = [];
    this.views = [];
    this.diagnostics = [];
    this.ids = new Map();
  }
  get current() { return this.tokens[this.index]; }
  get next() { return this.tokens[this.index + 1] || this.current; }
  is(value) { return this.current.kind !== 'string' && this.current.value === value; }
  take() { return this.tokens[this.index++]; }
  match(value) { if (this.is(value)) { this.take(); return true; } return false; }
  expect(value) {
    if (!this.match(value)) throw new ParseFailure(`„${value}“ erwartet, gefunden: „${this.current.value}“.`, this.current);
  }
  text(label = 'Bezeichner oder String') {
    if (!['id', 'string'].includes(this.current.kind)) throw new ParseFailure(`${label} erwartet.`, this.current);
    return this.take().value;
  }
  identifier(label = 'Bezeichner') {
    if (this.current.kind !== 'id') throw new ParseFailure(`${label} erwartet.`, this.current);
    return this.take();
  }
  reference() {
    let value = this.identifier('Elementreferenz').value;
    while (this.match('.')) value += '.' + this.identifier('Teil der Elementreferenz').value;
    return value;
  }
  parseBindings() {
    this.untilClose(() => {
      const { line, column } = this.current;
      const source = this.reference();
      this.expect('@');
      const stage = this.identifier('Application Stage').value;
      this.expect('uses');
      const target = this.reference();
      this.expect('@');
      const environment = this.identifier('Platform Environment').value;
      const origin = this.match('source') ? this.text('Quellenangabe') : null;
      this.relations.push({ source, target, kind: 'binding', stage, environment, origin,
        description: null, operations: [], topics: [], line, column });
    });
  }
  diagnostic(message, token, severity = 'error') {
    this.diagnostics.push({ severity, message, line: token.line, column: token.column, sourceIndex: token.sourceIndex });
  }
  untilClose(callback) {
    this.expect('{');
    while (!this.is('}') && this.current.kind !== 'eof') {
      if (this.match(';')) continue;
      callback();
    }
    this.expect('}');
  }
  addNode(node, token) {
    if (this.ids.has(node.id)) {
      this.diagnostic(`Der Bezeichner „${node.id}“ ist mehrfach definiert.`, token);
    } else this.ids.set(node.id, node);
    this.nodes.push(node);
  }
  parse({ validate = true } = {}) {
    if (this.match('model')) {
      const namespace = this.identifier('Namespace').value;
      this.untilClose(() => this.parseModelStatement(null));
      return this.finish({ name: namespace, namespace }, validate);
    }
    this.expect('workspace');
    const name = this.is('{') ? 'Kontur workspace' : this.text('Workspace-Name');
    const header = { name, namespace: '' };
    this.untilClose(() => {
      if (this.match('namespace')) header.namespace = this.text('Namespace');
      else if (this.match('organization')) this.parseOrganization();
      else if (this.match('model')) this.untilClose(() => this.parseModelStatement(null));
      else if (this.match('bindings')) this.parseBindings();
      else if (this.match('views')) this.untilClose(() => this.parseView());
      else throw new ParseFailure('Erwartet: namespace, organization, model, bindings oder views.', this.current);
    });
    return this.finish(header, validate);
  }
  finish(header, validate) {
    if (this.current.kind !== 'eof') throw new ParseFailure('Unerwarteter Inhalt hinter dem Modell.', this.current);
    if (!this.views.length) this.views.push({ type: 'containers', name: 'Architecture', direction: 'LR', scope: null });
    if (validate) {
      const model = { nodes: this.nodes, relations: this.relations };
      resolveReferences(model);
      this.validate();
    }
    return { ...header, nodes: this.nodes, relations: this.relations, views: this.views, diagnostics: this.diagnostics };
  }
  parseOrganization() {
    this.untilClose(() => {
      const idToken = this.identifier();
      this.expect('=');
      const typeToken = this.identifier('team oder person');
      if (!['team', 'person'].includes(typeToken.value)) throw new ParseFailure('Hier sind nur team und person erlaubt.', typeToken);
      const name = this.text('Name');
      const node = { id: idToken.value, type: typeToken.value, kind: null, name, parent: null, meta: {}, responsibilities: [], line: idToken.line, column: idToken.column };
      this.addNode(node, idToken);
      if (this.is('{')) this.untilClose(() => {
        const key = this.identifier('Eigenschaft').value;
        if (!['description', 'email', 'url'].includes(key)) throw new ParseFailure(`Unbekannte Eigenschaft „${key}“.`, this.current);
        node.meta[key] = this.text('Wert');
      });
    });
  }
  parseModelStatement(parent) {
    if (!parent && this.is('bindings') && this.next.value === '{') {
      this.take();
      this.parseBindings();
      return;
    }
    let token = this.identifier('Element oder Beziehungsquelle');
    const typeFirst = elementTypes.has(token.value) && this.current.kind === 'id' && !relationshipTypes.has(this.current.value);
    if (typeFirst || this.match('=')) {
      const typeToken = typeFirst ? token : this.identifier('Elementtyp');
      if (typeFirst) token = this.identifier('Element-ID');
      if (!elementTypes.has(typeToken.value)) throw new ParseFailure(`Unbekannter Elementtyp „${typeToken.value}“.`, typeToken);
      const type = ['service', 'datastore'].includes(typeToken.value) ? 'container' : typeToken.value;
      const kind = ['service', 'datastore'].includes(typeToken.value) ? typeToken.value : null;
      const localId = token.value;
      const id = parent && scopedTypes.has(type) ? parent.id + '.' + localId : localId;
      const instance = deploymentInstances.includes(type);
      const name = instance ? this.reference() : this.text('Elementname');
      const node = { id, type, kind, name, parent: parent?.id ?? null, meta: {}, responsibilities: [], line: token.line, column: token.column };
      this.addNode(node, token);
      if (instance) {
        this.relations.push({ source: id, target: name, kind: 'instanceOf', description: null,
          origin: null, operations: [], topics: [], line: token.line, column: token.column });
      }
      const acceptable = parent === null
        ? ['system', 'platform', 'api', 'actor', 'businessProcess', 'deploymentEnvironment', ...organizationTypes]
        : { system: ['container', 'api'], platform: ['container', 'api', 'capability', 'environment'],
          container: ['component'], api: ['topic'], deploymentEnvironment: ['deploymentNode'],
          deploymentNode: ['deploymentNode', 'infrastructureNode', ...deploymentInstances] }[parent.type] ?? [];
      if (!acceptable.includes(type)) this.diagnostic(`„${typeToken.value}“ ist an dieser Stelle nicht erlaubt (C4-Hierarchie).`, typeToken);
      if (this.is('{')) this.untilClose(() => this.parseElementStatement(node));
      return;
    }
    let source = token.value;
    while (this.match('.')) source += '.' + this.identifier('Teil der Beziehungsquelle').value;
    if (!relationshipTypes.has(this.current.value)) throw new ParseFailure('„=“ oder eine Beziehung (provides, consumes, dependsOn, …) erwartet.', this.current);
    const kind = this.take().value;
    const target = this.reference();
    const rel = { source, target, kind, description: null, origin: null, operations: [], topics: [], scope: isSystem(parent) ? parent.id : null, line: token.line, column: token.column };
    if (this.current.kind === 'string') rel.description = this.take().value;
    if (this.is('{')) this.untilClose(() => {
      if (this.match('operations')) this.parseList(rel.operations, 'Operation-ID');
      else if (this.match('topics')) this.parseList(rel.topics, 'Topic');
      else if (this.match('source')) rel.origin = this.text('Quellenangabe');
      else throw new ParseFailure('Erwartet: operations, topics oder source.', this.current);
    });
    this.relations.push(rel);
  }
  parseList(items, label) {
    items.push(this.text(label));
    while (this.match(',')) items.push(this.text(label));
  }
  parseResponsibility(node, role) {
    const who = this.identifier('Team oder Person');
    const origin = this.match('source') ? this.text('Quellenangabe') : null;
    node.responsibilities.push({ role, target: who.value, origin, line: who.line, column: who.column });
  }
  parseElementStatement(node) {
    if (node.type === 'api' && this.is('usesCapability') && this.next.value !== '=') {
      const { line, column } = this.take();
      const target = this.reference();
      const origin = this.match('source') ? this.text('Quellenangabe') : null;
      this.relations.push({ source: node.id, target, kind: 'usesCapability', origin,
        description: null, operations: [], topics: [], line, column });
      return;
    }
    if (isSystem(node) && this.is('stages') && this.next.value !== '=') {
      const { line, column } = this.take();
      const stages = node.stages ??= [];
      do {
        const { value } = this.identifier('Application Stage');
        stages.push({ value, line, column });
      } while (this.match(','));
      return;
    }
    if (node.type === 'api' && this.is('mode') && this.next.value !== '=') {
      this.take();
      const mode = this.identifier('sync oder async');
      if (!['sync', 'async'].includes(mode.value)) throw new ParseFailure('mode erwartet sync oder async.', mode);
      node.meta.mode = mode.value;
      return;
    }
    if ((this.is('owner') || (this.current.kind === 'id' && isTypedRole(this.current.value))) && this.next.value !== '=') {
      this.parseResponsibility(node, this.take().value);
      return;
    }
    if (node.type === 'api' && (this.is('produces') || this.is('consumes')) && (this.next.kind === 'string' || (this.next.kind === 'id' && !relationshipTypes.has(this.next.value)))) {
      const direction = this.take().value;
      node.meta.topics ??= { produces: [], consumes: [] };
      this.parseList(node.meta.topics[direction], 'Topic');
      return;
    }
    if (this.match('responsibilities')) {
      this.untilClose(() => {
        const role = this.identifier('Verantwortlichkeitsrolle').value;
        this.parseResponsibility(node, role);
      });
      return;
    }
    if (propertyNames.has(this.current.value)) {
      const key = this.take().value;
      if (key === 'contract') node.meta.contract = { format: this.text('Vertragsformat'), path: this.text('Vertragspfad') };
      else if (key === 'external') {
        const token = this.current;
        const value = this.text('true oder false');
        if (!['true', 'false'].includes(value)) throw new ParseFailure('external erwartet true oder false.', token);
        node.meta.external = value === 'true';
      }
      else if (key === 'kind') node.kind = this.text('Container-Typ');
      else node.meta[key] = this.text('Wert');
      return;
    }
    this.parseModelStatement(node);
  }
  parseView() {
    const token = this.identifier('View-Typ');
    const normalized = { systemLandscape: 'landscape', container: 'containers', api: 'apis' }[token.value] || token.value;
    if (!['landscape', 'containers', 'apis', 'ownership', 'components', 'deployment', ...technicalViews].includes(normalized)) throw new ParseFailure(`Unbekannte Sicht „${token.value}“.`, token);
    const view = { line: token.line, column: token.column, type: normalized, name: this.is('{') ? normalized : this.text('View-Name'), direction: 'LR', scope: null };
    if (this.is('{')) this.untilClose(() => {
      const key = this.identifier('View-Eigenschaft').value;
      if (key === 'scope') view.scope = this.reference();
      else if (view.type === 'deployment' && key === 'environment') view.environment = this.reference();
      else if (view.type === 'deployment' && key === 'stage') view.stage = this.identifier('Application Stage').value;
      else if (['autoLayout', 'layout'].includes(key)) {
        const direction = this.text('Layout-Richtung').toUpperCase();
        if (!['LR', 'RL', 'TB', 'BT'].includes(direction)) throw new ParseFailure('Layout muss lr, rl, tb oder bt sein.', this.current);
        view.direction = direction;
      } else if (key === 'include') {
        if (!this.match('*')) throw new ParseFailure('Der Playground unterstützt vorerst nur „include *“.', this.current);
      } else if (key === 'title') view.name = this.text('Titel');
      else throw new ParseFailure(`View-Eigenschaft „${key}“ wird noch nicht unterstützt.`, this.current);
    });
    this.views.push(view);
  }
  validate() {
    for (const node of this.nodes) {
      for (const { role, target, ...location } of node.responsibilities.flatMap(expandEvidence)) {
        const who = this.ids.get(target);
        if (!who) this.diagnostic(`Unbekannte Person bzw. unbekanntes Team „${target}“ für Rolle „${role}“.`, location);
        else if (isTypedRole(role)) {
          const expected = responsibilityRoles[role];
          if (who.type !== expected) this.diagnostic(`„${role}“ erwartet ${expected === 'person' ? 'eine Person (person)' : 'ein Team (team)'} als Ziel.`, location);
        } else if (!['team', 'person'].includes(who.type)) {
          this.diagnostic(`„${role}“ muss ein Team oder eine Person referenzieren.`, location);
        }
      }
      if (node.type === 'api' && !node.meta.contract) this.diagnostic(`API „${node.id}“ hat keinen contract.`, node, 'warning');
    }
    const namedTopics = new Map();
    for (const node of this.nodes) {
      if (node.type !== 'topic') continue;
      if (!namedTopics.has(node.parent)) namedTopics.set(node.parent, []);
      namedTopics.get(node.parent).push(node.name);
      if (this.ids.get(node.parent)?.meta.mode === 'sync') {
        this.diagnostic('topic ist für synchrone APIs nicht zulässig.', node);
      }
    }
    const dependencies = new Set(this.relations.filter(({ kind }) => kind === 'usesCapability')
      .map(({ source, target }) => JSON.stringify([source, target])));
    for (const rel of this.relations.flatMap(expandEvidence)) {
      const source = this.ids.get(rel.source);
      const target = this.ids.get(rel.target);
      if (!source) this.diagnostic(`Unbekannte Beziehungsquelle „${rel.source}“.`, rel);
      if (!target) this.diagnostic(`Unbekanntes Beziehungsziel „${rel.target}“.`, rel);
      if (!source || !target) continue;
      if (rel.kind === 'instanceOf' &&
          (source.type === 'containerInstance' ? target.type !== 'container' : !isSystem(target))) {
        this.diagnostic(`„${source.type}“ erwartet eine Referenz auf ${source.type === 'containerInstance' ? 'einen Container oder Service' : 'ein System oder eine Plattform'}.`, rel);
      }
      if (rel.kind === 'runsIn' && (source.type !== 'deploymentNode' || target.type !== 'environment')) {
        this.diagnostic('runsIn verbindet einen Deployment Node mit einer Platform Environment.', rel);
      }
      if (rel.kind === 'usesCapability' && (source.type !== 'api' || target.type !== 'capability')) {
        this.diagnostic('usesCapability verbindet eine API mit einer Capability.', rel);
      }
      if (rel.kind === 'binding') {
        const system = this.ids.get(source.parent);
        const platform = this.ids.get(target.parent);
        if (source.type !== 'api' || target.type !== 'capability') {
          this.diagnostic('Ein Binding verbindet eine API mit einer Capability.', rel);
          continue;
        }
        if (!isSystem(system) || !system.stages?.some(({ value }) => value === rel.stage)) {
          this.diagnostic(`Stage „${rel.stage}“ ist für das System der API nicht deklariert.`, rel);
        }
        if (platform?.type !== 'platform' || this.ids.get(rel.environment)?.type !== 'environment' ||
            this.ids.get(rel.environment)?.parent !== platform.id) {
          this.diagnostic('Die Platform Environment ist auf der Plattform dieser Capability nicht deklariert.', rel);
        }
        if (!dependencies.has(JSON.stringify([rel.source, rel.target]))) {
          this.diagnostic('Ein Binding benötigt eine entsprechende usesCapability-Beziehung.', rel);
        }
      }
      if (apiRelations.includes(rel.kind)) {
        if (target.type !== 'api') this.diagnostic(`„${rel.kind}“ erwartet eine API als Ziel.`, rel);
        if (!isSystem(source) && !['container', 'component'].includes(source.type)) this.diagnostic(`„${rel.kind}“ erwartet System, Container oder Component als Quelle.`, rel);
      }
      if (target.type === 'api' && apiRelations.includes(rel.kind) && target.meta.mode &&
          (['publishes', 'subscribes'].includes(rel.kind) !== (target.meta.mode === 'async'))) {
        this.diagnostic(`„${rel.kind}“ ist für API-Modus „${target.meta.mode}“ nicht zulässig.`, rel);
      }
      if (rel.kind === 'dependsOn' && [...organizationTypes, 'actor', 'businessProcess'].includes(target.type)) this.diagnostic('dependsOn erwartet ein technisches Zielelement.', rel);
      if (rel.kind === 'partOf' && (!organizationTypes.includes(source.type) || !['organization', 'team'].includes(target.type))) {
        this.diagnostic('partOf verbindet Organisation, Team oder Person mit einer Organisation oder einem Team.', rel);
      }
      if (['developedBy', 'operatedBy', 'providedBy', 'customer'].includes(rel.kind) && !organizationTypes.includes(target.type)) {
        this.diagnostic(`„${rel.kind}“ erwartet eine Organisation, ein Team oder eine Person als Ziel.`, rel);
      }
      if (rel.topics.length) {
        if (!['publishes', 'subscribes'].includes(rel.kind)) {
          this.diagnostic('topics sind nur bei publishes und subscribes zulässig.', rel);
        } else if (target.type === 'api') {
          const declared = new Set([...Object.values(target.meta.topics ?? {}).flat(), ...(namedTopics.get(target.id) ?? [])]);
          for (const topic of new Set(rel.topics)) {
            if (!declared.has(topic)) this.diagnostic(`Topic „${topic}“ ist in API „${target.id}“ nicht deklariert.`, rel);
          }
        }
      }
      if (rel.operations.length && rel.kind !== 'consumes') this.diagnostic('operations sind nur bei consumes zulässig.', rel);
    }
    for (const view of this.views) {
      if (view.type === 'deployment') {
        if (this.ids.get(view.environment)?.type !== 'deploymentEnvironment') {
          this.diagnostic('Eine Deployment-Sicht benötigt eine deklarierte Deployment Environment (environment).', view);
        }
        if (view.scope && !isSystem(this.ids.get(view.scope))) {
          this.diagnostic('Der Scope einer Deployment-Sicht muss ein System oder eine Plattform sein.', view);
        }
      } else if (view.scope && !this.ids.has(view.scope)) this.diagnostic(`Unbekannter View-Scope „${view.scope}“.`, view);
    }
  }
}

// Resolve against all selected sources before reconciling assertions.
export function resolveReferences(model) {
  const ids = new Map(model.nodes.map((node) => [node.id, node]));
  for (const rel of model.relations) {
    const { scope } = rel;
    delete rel.scope;
    const localTarget = scope && scope + '.' + rel.target;
    if (ids.has(localTarget)) rel.target = localTarget;
    if (['publishes', 'subscribes'].includes(rel.kind)) {
      const topic = ids.get(rel.target);
      if (topic?.type === 'topic') {
        rel.target = topic.parent;
        rel.topics.push(topic.name);
      }
    }
    if (rel.kind === 'binding') rel.environment = rel.target.split('.').slice(0, -1).concat(rel.environment).join('.');
  }
}

export function parseKontur(source, options) {
  try {
    return new Parser(lex(source)).parse(options);
  } catch (error) {
    return {
      name: 'Ungültiger Workspace', namespace: '', nodes: [], relations: [], views: [],
      diagnostics: [{ severity: 'error', message: error.message, line: error.line || 1, column: error.column || 1 }],
    };
  }
}

function expandEvidence(assertion) {
  return assertion.evidence?.map((location) => ({ ...assertion, ...location })) ?? [assertion];
}

export function validateModel(model) {
  const validator = new Parser([]);
  Object.assign(validator, model, { ids: new Map(model.nodes.map((node) => [node.id, node])) });
  validator.validate();
}

export const supportedSyntax = {
  elements: [...elementTypes],
  relations: [...relationshipTypes],
  views: ['landscape', 'containers', 'components', 'apis', 'ownership', 'deployment', ...technicalViews],
};
