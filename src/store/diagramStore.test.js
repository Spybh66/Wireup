import { describe, it, expect, beforeEach } from 'vitest';
import useDiagramStore, { cloneCluster } from './diagramStore';
import { serializeProject, validateProject } from '../utils/saveLoadUtils';

function reset() {
  useDiagramStore.getState().newProject();
  useDiagramStore.temporal.getState().clear();
}

describe('diagramStore', () => {
  beforeEach(() => reset());

  it('cloneCluster isolates a copy: fresh node + port ids, internal edges only', () => {
    const s = useDiagramStore.getState();
    const a = s.addNode('roborio2', { x: 0, y: 0 });
    const b = s.addNode('krakenx60', { x: 200, y: 0 });
    const outside = s.addNode('battery', { x: 400, y: 0 });
    let st = useDiagramStore.getState();
    const aCan = st.nodes.find((n) => n.id === a).data.ports.find((p) => p.type === 'CAN');
    const bCanIn = st.nodes.find((n) => n.id === b).data.ports.find((p) => p.label === 'CAN IN');
    const bPwr = st.nodes.find((n) => n.id === b).data.ports.find((p) => p.type === 'PWR');
    const outPwr = st.nodes.find((n) => n.id === outside).data.ports.find((p) => p.type === 'PWR');
    st.addEdge({ source: a, target: b, sourceHandle: aCan.id, targetHandle: bCanIn.id }); // internal
    st.addEdge({ source: outside, target: b, sourceHandle: outPwr.id, targetHandle: bPwr.id }); // boundary
    // Make the internal edge manual with a waypoint so we can check translation.
    const internalId = useDiagramStore.getState().edges.find((e) => e.source === a).id;
    useDiagramStore.getState().setEdgeWaypoints(internalId, [{ x: 100, y: 20 }]);

    st = useDiagramStore.getState();
    const srcNodes = st.nodes.filter((n) => n.id === a || n.id === b);
    const { newNodes, newEdges } = cloneCluster(srcNodes, st.edges, (p) => ({ x: p.x + 50, y: p.y + 50 }));

    // Boundary edge (to the un-cloned battery) is dropped; only the internal one survives.
    expect(newEdges).toHaveLength(1);
    // Manual waypoints translate with the clone (shape preserved, not stale).
    expect(newEdges[0].data.waypoints).toEqual([{ x: 150, y: 70 }]);
    // Every clone has a brand-new node id and brand-new port ids.
    const oldNodeIds = new Set(srcNodes.map((n) => n.id));
    const oldPortIds = new Set(srcNodes.flatMap((n) => n.data.ports.map((p) => p.id)));
    for (const n of newNodes) {
      expect(oldNodeIds.has(n.id)).toBe(false);
      for (const p of n.data.ports) expect(oldPortIds.has(p.id)).toBe(false);
    }
    // The surviving edge points at the clones' new ids/handles, never the originals.
    const e = newEdges[0];
    const newIds = new Set(newNodes.map((n) => n.id));
    const newHandles = new Set(newNodes.flatMap((n) => n.data.ports.map((p) => p.id)));
    expect(newIds.has(e.source) && newIds.has(e.target)).toBe(true);
    expect(newHandles.has(e.sourceHandle) && newHandles.has(e.targetHandle)).toBe(true);
  });

  it('setSelection is idempotent for identical content (no reference churn)', () => {
    const s = useDiagramStore.getState();
    const a = s.addNode('roborio2', { x: 0, y: 0 });
    const b = s.addNode('pdh', { x: 400, y: 0 });
    s.setSelection({ nodes: [a, b], edges: [] });
    const sel1 = useDiagramStore.getState().selection;
    s.setSelection({ nodes: [b, a], edges: [] }); // same set, different order
    const sel2 = useDiagramStore.getState().selection;
    expect(sel2).toBe(sel1); // same reference → Zustand skips the update (breaks the loop)
    s.setSelection({ nodes: [a], edges: [] }); // genuinely different
    expect(useDiagramStore.getState().selection).not.toBe(sel1);
  });

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

  it('migrates legacy split wire types on load (v1 → v2)', () => {
    const legacy = {
      app: 'wireup',
      version: 1,
      nodes: [
        {
          id: 'n',
          type: 'component',
          position: { x: 0, y: 0 },
          data: { definitionId: 'pdh', label: 'PDH', ports: [{ id: 'p', type: 'CANH', label: 'CAN H', side: 'bottom' }] },
        },
      ],
      edges: [{ id: 'e', source: 'n', target: 'n', data: { type: 'PWR+' } }],
      layers: [],
    };
    const r = validateProject(legacy);
    expect(r.ok).toBe(true);
    expect(r.data.nodes[0].data.ports[0].type).toBe('CAN');
    expect(r.data.edges[0].data.type).toBe('PWR');
  });

  it('rejects a newer-version file', () => {
    const result = validateProject({ app: 'wireup', version: 99, nodes: [], edges: [], layers: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/newer version/);
  });

  it('rejects structurally malformed projects but accepts annotation nodes', () => {
    // component node missing its ports array → reject
    const badNode = validateProject({
      app: 'wireup', version: 2, layers: [], edges: [],
      nodes: [{ id: 'n', type: 'component', position: { x: 0, y: 0 }, data: { definitionId: 'pdh', label: 'x' } }],
    });
    expect(badNode.ok).toBe(false);
    // edge missing source/target → reject
    const badEdge = validateProject({
      app: 'wireup', version: 2, layers: [], nodes: [],
      edges: [{ id: 'e', data: { type: 'PWR' } }],
    });
    expect(badEdge.ok).toBe(false);
    // a zone annotation (no ports) is valid
    const okAnno = validateProject({
      app: 'wireup', version: 2, layers: [], edges: [],
      nodes: [{ id: 'z', type: 'zone', position: { x: 0, y: 0 }, data: { text: 'Z', color: '#fff', width: 10, height: 10 } }],
    });
    expect(okAnno.ok).toBe(true);
  });

  it('rejects a type-mismatched connection (no wire created)', () => {
    const s = useDiagramStore.getState();
    const rio = s.addNode('roborio2', { x: 0, y: 0 });
    const pdh = s.addNode('pdh', { x: 400, y: 0 });
    const st = useDiagramStore.getState();
    const pwr = st.nodes.find((n) => n.id === rio).data.ports.find((p) => p.type === 'PWR');
    const can = st.nodes.find((n) => n.id === pdh).data.ports.find((p) => p.type === 'CAN');
    const before = useDiagramStore.getState().edges.length;
    st.addEdge({ source: rio, sourceHandle: pwr.id, target: pdh, targetHandle: can.id });
    expect(useDiagramStore.getState().edges.length).toBe(before);
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

  it('auto-assigns unique CAN IDs (keep first, renumber dups, fill missing)', () => {
    const s = useDiagramStore.getState();
    const a = s.addNode('krakenx60', { x: 0, y: 0 });
    const b = s.addNode('krakenx60', { x: 200, y: 0 });
    s.addNode('krakenx60', { x: 400, y: 0 }); // left with null canId
    useDiagramStore.getState().updateNodeData(a, { canId: 5 });
    useDiagramStore.getState().updateNodeData(b, { canId: 5 }); // duplicate
    useDiagramStore.getState().autoAssignCanIds();
    const ids = useDiagramStore
      .getState()
      .nodes.filter((n) => n.data.definitionId === 'krakenx60')
      .map((n) => n.data.canId);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(ids.every((x) => x != null)).toBe(true); // no missing
    expect(ids).toContain(5); // first valid id kept
  });

  it('auto-assigns unique IPs for duplicates, leaving blanks alone', () => {
    const s = useDiagramStore.getState();
    const a = s.addNode('roborio2', { x: 0, y: 0 });
    const b = s.addNode('orangepi5', { x: 200, y: 0 });
    s.addNode('raspberrypi5', { x: 400, y: 0 }); // blank IP stays blank
    useDiagramStore.getState().updateNodeData(a, { ipAddress: '10.0.0.2' });
    useDiagramStore.getState().updateNodeData(b, { ipAddress: '10.0.0.2' }); // dup
    useDiagramStore.getState().autoAssignIps();
    const ips = useDiagramStore
      .getState()
      .nodes.map((n) => n.data.ipAddress)
      .filter(Boolean);
    expect(new Set(ips).size).toBe(ips.length); // duplicates resolved
    expect(ips).toContain('10.0.0.2'); // first kept
  });

  it('saves a selection as a subsystem template and instantiates it', () => {
    const s = useDiagramStore.getState();
    const a = s.addNode('krakenx60', { x: 100, y: 100 });
    const b = s.addNode('cancoder', { x: 300, y: 100 });
    let st = useDiagramStore.getState();
    const sp = st.nodes.find((n) => n.id === a).data.ports.find((p) => p.type === 'CAN');
    const tp = st.nodes.find((n) => n.id === b).data.ports.find((p) => p.type === 'CAN');
    st.addEdge({ source: a, target: b, sourceHandle: sp.id, targetHandle: tp.id });
    useDiagramStore.getState().setSelection({ nodes: [a, b], edges: [] });

    useDiagramStore.getState().saveTemplate('Swerve');
    const tpls = useDiagramStore.getState().templates;
    const tpl = tpls.find((t) => t.name === 'Swerve');
    expect(tpl).toBeTruthy();
    expect(tpl.nodes).toHaveLength(2);
    expect(tpl.edges).toHaveLength(1);

    const before = useDiagramStore.getState().nodes.length;
    useDiagramStore.getState().instantiateTemplate(tpl.id);
    expect(useDiagramStore.getState().nodes.length).toBe(before + 2);
    expect(useDiagramStore.getState().edges).toHaveLength(2);

    useDiagramStore.getState().removeTemplate(tpl.id); // cleanup persisted state
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
