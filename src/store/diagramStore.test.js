import { describe, it, expect, beforeEach } from 'vitest';
import useDiagramStore from './diagramStore';
import { serializeProject, validateProject } from '../utils/saveLoadUtils';

function reset() {
  useDiagramStore.getState().newProject();
  useDiagramStore.temporal.getState().clear();
}

describe('diagramStore', () => {
  beforeEach(() => reset());

  it('adds nodes and connects an edge with inherited type + label', () => {
    const s = useDiagramStore.getState();
    const a = s.addNode('roborio2', { x: 0, y: 0 });
    const b = s.addNode('pdh', { x: 400, y: 0 });
    const st = useDiagramStore.getState();
    const srcPort = st.nodes.find((n) => n.id === a).data.ports.find((p) => p.type === 'CAN');
    const tgtPort = st.nodes.find((n) => n.id === b).data.ports.find((p) => p.type === 'CAN');
    st.addEdge({ source: a, target: b, sourceHandle: srcPort.id, targetHandle: tgtPort.id });
    const edge = useDiagramStore.getState().edges[0];
    expect(edge.data.type).toBe('CAN');
    expect(edge.data.label).toBe('CAN001');
    expect(edge.data.wireGauge).toBe('22 AWG');
    expect(edge.data.wireFittingFrom).toBe('Wago Lever Nut');
    expect(edge.data.wireFittingTo).toBe('Wago Lever Nut');
    const layers = useDiagramStore.getState().layers;
    expect(edge.data.layerId).toBe(layers.find((l) => l.name === 'CAN Bus').id);
  });

  it('atomically undoes a node deletion + its cascaded edges in one step', () => {
    const s = useDiagramStore.getState();
    const a = s.addNode('roborio2', { x: 0, y: 0 });
    const b = s.addNode('pdh', { x: 400, y: 0 });
    const st = useDiagramStore.getState();
    const srcPort = st.nodes.find((n) => n.id === a).data.ports.find((p) => p.type === 'CAN');
    const tgtPort = st.nodes.find((n) => n.id === b).data.ports.find((p) => p.type === 'CAN');
    st.addEdge({ source: a, target: b, sourceHandle: srcPort.id, targetHandle: tgtPort.id });

    expect(useDiagramStore.getState().edges).toHaveLength(1);
    useDiagramStore.getState().removeNode(a);
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
    expect(useDiagramStore.getState().edges).toHaveLength(0);

    // one undo restores BOTH the node and the cascaded edge
    useDiagramStore.getState().undo();
    expect(useDiagramStore.getState().nodes).toHaveLength(2);
    expect(useDiagramStore.getState().edges).toHaveLength(1);
  });

  it('blocks deleting a locked node', () => {
    const s = useDiagramStore.getState();
    const a = s.addNode('battery', { x: 0, y: 0 });
    useDiagramStore.getState().updateNodeData(a, { locked: true });
    useDiagramStore.getState().removeNode(a);
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });

  it('round-trips through serialize → validate → load', () => {
    const s = useDiagramStore.getState();
    s.addNode('roborio2', { x: 10, y: 20 });
    s.setProjectName('My Bot');
    const project = serializeProject(useDiagramStore.getState());
    const result = validateProject(project);
    expect(result.ok).toBe(true);

    reset();
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
    const loaded = useDiagramStore.getState().loadProject(project);
    expect(loaded).toBe(true);
    expect(useDiagramStore.getState().projectName).toBe('My Bot');
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
    expect(useDiagramStore.getState().nodes[0].position).toEqual({ x: 10, y: 20 });
  });

  it('rejects a newer-version file', () => {
    const result = validateProject({ app: 'wireup', version: 99, nodes: [], edges: [], layers: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/newer version/);
  });

  it('routing mode + manual waypoints', () => {
    const s = useDiagramStore.getState();
    const a = s.addNode('roborio2', { x: 0, y: 0 });
    const b = s.addNode('pdh', { x: 400, y: 0 });
    let st = useDiagramStore.getState();
    const sp = st.nodes.find((n) => n.id === a).data.ports.find((p) => p.type === 'CAN');
    const tp = st.nodes.find((n) => n.id === b).data.ports.find((p) => p.type === 'CAN');

    // auto mode (default) → new wire is not manual
    st.addEdge({ source: a, target: b, sourceHandle: sp.id, targetHandle: tp.id });
    expect(useDiagramStore.getState().edges[0].data.manual).toBe(false);

    // switch to manual mode → next wire is manual
    useDiagramStore.getState().updateSettings({ routingMode: 'manual' });
    st = useDiagramStore.getState();
    st.addEdge({ source: a, target: b, sourceHandle: sp.id, targetHandle: tp.id });
    expect(useDiagramStore.getState().edges[1].data.manual).toBe(true);

    // setEdgeWaypoints marks any wire manual; clearEdgeWaypoints reverts to auto
    const e0 = useDiagramStore.getState().edges[0].id;
    useDiagramStore.getState().setEdgeWaypoints(e0, [{ x: 50, y: 60 }]);
    let edge0 = useDiagramStore.getState().edges.find((e) => e.id === e0);
    expect(edge0.data.manual).toBe(true);
    expect(edge0.data.waypoints).toEqual([{ x: 50, y: 60 }]);
    useDiagramStore.getState().clearEdgeWaypoints(e0);
    edge0 = useDiagramStore.getState().edges.find((e) => e.id === e0);
    expect(edge0.data.manual).toBe(false);
    expect(edge0.data.waypoints).toEqual([]);

    useDiagramStore.getState().updateSettings({ routingMode: 'auto' }); // avoid leaking mode
  });

  it('moves deleted-layer wires to Power', () => {
    const s = useDiagramStore.getState();
    s.addLayer();
    const custom = useDiagramStore.getState().layers.find((l) => !l.builtIn);
    const a = s.addNode('roborio2', { x: 0, y: 0 });
    const b = s.addNode('pdh', { x: 400, y: 0 });
    const st = useDiagramStore.getState();
    const sp = st.nodes.find((n) => n.id === a).data.ports.find((p) => p.type === 'CAN');
    const tp = st.nodes.find((n) => n.id === b).data.ports.find((p) => p.type === 'CAN');
    st.addEdge({ source: a, target: b, sourceHandle: sp.id, targetHandle: tp.id });
    const eid = useDiagramStore.getState().edges[0].id;
    useDiagramStore.getState().updateEdgeData(eid, { layerId: custom.id });
    useDiagramStore.getState().removeLayer(custom.id);
    const powerId = useDiagramStore.getState().layers.find((l) => l.name === 'Power').id;
    expect(useDiagramStore.getState().edges[0].data.layerId).toBe(powerId);
  });
});
