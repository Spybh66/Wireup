// §4.2 Canvas root — React Flow v12 wiring, DnD, selection, drag history.
// RF owns node view-state (so it measures nodes / handle bounds); the Zustand
// store is the structural + undo source and is synced in/out.
import { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  useNodesState,
  useStoreApi,
} from '@xyflow/react';
import ComponentNode from './ComponentNode';
import WireEdge from './WireEdge';
import { RoutingContext } from './RoutingContext';
import { canvasBridge } from './canvasBridge';
import useDiagramStore from '../../store/diagramStore';
import { computeAllRoutes } from '../../utils/routeGraph';

const nodeTypes = { component: ComponentNode };
const edgeTypes = { wire: WireEdge };

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
    const sigOf = (n) => n.data.ports.map((p) => p.id + p.side + p.order).join(',');
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
    return () => {
      canvasBridge.fitView = null;
    };
  }, [fitView]);

  // ---- sync store → RF nodes (preserve RF-measured dimensions) ----
  useEffect(() => {
    setRfNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return storeNodes.map((n) => {
        const old = byId.get(n.id);
        return {
          ...n,
          draggable: !n.data.locked,
          selected: selection.nodes.includes(n.id),
          measured: old?.measured,
          width: old?.width,
          height: old?.height,
        };
      });
    });
  }, [storeNodes, selection.nodes, setRfNodes]);

  // ---- routing (from live RF node positions so wires follow drags) ----
  const { routes, fallbacks } = useMemo(
    () =>
      computeAllRoutes({
        nodes: rfNodes,
        edges,
        layers,
        gridSize: settings.gridSize,
        draggingIds: draggingNodeIds,
        customDefinitions,
      }),
    [rfNodes, edges, layers, settings.gridSize, draggingNodeIds, customDefinitions]
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

  const onConnect = useCallback((conn) => {
    useDiagramStore.getState().addEdge(conn);
  }, []);

  const onReconnect = useCallback((oldEdge, conn) => {
    useDiagramStore.getState().reconnectEdge(oldEdge.id, conn);
  }, []);

  const onEdgesChange = useCallback(() => {
    // Edges are controlled by the store; selection is mirrored via
    // onSelectionChange and deletion is handled by our keyboard logic.
  }, []);

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
    (_e, node) => onOpenNodeConfig(node.id),
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
      if (!definitionId) return;
      let pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const { snapToGrid, gridSize } = useDiagramStore.getState().settings;
      if (snapToGrid) {
        pos = {
          x: Math.round(pos.x / gridSize) * gridSize,
          y: Math.round(pos.y / gridSize) * gridSize,
        };
      }
      useDiagramStore.getState().addNode(definitionId, pos);
    },
    [screenToFlowPosition]
  );

  return (
    <RoutingContext.Provider value={routes}>
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
          onReconnect={onReconnect}
          onSelectionChange={onSelectionChange}
          onNodeDoubleClick={onNodeDoubleClick}
          snapToGrid={settings.snapToGrid}
          snapGrid={[settings.gridSize, settings.gridSize]}
          deleteKeyCode={null}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          selectionOnDrag
          panOnDrag={[1, 2]}
          fitView
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          {settings.gridVisible && (
            <Background variant="dots" gap={settings.gridSize} size={1} color="#2a2a2e" />
          )}
          <Controls />
        </ReactFlow>
      </div>
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
