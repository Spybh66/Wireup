// §4.2 Canvas root — React Flow v12 wiring, DnD, selection, drag history.
// RF owns node view-state (so it measures nodes / handle bounds); the Zustand
// store is the structural + undo source and is synced in/out.
import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Panel,
  useReactFlow,
  useNodesState,
  useStoreApi,
} from '@xyflow/react';
import { StickyNote, Square } from 'lucide-react';
import ComponentNode from './ComponentNode';
import NoteNode from './NoteNode';
import ZoneNode from './ZoneNode';
import WireEdge from './WireEdge';
import { RoutingContext } from './RoutingContext';
import { DrcContext } from './DrcContext';
import { ConnectContext } from './ConnectContext';
import { canvasBridge } from './canvasBridge';
import useDiagramStore from '../../store/diagramStore';
import { useDrc } from '../../store/useDrc';
import { computeAllRoutes } from '../../utils/routeGraph';

const SEV_RANK = { error: 0, warning: 1, info: 2 };

const nodeTypes = { component: ComponentNode, note: NoteNode, zone: ZoneNode };
const edgeTypes = { wire: WireEdge };

// Touch devices: pan with one finger, no rubber-band select.
const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

function Flow({ onOpenNodeConfig }) {
  const storeNodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const layers = useDiagramStore((s) => s.layers);
  const settings = useDiagramStore((s) => s.settings);
  const selection = useDiagramStore((s) => s.selection);
  const customDefinitions = useDiagramStore((s) => s.customDefinitions);
  const draggingNodeIds = useDiagramStore((s) => s.draggingNodeIds);
  const setSelection = useDiagramStore((s) => s.setSelection);
  const setDraggingNodeIds = useDiagramStore((s) => s.setDraggingNodeIds);

  const { screenToFlowPosition, fitView } = useReactFlow();
  const rfStore = useStoreApi();
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const baselineRef = useRef(null);
  const toastedFallbacks = useRef(new Set());
  const measuredSig = useRef(new Map()); // id → ports signature already measured

  // Measure handle bounds / dimensions once per node (and again if its ports
  // change). RF's NodeRenderer commits node DOM in a render pass after this
  // effect, so we retry until each node's element exists, then measure it by
  // calling the store action directly (useUpdateNodeInternals defers via rAF,
  // which stalls in non-painting environments). This also backs up RF's own
  // ResizeObserver, which doesn't fire reliably when the page isn't visible.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const sigOf = (n) => (n.data.ports ?? []).map((p) => p.id + p.side + p.order).join(',');
    const attempt = () => {
      if (cancelled) return;
      const updates = new Map();
      for (const n of rfNodes) {
        if (measuredSig.current.get(n.id) === sigOf(n)) continue;
        const el = document.querySelector(`.react-flow__node[data-id="${n.id}"]`);
        if (el) {
          updates.set(n.id, { id: n.id, nodeElement: el, force: true });
          measuredSig.current.set(n.id, sigOf(n));
        }
      }
      if (updates.size) rfStore.getState().updateNodeInternals(updates);
      const pending = rfNodes.some((n) => measuredSig.current.get(n.id) !== sigOf(n));
      if (pending && tries++ < 30) setTimeout(attempt, 40);
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [rfNodes, rfStore]);

  useEffect(() => {
    canvasBridge.fitView = fitView;
    canvasBridge.focusElements = (nodeIds) => {
      const ns = (nodeIds ?? []).map((id) => ({ id }));
      if (ns.length) fitView({ nodes: ns, padding: 0.4, duration: 400, maxZoom: 1.4 });
    };
    return () => {
      canvasBridge.fitView = null;
      canvasBridge.focusElements = null;
    };
  }, [fitView]);

  // ---- sync store → RF nodes (preserve RF-measured dimensions) ----
  useEffect(() => {
    setRfNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return storeNodes.map((n) => {
        const old = byId.get(n.id);
        const isAnnotation = n.type === 'note' || n.type === 'zone';
        return {
          ...n,
          draggable: !n.data.locked,
          selected: selection.nodes.includes(n.id),
          hidden: isAnnotation && !settings.annotationsVisible,
          measured: old?.measured,
          width: old?.width,
          height: old?.height,
        };
      });
    });
  }, [storeNodes, selection.nodes, settings.annotationsVisible, setRfNodes]);

  // ---- routing (from live RF node positions so wires follow drags) ----
  // Routing is expensive, so gate it on a structural signature of the nodes
  // (positions + ports + definition) — NOT selection. Otherwise rubber-band
  // selecting many nodes would re-run the router on every delta and freeze the
  // canvas. `routeNodes` only changes identity when that signature changes.
  const routeSig = useMemo(
    () =>
      rfNodes
        .map(
          (n) =>
            `${n.id}:${n.position.x},${n.position.y}:${n.data.definitionId}:` +
            (n.data.ports ?? []).map((p) => p.id + p.side + p.order).join('|')
        )
        .join(';'),
    [rfNodes]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const routeNodes = useMemo(() => rfNodes, [routeSig]);

  const { routes, fallbacks } = useMemo(
    () =>
      computeAllRoutes({
        nodes: routeNodes,
        edges,
        layers,
        gridSize: settings.gridSize,
        draggingIds: draggingNodeIds,
        customDefinitions,
      }),
    [routeNodes, edges, layers, settings.gridSize, draggingNodeIds, customDefinitions]
  );

  useEffect(() => {
    for (const f of fallbacks) {
      if (!toastedFallbacks.current.has(f.id)) {
        toastedFallbacks.current.add(f.id);
        useDiagramStore.getState().addToast(`No clear route found for ${f.label}`);
      }
    }
  }, [fallbacks]);

  const rfEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        type: 'wire',
        selected: selection.edges.includes(e.id),
        reconnectable: true,
      })),
    [edges, selection.edges]
  );

  // DRC marks → worst severity per node/edge, for canvas badges.
  const { violations: drcViolations } = useDrc();
  const drcMarks = useMemo(() => {
    const nodeMarks = new Map();
    const edgeMarks = new Map();
    const apply = (map, id, sev) => {
      const cur = map.get(id);
      if (!cur || SEV_RANK[sev] < SEV_RANK[cur]) map.set(id, sev);
    };
    for (const v of drcViolations) {
      for (const nid of v.nodes ?? []) apply(nodeMarks, nid, v.severity);
      for (const eid of v.edges ?? []) apply(edgeMarks, eid, v.severity);
    }
    return { nodes: nodeMarks, edges: edgeMarks };
  }, [drcViolations]);

  // ---- drag → single history entry (baseline → moved) ----
  const onNodeDragStart = useCallback(
    (_e, _node, dragged) => {
      baselineRef.current = useDiagramStore.getState().nodes;
      useDiagramStore.temporal.getState().pause();
      setDraggingNodeIds(dragged.map((n) => n.id));
    },
    [setDraggingNodeIds]
  );

  const onNodeDragStop = useCallback(() => {
    const moved = new Map(rfNodes.map((n) => [n.id, n.position]));
    const baseline = baselineRef.current ?? useDiagramStore.getState().nodes;
    const next = useDiagramStore
      .getState()
      .nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id) } : n));
    useDiagramStore.setState({ nodes: baseline });
    useDiagramStore.temporal.getState().resume();
    useDiagramStore.setState({ nodes: next, dirty: true });
    setDraggingNodeIds([]);
  }, [rfNodes, setDraggingNodeIds]);

  const [connectType, setConnectType] = useState(null);
  const onConnectStart = useCallback((_e, { nodeId, handleId }) => {
    const node = useDiagramStore.getState().nodes.find((n) => n.id === nodeId);
    const port = node?.data.ports.find((p) => p.id === handleId);
    setConnectType(port?.type ?? null);
  }, []);
  const onConnectEnd = useCallback(() => setConnectType(null), []);

  const onConnect = useCallback((conn) => {
    useDiagramStore.getState().addEdge(conn);
  }, []);

  const onReconnect = useCallback((oldEdge, conn) => {
    useDiagramStore.getState().reconnectEdge(oldEdge.id, conn);
  }, []);

  // Handle edge selection changes from RF so the store selection stays in sync.
  const onEdgesChange = useCallback(
    (changes) => {
      const selChanges = changes.filter((c) => c.type === 'select');
      if (!selChanges.length) return;
      const cur = useDiagramStore.getState().selection;
      let edgeIds = [...cur.edges];
      for (const c of selChanges) {
        if (c.selected) {
          if (!edgeIds.includes(c.id)) edgeIds.push(c.id);
        } else {
          edgeIds = edgeIds.filter((id) => id !== c.id);
        }
      }
      // Only push when the edge selection actually changed, so RF's controlled-
      // selection echo can't loop with the store (React error #185).
      const changed =
        edgeIds.length !== cur.edges.length || edgeIds.some((id) => !cur.edges.includes(id));
      if (changed) setSelection({ nodes: cur.nodes, edges: edgeIds });
    },
    [setSelection]
  );

  const onSelectionChange = useCallback(
    ({ nodes: ns, edges: es }) => {
      const nodeIds = ns.map((n) => n.id);
      const edgeIds = es.map((e) => e.id);
      const cur = useDiagramStore.getState().selection;
      const same =
        nodeIds.length === cur.nodes.length &&
        edgeIds.length === cur.edges.length &&
        nodeIds.every((id) => cur.nodes.includes(id)) &&
        edgeIds.every((id) => cur.edges.includes(id));
      if (!same) setSelection({ nodes: nodeIds, edges: edgeIds });
    },
    [setSelection]
  );

  const onNodeDoubleClick = useCallback(
    (_e, node) => {
      if (node.type === 'component') onOpenNodeConfig(node.id); // annotations edit inline
    },
    [onOpenNodeConfig]
  );

  // ---- drag & drop from sidebar ----
  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      const definitionId = e.dataTransfer.getData('application/wireup-definition');
      const templateId = e.dataTransfer.getData('application/wireup-template');
      if (!definitionId && !templateId) return;
      let pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const { snapToGrid, gridSize } = useDiagramStore.getState().settings;
      if (snapToGrid) {
        pos = {
          x: Math.round(pos.x / gridSize) * gridSize,
          y: Math.round(pos.y / gridSize) * gridSize,
        };
      }
      if (templateId) useDiagramStore.getState().instantiateTemplate(templateId, pos);
      else useDiagramStore.getState().addNode(definitionId, pos);
    },
    [screenToFlowPosition]
  );

  return (
    <RoutingContext.Provider value={routes}>
     <DrcContext.Provider value={drcMarks}>
      <ConnectContext.Provider value={connectType}>
      <div className="h-full w-full" onDrop={onDrop} onDragOver={onDragOver}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onReconnect={onReconnect}
          onSelectionChange={onSelectionChange}
          onNodeDoubleClick={onNodeDoubleClick}
          snapToGrid={settings.snapToGrid}
          snapGrid={[settings.gridSize, settings.gridSize]}
          deleteKeyCode={null}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          selectionOnDrag={!isTouch}
          panOnDrag={isTouch ? true : [1, 2]}
          zoomOnDoubleClick={false}
          fitView
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Panel position="top-center" className="flex gap-1">
            <button
              onClick={() =>
                useDiagramStore
                  .getState()
                  .addAnnotation('note', screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }))
              }
              title="Add a text note"
              className="flex items-center gap-1 rounded border border-edge bg-surface-1 px-2 py-1 text-xs text-silver shadow hover:bg-surface-2"
            >
              <StickyNote size={13} /> Note
            </button>
            <button
              onClick={() =>
                useDiagramStore
                  .getState()
                  .addAnnotation('zone', screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }))
              }
              title="Add a zone box"
              className="flex items-center gap-1 rounded border border-edge bg-surface-1 px-2 py-1 text-xs text-silver shadow hover:bg-surface-2"
            >
              <Square size={13} /> Zone
            </button>
          </Panel>
          {settings.gridVisible && (
            <Background variant="dots" gap={settings.gridSize} size={1.5} color="#4a4a55" />
          )}
          <Controls />
        </ReactFlow>
      </div>
      </ConnectContext.Provider>
     </DrcContext.Provider>
    </RoutingContext.Provider>
  );
}

export default function DiagramCanvas(props) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
