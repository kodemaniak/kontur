import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import small from '../../fixtures/small.json';
import large from '../../fixtures/large.json';
import type { ArchitectureElement, ArchitectureFixture } from './model';
import { mutateFixture } from './model';
import { buildDirectElkGraph } from '../../elk-only/layout';
import {
  buildElkGraph,
  createLayoutClient,
  mapElkEdges,
  mapElkNodes,
  measureFixture,
  isCurrentLayoutRevision,
  preserveEdgeRoutes,
  preserveNodeGeometry,
  withManualReturnRoute,
  type C4Node,
  type RoutedEdge,
} from './layout';
import '@xyflow/react/dist/style.css';

declare global {
  interface Window {
    acquireVsCodeApi?: () => { postMessage: (message: unknown) => void };
  }
}

const vscode = window.acquireVsCodeApi?.();
const nodeTypes = { c4: C4NodeView };
const edgeTypes = { routed: RoutedEdgeView };
const fixtures = { small: small as unknown as ArchitectureFixture, large: large as unknown as ArchitectureFixture };

function C4NodeView({ data, selected, positionAbsoluteX, positionAbsoluteY }: NodeProps<C4Node>) {
  const { element } = data;
  const isSystem = element.kind === 'system';
  const isPerson = element.kind === 'person';
  return (
    <div className={`c4-node c4-${element.kind}${selected ? ' selected' : ''}`} data-flow-x={positionAbsoluteX} data-flow-y={positionAbsoluteY}>
      <Handle type="target" position={Position.Left} />
      <div className="c4-kind">{isSystem ? 'SYSTEM BOUNDARY' : element.kind.toUpperCase()}</div>
      <strong>{element.name}</strong>
      {!isSystem && <span className="c4-description">{element.description}</span>}
      {!isSystem && element.technology && <span className="c4-technology">{element.technology}</span>}
      {isPerson && <span className="c4-person-icon" aria-hidden="true">●</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function RoutedEdgeView({ id, sourceX, sourceY, targetX, targetY, data, markerEnd, style }: EdgeProps<RoutedEdge>) {
  const sections = data?.sections ?? [];
  const path = sections.length
    ? sections.map((section) => {
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
      return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    }).join(' ')
    : getBezierPath({ sourceX, sourceY, targetX, targetY })[0];
  const label = data?.relationship.label + (data?.relationship.technology ? ` · ${data.relationship.technology}` : '');
  const labelPosition = data?.label;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {labelPosition && (
        <EdgeLabelRenderer>
          <div
            className="relationship-label"
            data-edge-label={id}
            data-flow-x={labelPosition.x}
            data-flow-y={labelPosition.y}
            style={{
              width: labelPosition.width,
              height: labelPosition.height,
              maxWidth: 'none',
              transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function App() {
  const reactFlow = useReactFlow<C4Node, RoutedEdge>();
  const [fixture, setFixture] = useState(fixtures.small);
  const [layoutMode, setLayoutMode] = useState<'existing' | 'direct-elk'>('existing');
  const [routeMode, setRouteMode] = useState<'elk' | 'manual'>('elk');
  const [flowKey, setFlowKey] = useState(0);
  const [nodes, setNodes] = useState<C4Node[]>([]);
  const [edges, setEdges] = useState<RoutedEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [isStale, setIsStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [elapsedMs, setElapsedMs] = useState<number>();
  const [sourcePreview, setSourcePreview] = useState('Select a node or relationship to inspect its fixture source mapping.');
  const revision = useRef(0);
  const fitNextLayout = useRef(false);
  const client = useRef<ReturnType<typeof createLayoutClient> | undefined>(undefined);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  useEffect(() => {
    if (flowKey) requestAnimationFrame(() => void reactFlow.fitView({ padding: 0.18 }));
  }, [flowKey, reactFlow]);

  const renderSource = useCallback((element: ArchitectureElement) => {
    const sourceLine = `${element.source.file}:${element.source.line}:${element.source.column}`;
    setSourcePreview(`${element.kind}: ${element.name}\n${sourceLine}\n${element.description}`);
  }, []);

  const layout = useCallback(async (model: ArchitectureFixture, activeClient = client.current, mode = layoutMode, route = routeMode) => {
    if (!activeClient) return;
    const currentRevision = ++revision.current;
    const started = performance.now();
    setBusy(true);
    setError(undefined);
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas text measurement is unavailable');
      const input = mode === 'direct-elk'
        ? buildDirectElkGraph(model, context)
        : buildElkGraph(model, measureFixture(model, context), context);
      const graph = await activeClient.layout(input);
      if (!isCurrentLayoutRevision(currentRevision, revision.current)) return;
      const nextNodes = mapElkNodes(graph, model).map((node) => ({ ...node, selected: node.id === selectedId }));
      const mappedEdges = mapElkEdges(graph, model);
      const nextEdges = route === 'manual' && model.id === fixtures.small.id
        ? withManualReturnRoute(mappedEdges, nextNodes)
        : mappedEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      if (fitNextLayout.current) {
        fitNextLayout.current = false;
        setFlowKey((key) => key + 1);
      }
      if (selectedId && nextNodes.some((node) => node.id === selectedId)) renderSource(nextNodes.find((node) => node.id === selectedId)!.data.element);
      else setSelectedId(undefined);
      setElapsedMs(performance.now() - started);
      setIsStale(false);
    } catch (cause) {
      if (isCurrentLayoutRevision(currentRevision, revision.current)) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setIsStale(true);
      }
    } finally {
      if (isCurrentLayoutRevision(currentRevision, revision.current)) setBusy(false);
    }
  }, [layoutMode, renderSource, routeMode, selectedId]);

  useEffect(() => {
    const workerUrl = document.documentElement.dataset.workerUrl ?? './layout-worker.js';
    const activeClient = createLayoutClient(workerUrl);
    client.current = activeClient;
    void layout(fixture, activeClient);
    return () => {
      revision.current++;
      activeClient.dispose();
      if (client.current === activeClient) client.current = undefined;
    };
    // The worker is created once. Fixture changes use the explicit layout path below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = event.data as { type?: string; id?: string };
      if (message?.type !== 'editor-selection' || typeof message.id !== 'string' || !nodeById.has(message.id)) return;
      setSelectedId(message.id);
      renderSource(nodeById.get(message.id)!.data.element);
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === message.id })));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [nodeById, renderSource]);

  const updateFixture = (next: ArchitectureFixture, action: 'layout' | 'preserve' = 'layout', route = routeMode) => {
    setFixture(next);
    if (action === 'preserve') {
      revision.current++;
      setBusy(false);
      setError(undefined);
      setNodes((current) => preserveNodeGeometry(current, next));
      setEdges((current) => preserveEdgeRoutes(current, next));
      setIsStale(false);
    } else {
      void layout(next, client.current, layoutMode, route);
    }
  };

  const selectFixture = (id: 'small' | 'large') => {
    setSelectedId(undefined);
    setSourcePreview('Select a node to inspect its fixture source mapping.');
    const route = id === 'small' ? routeMode : 'elk';
    setRouteMode(route);
    updateFixture(fixtures[id], 'layout', route);
  };

  const selectLayoutMode = (mode: 'existing' | 'direct-elk') => {
    setLayoutMode(mode);
    fitNextLayout.current = true;
    void layout(fixture, client.current, mode, routeMode);
  };

  const selectRouteMode = (mode: 'elk' | 'manual') => {
    setRouteMode(mode);
    void layout(fixture, client.current, layoutMode, mode);
  };

  const runAction = (action: 'rename' | 'add' | 'remove') => {
    const next = mutateFixture(fixture, action);
    if (action === 'rename') updateFixture(next, 'preserve');
    else updateFixture(next);
  };

  const selectNode = (id: string) => {
    setSelectedId(id);
    const element = nodeById.get(id)?.data.element ?? fixture.elements.find((item) => item.id === id);
    if (element) renderSource(element);
  };

  const revealNode = (id: string) => {
    const element = fixture.elements.find((item) => item.id === id);
    if (!element) return;
    selectNode(id);
    vscode?.postMessage({ type: 'reveal-source', id });
    if (!vscode) setSourcePreview((current) => `${current}\n\nBrowser source preview: ${element.source.file}:${element.source.line}`);
  };

  const onNodesChange = (changes: NodeChange<C4Node>[]) => setNodes((current) => applyNodeChanges(changes, current) as C4Node[]);
  const onNodeClick = (_event: React.MouseEvent, node: C4Node) => selectNode(node.id);
  const onNodeDoubleClick = (_event: React.MouseEvent, node: C4Node) => revealNode(node.id);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    const target = event.target as Element;
    const id = target.closest('.react-flow__node')?.getAttribute('data-id');
    if (id) revealNode(id);
  };
  const invalidFixture = () => { revision.current++; setBusy(false); setIsStale(true); };
  const failedLayout = () => { revision.current++; setBusy(false); setError('Simulated ELK layout failure'); setIsStale(true); };

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div><h1>Kontur visualization spike</h1><span>React Flow + ELK.js · fixture-driven prototype</span></div>
        <div className="toolbar-controls">
          <label htmlFor="fixture-select">Fixture</label>
          <select id="fixture-select" value={fixture.id} onChange={(event) => selectFixture(event.target.value as 'small' | 'large')}>
            <option value="small">Representative C4 (8 elements)</option>
            <option value="large">Stress graph (101 elements)</option>
          </select>
          <label htmlFor="layout-mode-select">Layout</label>
          <select id="layout-mode-select" value={layoutMode} onChange={(event) => selectLayoutMode(event.target.value as 'existing' | 'direct-elk')}>
            <option value="existing">Existing layout</option>
            <option value="direct-elk">Direct ELK output</option>
          </select>
          <label htmlFor="route-mode-select">Return edge</label>
          <select id="route-mode-select" value={routeMode} onChange={(event) => selectRouteMode(event.target.value as 'elk' | 'manual')}>
            <option value="elk">ELK route</option>
            <option value="manual" disabled={fixture.id !== fixtures.small.id}>Manual route (small only)</option>
          </select>
          <button onClick={() => updateFixture(fixtures[fixture.id as 'small' | 'large'])}>Reset</button>
          <button onClick={() => runAction('rename')}>Rename</button>
          <button onClick={() => runAction('add')}>Add</button>
          <button onClick={() => runAction('remove')}>Remove added</button>
          <button onClick={() => void layout(fixture)}>Re-layout</button>
          <button onClick={invalidFixture}>Simulate invalid input</button>
          <button onClick={failedLayout}>Simulate layout failure</button>
        </div>
      </header>
      <section className="diagram-and-source">
        <div className="diagram" onKeyDownCapture={onKeyDown} aria-label="Architecture diagram" data-layout-mode={layoutMode} data-route-mode={routeMode}>
          {isStale && <div className="status stale" role="status">Showing last valid view · stale</div>}
          {busy && <div className="status busy" role="status">Laying out…</div>}
          {error && <div className="status error" role="alert">Layout failed: {error}</div>}
          {elapsedMs !== undefined && <div className="status timing">{nodes.length} nodes · {edges.length} relationships · {elapsedMs.toFixed(1)} ms</div>}
          <ReactFlow
              key={flowKey}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.12}
              maxZoom={2}
              colorMode="system"
              ariaLabelConfig={{ 'node.a11yDescription.default': '{label}, {position}. Press enter to select.', 'edge.a11yDescription.default': '{label} from {source} to {target}.' }}
          >
            <Background gap={20} size={1} />
            <Controls />
          </ReactFlow>
        </div>
        <aside className="source-panel" aria-label="Selected architecture source">
          <h2>Source mapping</h2>
          <pre>{sourcePreview}</pre>
          <p>Double-click a node to reveal its mapped source in VS Code.</p>
        </aside>
      </section>
      <footer>
        Fixture: {fixture.title} · {fixture.relationships.length} relationships · local-only; no DSL parser
      </footer>
    </main>
  );
}

export default function AppRoot() {
  return <ReactFlowProvider><App /></ReactFlowProvider>;
}
