// §2 Central store — Zustand + zundo temporal history + autosave + settings.
import { create } from 'zustand';
import { temporal } from 'zundo';
import { getDefinition } from '../data/componentLibrary';
import { PORT_GRID } from '../utils/geometry';
import {
  WIRE_TYPE_INFO,
  defaultLayerNameForType,
  defaultGaugeForType,
  endFitting,
  typeGroup,
} from '../data/wireTypes';
import { buildLabel, regenerateLabels, groupCounts } from '../utils/labelUtils';
import {
  serializeProject,
  validateProject,
  writeAutosave,
} from '../utils/saveLoadUtils';
import { canvasBridge } from '../components/canvas/canvasBridge';
import sampleProject from '../../examples/example.json';

const uuid = () => crypto.randomUUID();

// ---- defaults ----
function defaultLayers() {
  return [
    { id: 'power', name: 'Power', visible: true, builtIn: true },
    { id: 'canbus', name: 'CAN Bus', visible: true, builtIn: true },
    { id: 'ethernet', name: 'Ethernet', visible: true, builtIn: true },
    { id: 'usb', name: 'USB', visible: true, builtIn: true },
    { id: 'data', name: 'Data', visible: true, builtIn: true },
  ];
}

const DEFAULT_SETTINGS = {
  // Same grid ports sit on, so a snapped node lands every port on a grid line.
  gridSize: PORT_GRID,
  snapToGrid: true,
  gridVisible: true,
  showPortLabels: true,
  showWireLabels: false,
  routingMode: 'auto', // 'auto' = A* route new wires; 'manual' = straight, user-shaped
  // Preferred fitting per wire type for new wires (null = each port's own
  // default). Only applied where the port accepts it — see endFitting().
  defaultFittings: { PWR: null, CAN: null },
  annotationsVisible: true, // notes + zones layer visibility
  // Design Rule Check — disabled rule ids, per-rule severity overrides
  // ('error' | 'warning' | 'info' | 'off'), and dismissed violation keys.
  drc: { disabledRules: [], severityOverrides: {}, dismissed: [] },
};

const SETTINGS_KEY = 'wireup_settings';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

// ---- subsystem templates (reusable wired clusters), persisted ----
const TEMPLATES_KEY = 'wireup_templates';

function loadTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistTemplates(templates) {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch {
    /* ignore */
  }
}

const deepCopy = (o) => JSON.parse(JSON.stringify(o));

// Clone a cluster of nodes plus the edges *between* them, giving every clone a
// fresh node id AND fresh per-instance port ids. Edge endpoints and handles are
// remapped through those ids, and only edges with both ends inside the cluster
// survive. This keeps a pasted/placed copy fully isolated: because handle ids
// are unique per instance, a copy can never share handles with — or get wired
// back to — the original (the cause of "wires leaving the placed subsystem").
export function cloneCluster(srcNodes, srcEdges, mapPosition = (p) => p) {
  const nodeIdMap = new Map();
  const handleMap = new Map(); // `${oldNodeId}:${oldHandle}` -> newHandle
  const newNodes = srcNodes.map((n) => {
    const nid = uuid();
    nodeIdMap.set(n.id, nid);
    const data = deepCopy(n.data);
    if (Array.isArray(data.ports)) {
      data.ports = data.ports.map((p) => {
        const pid = uuid();
        handleMap.set(`${n.id}:${p.id}`, pid);
        return { ...p, id: pid };
      });
    }
    return { ...deepCopy(n), id: nid, position: mapPosition(n.position), data };
  });
  const newEdges = srcEdges
    .filter((e) => nodeIdMap.has(e.source) && nodeIdMap.has(e.target))
    .map((e) => {
      const clone = deepCopy(e);
      // Manual wires keep their shape: translate waypoints by the same vector as
      // the nodes so the routing moves with the copy instead of pointing back at
      // the original's coordinates. Auto wires have none and simply re-route.
      const wps = clone.data?.waypoints;
      if (Array.isArray(wps) && wps.length) clone.data.waypoints = wps.map((p) => mapPosition(p));
      return {
        ...clone,
        id: uuid(),
        source: nodeIdMap.get(e.source),
        target: nodeIdMap.get(e.target),
        sourceHandle: handleMap.get(`${e.source}:${e.sourceHandle}`) ?? e.sourceHandle,
        targetHandle: handleMap.get(`${e.target}:${e.targetHandle}`) ?? e.targetHandle,
      };
    });
  return { newNodes, newEdges, nodeIdMap };
}

// Resolve a layer id from a wire type using the current layer list (by name).
function layerIdForType(layers, type) {
  const name = defaultLayerNameForType(type);
  const layer = layers.find((l) => l.name === name);
  return layer ? layer.id : 'power';
}

// Deduplicated default label for a new node of definition `def`.
function dedupeLabel(nodes, baseName) {
  const re = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( (\\d+))?$`);
  let max = 0;
  let hasBase = false;
  for (const n of nodes) {
    const m = re.exec(n.data.label || '');
    if (m) {
      if (m[2]) max = Math.max(max, parseInt(m[2], 10));
      else hasBase = true;
    }
  }
  if (!hasBase && max === 0) return baseName;
  return `${baseName} ${Math.max(max, 1) + 1}`;
}

// Deep clone of definition ports into an editable instance copy.
function instancePorts(def) {
  return def.defaultPorts.map((p) => ({ ...p }));
}

const useDiagramStore = create(
  temporal(
    (set, get) => ({
      // ---- tracked state ----
      nodes: [],
      edges: [],
      layers: defaultLayers(),
      projectName: 'Untitled Project',
      wireLabelTemplate: '{type}{index}',
      customDefinitions: [],

      // ---- non-tracked UI state ----
      templates: loadTemplates(), // reusable subsystems (not in undo history)
      activeTab: 'diagram', // 'diagram' | 'sheet'
      sidebarOpen: true,
      selection: { nodes: [], edges: [] },
      settings: loadSettings(),
      toasts: [],
      labelCounters: {}, // per-group monotonic counter (not persisted)
      dirty: false, // unsaved changes since last save/load/new
      draggingNodeIds: [], // nodes currently being dragged (cheap routing)
      restoreData: null, // autosave payload available on startup

      // ---------- nodes ----------
      addNode: (definitionId, position) => {
        const { nodes, customDefinitions, settings } = get();
        const def = getDefinition(definitionId, customDefinitions);
        if (!def) return;
        // drop-offset if a node already occupies this exact (snapped) cell
        let pos = { ...position };
        const occupied = (p) =>
          nodes.some((n) => Math.abs(n.position.x - p.x) < 1 && Math.abs(n.position.y - p.y) < 1);
        while (occupied(pos)) pos = { x: pos.x + 24, y: pos.y + 24 };

        const node = {
          id: uuid(),
          type: 'component',
          position: pos,
          draggable: true,
          data: {
            definitionId,
            label: dedupeLabel(nodes, def.name),
            color: null,
            notes: '',
            locked: false,
            canId: null,
            ipAddress: null,
            ports: instancePorts(def),
          },
        };
        set({ nodes: [...nodes, node], dirty: true });
        return node.id;
      },

      // Add an annotation node ('note' = free text, 'zone' = labeled box). These
      // live in `nodes` (so drag/undo/save just work) but carry no definitionId,
      // so routing, DRC, and the sheet skip them.
      addAnnotation: (kind, position) => {
        const base = { id: uuid(), position: { ...position }, draggable: true };
        const node =
          kind === 'zone'
            ? { ...base, type: 'zone', zIndex: -1, data: { text: 'Zone', color: '#3b82f6', width: 240, height: 160 } }
            : { ...base, type: 'note', data: { text: 'Note', color: '#d4d4d8' } };
        set((s) => ({
          nodes: [...s.nodes, node],
          selection: { nodes: [node.id], edges: [] },
          dirty: true,
        }));
        return node.id;
      },

      // Resize/reposition an annotation (NodeResizer gives the new top-left + size).
      setAnnotationBox: (id, { x, y, width, height }) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id
              ? { ...n, position: { x, y }, data: { ...n.data, width: Math.round(width), height: Math.round(height) } }
              : n
          ),
          dirty: true,
        })),

      updateNodeData: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
          ),
          dirty: true,
        })),

      // Rotate component nodes by `delta` degrees (clockwise) about their
      // centre. Locked nodes and annotations are left alone. One undo step.
      rotateNodes: (ids, delta = 90) => {
        const turned = new Set();
        set((s) => {
          const idSet = new Set(ids);
          const snap = (v) => Math.round(v / PORT_GRID) * PORT_GRID;
          const nodes = s.nodes.map((n) => {
            if (!idSet.has(n.id) || n.data.locked || n.type !== 'component') return n;
            const def = getDefinition(n.data.definitionId, s.customDefinitions);
            if (!def) return n;
            const rotation = ((((n.data.rotation ?? 0) + delta) % 360) + 360) % 360;
            // a quarter-turn swaps the box's width/height — shift to keep centre
            const quarter = (((delta / 90) % 2) + 2) % 2 === 1;
            const before = (n.data.rotation ?? 0) % 180 === 0;
            const w = before ? def.width : def.height;
            const h = before ? def.height : def.width;
            // ...snapped back onto the port grid so its wires stay straight
            const position = quarter
              ? { x: snap(n.position.x + (w - h) / 2), y: snap(n.position.y + (h - w) / 2) }
              : n.position;
            turned.add(n.id);
            return { ...n, position, data: { ...n.data, rotation } };
          });
          if (!turned.size) return s;
          // Hand-shaped wires on a turned node no longer fit its new port
          // positions — hand them back to the auto-router.
          let rerouted = 0;
          const edges = s.edges.map((e) => {
            if (!e.data.manual || !(turned.has(e.source) || turned.has(e.target))) return e;
            rerouted += 1;
            return { ...e, data: { ...e.data, manual: false, waypoints: [] } };
          });
          if (rerouted)
            setTimeout(() => get().addToast(`Re-routed ${rerouted} hand-shaped wire${rerouted === 1 ? '' : 's'}`), 0);
          return { nodes, edges: rerouted ? edges : s.edges, dirty: true };
        });
      },

      // set draggable when lock toggles; called from updateNodeData consumers
      setNodes: (updater) =>
        set((s) => ({ nodes: typeof updater === 'function' ? updater(s.nodes) : updater })),

      moveNode: (id, position) =>
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
          dirty: true,
        })),

      removeNode: (id) => {
        const { nodes } = get();
        const node = nodes.find((n) => n.id === id);
        if (!node) return;
        if (node.data.locked) {
          get().addToast('Component is locked');
          return;
        }
        // atomic: remove node + cascade its edges
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== id),
          edges: s.edges.filter((e) => e.source !== id && e.target !== id),
          dirty: true,
        }));
      },

      // ---------- edges ----------
      addEdge: (connection) => {
        const { nodes, edges, layers, wireLabelTemplate, labelCounters, customDefinitions, settings } = get();
        const { source, target, sourceHandle, targetHandle } = connection;
        if (source === target) {
          get().addToast("Can't connect a component to itself");
          return;
        }
        const srcNode = nodes.find((n) => n.id === source);
        const tgtNode = nodes.find((n) => n.id === target);
        if (!srcNode || !tgtNode) return;
        const srcPort = srcNode.data.ports.find((p) => p.id === sourceHandle);
        const tgtPort = tgtNode.data.ports.find((p) => p.id === targetHandle);
        if (!srcPort || !tgtPort) return;
        const samePair = (e) =>
          (e.source === source && e.sourceHandle === sourceHandle && e.target === target && e.targetHandle === targetHandle) ||
          (e.source === target && e.sourceHandle === targetHandle && e.target === source && e.targetHandle === sourceHandle);
        if (edges.some(samePair)) {
          get().addToast('Those ports are already wired together');
          return;
        }

        const type = srcPort.type; // type inherits from SOURCE port
        // Reject incompatible connections outright (e.g. PWR → CAN) so the user
        // gets clear feedback instead of a silently invalid wire.
        if (tgtPort && tgtPort.type !== type) {
          get().addToast(`Can't connect ${type} to ${tgtPort.type}`);
          return;
        }
        const group = typeGroup(type);
        const nextIndex = (labelCounters[group] ?? 0) + 1;
        const label = buildLabel(
          wireLabelTemplate,
          type,
          nextIndex,
          srcNode.data.label,
          tgtNode.data.label
        );

        const edge = {
          id: uuid(),
          source,
          target,
          sourceHandle,
          targetHandle,
          type: 'wire',
          data: {
            type,
            layerId: layerIdForType(layers, type),
            color: null,
            color2: null,
            wireGauge: srcPort.gauge ?? defaultGaugeForType(type),
            wireFittingFrom: endFitting(srcPort, type, settings.defaultFittings),
            wireFittingTo: endFitting(tgtPort, type, settings.defaultFittings),
            label,
            labelEdited: false,
            length: null,
            notes: '',
            manual: settings.routingMode === 'manual', // straight, user-shaped
            waypoints: [],
          },
        };
        set({
          edges: [...edges, edge],
          labelCounters: { ...labelCounters, [group]: nextIndex },
          dirty: true,
        });
      },

      updateEdgeData: (id, patch) =>
        set((s) => ({
          edges: s.edges.map((e) =>
            e.id === id ? { ...e, data: { ...e.data, ...patch } } : e
          ),
          dirty: true,
        })),

      // Bulk edits (one history entry) for multi-selection editing.
      updateEdgesData: (ids, patch) => {
        const set_ = new Set(ids);
        set((s) => ({
          edges: s.edges.map((e) => (set_.has(e.id) ? { ...e, data: { ...e.data, ...patch } } : e)),
          dirty: true,
        }));
      },
      updateNodesData: (ids, patch) => {
        const set_ = new Set(ids);
        set((s) => ({
          nodes: s.nodes.map((n) => (set_.has(n.id) ? { ...n, data: { ...n.data, ...patch } } : n)),
          dirty: true,
        }));
      },

      // Set a wire's manual waypoints (interior control points, world coords).
      // Marks the wire manual so it routes straight through them instead of A*.
      setEdgeWaypoints: (id, waypoints) =>
        set((s) => ({
          edges: s.edges.map((e) =>
            e.id === id ? { ...e, data: { ...e.data, manual: true, waypoints } } : e
          ),
          dirty: true,
        })),

      // Drop manual waypoints and return a wire to automatic routing.
      clearEdgeWaypoints: (id) =>
        set((s) => ({
          edges: s.edges.map((e) =>
            e.id === id ? { ...e, data: { ...e.data, manual: false, waypoints: [] } } : e
          ),
          dirty: true,
        })),

      // Flip a wire's direction — swap which endpoint is From vs To (and the
      // per-side fittings). Type/layer are unchanged.
      flipEdge: (id) =>
        set((s) => ({
          edges: s.edges.map((e) => {
            if (e.id !== id) return e;
            const fromFit = e.data.wireFittingFrom ?? e.data.wireFitting ?? null;
            const toFit = e.data.wireFittingTo ?? e.data.wireFitting ?? null;
            return {
              ...e,
              source: e.target,
              target: e.source,
              sourceHandle: e.targetHandle,
              targetHandle: e.sourceHandle,
              data: { ...e.data, wireFittingFrom: toFit, wireFittingTo: fromFit },
            };
          }),
          dirty: true,
        })),

      removeEdge: (id) =>
        set((s) => ({ edges: s.edges.filter((e) => e.id !== id), dirty: true })),

      // Delete the current selection (skip locked nodes; edges always removable).
      deleteSelection: () => {
        const s = get();
        const sel = s.selection;
        if (!sel.nodes.length && !sel.edges.length) return;
        const lockedSet = new Set(s.nodes.filter((n) => n.data.locked).map((n) => n.id));
        if (sel.nodes.some((id) => lockedSet.has(id))) get().addToast('Component is locked');
        const removable = new Set(sel.nodes.filter((id) => !lockedSet.has(id)));
        set({
          nodes: s.nodes.filter((n) => !removable.has(n.id)),
          edges: s.edges.filter(
            (e) =>
              !sel.edges.includes(e.id) &&
              !removable.has(e.source) &&
              !removable.has(e.target)
          ),
          selection: { nodes: [], edges: [] },
          dirty: true,
        });
      },

      // Paste a pre-built clone graph as a single history step.
      // Auto-labelled wires get fresh labels so copies don't duplicate them.
      pasteGraph: (newNodes, newEdges) =>
        set((s) => {
          const labelOf = new Map([...s.nodes, ...newNodes].map((n) => [n.id, n.data.label]));
          const counters = { ...s.labelCounters };
          const edges = newEdges.map((e) => {
            if (e.data.labelEdited) return e;
            const group = typeGroup(e.data.type);
            const index = (counters[group] = (counters[group] ?? 0) + 1);
            const label = buildLabel(s.wireLabelTemplate, e.data.type, index, labelOf.get(e.source), labelOf.get(e.target));
            return { ...e, data: { ...e.data, label } };
          });
          return {
            nodes: [...s.nodes, ...newNodes],
            edges: [...s.edges, ...edges],
            labelCounters: counters,
            selection: { nodes: newNodes.map((n) => n.id), edges: [] },
            dirty: true,
          };
        }),

      // ---------- subsystem templates ----------
      // Save the current selection (nodes + the edges among them) as a reusable
      // template, with positions normalized to the selection's top-left corner.
      saveTemplate: (name) => {
        const s = get();
        const ids = new Set(s.selection.nodes);
        if (!ids.size) {
          get().addToast('Select components first');
          return;
        }
        const nodes = s.nodes.filter((n) => ids.has(n.id));
        const edges = s.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
        const minX = Math.min(...nodes.map((n) => n.position.x));
        const minY = Math.min(...nodes.map((n) => n.position.y));
        const tpl = {
          id: uuid(),
          name: name?.trim() || `Subsystem ${s.templates.length + 1}`,
          // Custom component definitions live in the project, templates don't —
          // carry the ones used so the subsystem still renders in other projects.
          customDefinitions: deepCopy(
            s.customDefinitions.filter((d) => nodes.some((n) => n.data.definitionId === d.id))
          ),
          nodes: nodes.map((n) => ({
            ...deepCopy(n),
            position: { x: n.position.x - minX, y: n.position.y - minY },
          })),
          // Normalize manual-wire waypoints to the same top-left origin as the
          // nodes, so on placement both translate together and keep their shape.
          edges: edges.map((e) => {
            const c = deepCopy(e);
            const wps = c.data?.waypoints;
            if (Array.isArray(wps) && wps.length)
              c.data.waypoints = wps.map((p) => ({ x: p.x - minX, y: p.y - minY }));
            return c;
          }),
        };
        const templates = [...s.templates, tpl];
        persistTemplates(templates);
        set({ templates });
        get().addToast(`Saved "${tpl.name}"`);
        return tpl.id;
      },

      renameTemplate: (id, name) => {
        const clean = name?.trim();
        if (!clean) return;
        const templates = get().templates.map((t) => (t.id === id ? { ...t, name: clean } : t));
        persistTemplates(templates);
        set({ templates });
      },

      removeTemplate: (id) => {
        const templates = get().templates.filter((t) => t.id !== id);
        persistTemplates(templates);
        set({ templates });
      },

      // Stamp a template onto the canvas at `position` (top-left), with fresh
      // node + port ids so the placed copy is fully isolated (no wires leaving
      // it, no handles shared with the original).
      instantiateTemplate: (id, position = { x: 80, y: 80 }) => {
        const tpl = get().templates.find((t) => t.id === id);
        if (!tpl) return;
        const missing = (tpl.customDefinitions ?? []).filter(
          (d) => !get().customDefinitions.some((c) => c.id === d.id)
        );
        if (missing.length) set((s) => ({ customDefinitions: [...s.customDefinitions, ...deepCopy(missing)] }));
        const { newNodes, newEdges } = cloneCluster(tpl.nodes, tpl.edges, (p) => ({
          x: p.x + position.x,
          y: p.y + position.y,
        }));
        // Keep the template's own names ("FL Drive"), made unique against the
        // canvas AND each other as they're placed.
        const existing = [...get().nodes];
        const labeled = newNodes.map((n) => {
          const base =
            n.data.label || getDefinition(n.data.definitionId, get().customDefinitions)?.name || 'Component';
          const placed = { ...n, data: { ...n.data, label: dedupeLabel(existing, base) } };
          existing.push(placed);
          return placed;
        });
        get().pasteGraph(labeled, newEdges);
      },

      // Build a small illustrative robot for onboarding (uses the real add logic).
      loadSample: async () => {
        // Don't silently replace unsaved work or a pending session restore.
        const { dirty, nodes, restoreData } = get();
        if ((dirty && nodes.length) || restoreData) {
          const msg = restoreData
            ? 'Load the sample robot? Your previous session will not be restorable.'
            : 'Load the sample robot? Unsaved changes will be lost.';
          if (!(await get().requestConfirm(msg))) return;
        }
        // Load the bundled example robot, Perry (deep-copied so repeated loads
        // always start from a clean state). loadProject clears history + dirty.
        get().loadProject(JSON.parse(JSON.stringify(sampleProject)));
        // Frame the robot once the canvas has measured it.
        setTimeout(() => canvasBridge.fitView?.({ padding: 0.15, duration: 400 }), 80);
      },

      // §3.2 reconnection — re-derive type/layer/gauge/fitting from new source.
      reconnectEdge: (edgeId, connection) => {
        const { nodes, edges, layers } = get();
        const { source, target, sourceHandle, targetHandle } = connection;
        if (source === target) {
          get().addToast("Can't connect a component to itself");
          return;
        }
        const srcNode = nodes.find((n) => n.id === source);
        const tgtNode = nodes.find((n) => n.id === target);
        const srcPort = srcNode?.data.ports.find((p) => p.id === sourceHandle);
        const tgtPort = tgtNode?.data.ports.find((p) => p.id === targetHandle);
        if (!srcPort || !tgtPort) return;
        const type = srcPort.type;
        if (tgtPort.type !== type) {
          get().addToast(`Can't connect ${type} to ${tgtPort.type}`);
          return;
        }
        set({
          edges: edges.map((e) =>
            e.id === edgeId
              ? {
                  ...e,
                  source,
                  target,
                  sourceHandle,
                  targetHandle,
                  data: {
                    ...e.data,
                    type,
                    layerId: layerIdForType(layers, type),
                    // gauge follows the wire (keep the user's unless the type changed)
                    wireGauge:
                      type === e.data.type && e.data.wireGauge
                        ? e.data.wireGauge
                        : srcPort.gauge ?? defaultGaugeForType(type),
                    // only the end that moved gets a new fitting
                    wireFittingFrom:
                      e.source === source && e.sourceHandle === sourceHandle && type === e.data.type
                        ? e.data.wireFittingFrom
                        : endFitting(srcPort, type, get().settings.defaultFittings),
                    wireFittingTo:
                      e.target === target && e.targetHandle === targetHandle && type === e.data.type
                        ? e.data.wireFittingTo
                        : endFitting(tgtPort, type, get().settings.defaultFittings),
                    // hand-placed waypoints were shaped for the old endpoint
                    manual: false,
                    waypoints: [],
                  },
                }
              : e
          ),
          dirty: true,
        });
      },

      // Remove a port from a node + cascade its attached edges (atomic).
      removePort: (nodeId, portId) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, ports: n.data.ports.filter((p) => p.id !== portId) } }
              : n
          ),
          edges: s.edges.filter(
            (e) =>
              !(
                (e.source === nodeId && e.sourceHandle === portId) ||
                (e.target === nodeId && e.targetHandle === portId)
              )
          ),
          dirty: true,
        })),

      // Change a port's type: its wires (typed by their ports) are removed in
      // the same step, and type-specific fields reset to the new type's.
      retypePort: (nodeId, portId, type) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    ports: n.data.ports.map((p) =>
                      p.id === portId
                        ? { ...p, type, gauge: defaultGaugeForType(type), fitting: null, installedConnector: null, requiredFittings: null }
                        : p
                    ),
                  },
                }
              : n
          ),
          edges: s.edges.filter(
            (e) =>
              !(
                (e.source === nodeId && e.sourceHandle === portId) ||
                (e.target === nodeId && e.targetHandle === portId)
              )
          ),
          dirty: true,
        })),

      // ---------- layers ----------
      addLayer: () =>
        set((s) => {
          const n = s.layers.filter((l) => !l.builtIn).length + 1;
          return {
            layers: [...s.layers, { id: uuid(), name: `Layer ${n}`, visible: true, builtIn: false }],
            dirty: true,
          };
        }),

      renameLayer: (id, name) =>
        set((s) => ({
          layers: s.layers.map((l) => (l.id === id && !l.builtIn ? { ...l, name } : l)),
          dirty: true,
        })),

      toggleLayer: (id) =>
        set((s) => ({
          layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
        })),

      // §2.5 delete custom layer → move its wires to Power (atomic).
      removeLayer: (id) =>
        set((s) => {
          const layer = s.layers.find((l) => l.id === id);
          if (!layer || layer.builtIn) return {};
          const powerId = s.layers.find((l) => l.name === 'Power')?.id ?? 'power';
          return {
            layers: s.layers.filter((l) => l.id !== id),
            edges: s.edges.map((e) =>
              e.data.layerId === id ? { ...e, data: { ...e.data, layerId: powerId } } : e
            ),
            dirty: true,
          };
        }),

      // ---------- project meta ----------
      setProjectName: (name) => set({ projectName: name, dirty: true }),
      setWireLabelTemplate: (t) => set({ wireLabelTemplate: t, dirty: true }),

      addCustomDefinition: (definition) =>
        set((s) => ({ customDefinitions: [...s.customDefinitions, definition], dirty: true })),

      // §4.2 regenerate all labels (atomic).
      regenerateAllLabels: () =>
        set((s) => {
          const labelOf = (nodeId) => s.nodes.find((n) => n.id === nodeId)?.data.label ?? '';
          return {
            edges: regenerateLabels(s.edges, s.wireLabelTemplate, labelOf),
            dirty: true,
          };
        }),

      // ---------- load / new ----------
      loadProject: (raw) => {
        const result = validateProject(raw);
        if (!result.ok) {
          get().addToast(result.error);
          return false;
        }
        const d = result.data;
        // ensure built-in layers exist (merge by name) so type→layer mapping holds
        let layers = d.layers;
        const builtins = defaultLayers();
        for (const b of builtins) {
          if (!layers.some((l) => l.name === b.name)) layers = [...layers, b];
        }
        set({
          nodes: d.nodes,
          edges: d.edges,
          layers,
          projectName: d.projectName,
          wireLabelTemplate: d.wireLabelTemplate,
          customDefinitions: d.customDefinitions,
          labelCounters: groupCounts(d.edges),
          selection: { nodes: [], edges: [] },
          dirty: false,
          restoreData: null,
        });
        // discard history so undo can't step before the load
        useDiagramStore.temporal.getState().clear();
        return true;
      },

      newProject: () => {
        set({
          nodes: [],
          edges: [],
          layers: defaultLayers(),
          projectName: 'Untitled Project',
          wireLabelTemplate: '{type}{index}',
          customDefinitions: [],
          labelCounters: {},
          selection: { nodes: [], edges: [] },
          dirty: false,
        });
        // like loadProject: undo must not step back into the old project
        useDiagramStore.temporal.getState().clear();
      },

      markSaved: () => set({ dirty: false }),

      // ---------- undo / redo ----------
      // The document now differs from what was saved, so mark it dirty.
      undo: () => {
        const t = useDiagramStore.temporal.getState();
        if (!t.pastStates.length) return;
        t.undo();
        set({ dirty: true });
      },
      redo: () => {
        const t = useDiagramStore.temporal.getState();
        if (!t.futureStates.length) return;
        t.redo();
        set({ dirty: true });
      },

      // ---------- selection / UI ----------
      setActiveTab: (tab) => set({ activeTab: tab }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      // Idempotent: if the new selection has the same contents as the current
      // one, return the existing state unchanged so Zustand skips the update.
      // Without this, every call minted a fresh `selection` object, and React
      // Flow's controlled-selection echo (onSelectionChange / onEdgesChange)
      // would ping-pong forever on multi-select — React error #185.
      setSelection: (selection) =>
        set((s) => {
          const cur = s.selection;
          const sameSet = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
          return sameSet(cur.nodes, selection.nodes) && sameSet(cur.edges, selection.edges)
            ? s
            : { selection };
        }),

      // ---------- settings ----------
      updateSettings: (patch) =>
        set((s) => {
          const settings = { ...s.settings, ...patch };
          persistSettings(settings);
          return { settings };
        }),

      // Re-apply the default fitting for `type` to both ends of every existing
      // wire of that type (respecting each port's installed connector and
      // allowed fittings, exactly as for a new wire). One undo step.
      applyDefaultFittings: (type) => {
        const { nodes, edges, settings } = get();
        const portOf = (nodeId, portId) =>
          nodes.find((n) => n.id === nodeId)?.data.ports?.find((p) => p.id === portId);
        let count = 0;
        const next = edges.map((e) => {
          if (e.data.type !== type) return e;
          const from = endFitting(portOf(e.source, e.sourceHandle), type, settings.defaultFittings);
          const to = endFitting(portOf(e.target, e.targetHandle), type, settings.defaultFittings);
          if (from === e.data.wireFittingFrom && to === e.data.wireFittingTo) return e;
          count += 1;
          return { ...e, data: { ...e.data, wireFittingFrom: from, wireFittingTo: to } };
        });
        if (count) set({ edges: next, dirty: true });
        return count;
      },

      // Enable/disable a single DRC rule (persisted with settings).
      toggleDrcRule: (ruleId) =>
        set((s) => {
          const cur = s.settings.drc?.disabledRules ?? [];
          const disabledRules = cur.includes(ruleId)
            ? cur.filter((r) => r !== ruleId)
            : [...cur, ruleId];
          const settings = { ...s.settings, drc: { ...s.settings.drc, disabledRules } };
          persistSettings(settings);
          return { settings };
        }),

      // Dismiss / restore individual DRC violations (by stable key).
      dismissDrc: (key) =>
        set((s) => {
          const cur = s.settings.drc?.dismissed ?? [];
          if (cur.includes(key)) return {};
          const settings = { ...s.settings, drc: { ...s.settings.drc, dismissed: [...cur, key] } };
          persistSettings(settings);
          return { settings };
        }),
      clearDismissedDrc: () =>
        set((s) => {
          const settings = { ...s.settings, drc: { ...s.settings.drc, dismissed: [] } };
          persistSettings(settings);
          return { settings };
        }),

      // Override a rule's severity ('error'|'warning'|'info'|'off'). Passing the
      // rule's default removes the override.
      setDrcRuleSeverity: (ruleId, severity, defaultSeverity) =>
        set((s) => {
          const cur = { ...(s.settings.drc?.severityOverrides ?? {}) };
          if (!severity || severity === defaultSeverity) delete cur[ruleId];
          else cur[ruleId] = severity;
          // overrides win over the legacy disabledRules list
          const disabledRules = (s.settings.drc?.disabledRules ?? []).filter((r) => r !== ruleId);
          const settings = {
            ...s.settings,
            drc: { ...s.settings.drc, severityOverrides: cur, disabledRules },
          };
          persistSettings(settings);
          return { settings };
        }),

      // DRC quick-fix: give every CAN device a unique CAN ID within its device
      // class. Keeps the first valid id in each class, renumbers conflicts, and
      // fills in missing ids — all as one undo step.
      autoAssignCanIds: () =>
        set((s) => {
          const groups = new Map(); // definitionId -> nodes[]
          for (const n of s.nodes) {
            const def = getDefinition(n.data.definitionId, s.customDefinitions);
            if (!def?.trackedFields?.includes('canId')) continue;
            const g = groups.get(n.data.definitionId);
            if (g) g.push(n);
            else groups.set(n.data.definitionId, [n]);
          }
          const idMap = new Map();
          for (const [, group] of groups) {
            const used = new Set();
            for (const n of group) {
              const v = Number(n.data.canId);
              if (n.data.canId !== null && n.data.canId !== '' && Number.isFinite(v) && !used.has(v)) {
                used.add(v);
                idMap.set(n.id, v);
              }
            }
            let next = 1;
            for (const n of group) {
              if (idMap.has(n.id)) continue;
              while (used.has(next)) next++;
              used.add(next);
              idMap.set(n.id, next);
            }
          }
          return {
            nodes: s.nodes.map((n) =>
              idMap.has(n.id) ? { ...n, data: { ...n.data, canId: idMap.get(n.id) } } : n
            ),
            dirty: true,
          };
        }),

      // DRC quick-fix: resolve duplicate IP addresses. Keeps the first device on
      // each address and moves the rest to the next free host octet on the same
      // subnet (falls back to 10.0.0.x). Blank IPs are left untouched.
      autoAssignIps: () =>
        set((s) => {
          const tracked = s.nodes.filter((n) =>
            getDefinition(n.data.definitionId, s.customDefinitions)?.trackedFields?.includes('ipAddress')
          );
          const ipOf = (n) => (n.data.ipAddress ?? '').trim();
          const valid = tracked.map(ipOf).filter(Boolean);
          // most common 3-octet prefix, else default
          const prefix =
            (valid.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) || '10.0.0.0')
              .split('.')
              .slice(0, 3)
              .join('.');
          const used = new Set();
          const patch = new Map();
          for (const n of tracked) {
            const ip = ipOf(n);
            if (!ip) continue; // don't fill blanks
            if (!used.has(ip)) {
              used.add(ip);
              continue;
            }
            let host = 2;
            let candidate;
            do {
              candidate = `${prefix}.${host++}`;
            } while (used.has(candidate));
            used.add(candidate);
            patch.set(n.id, candidate);
          }
          return {
            nodes: s.nodes.map((n) =>
              patch.has(n.id) ? { ...n, data: { ...n.data, ipAddress: patch.get(n.id) } } : n
            ),
            dirty: true,
          };
        }),

      // ---------- toasts ----------
      addToast: (message) =>
        set((s) => {
          const toast = { id: uuid(), message };
          const next = [...s.toasts, toast].slice(-3); // max 3 stacked
          return { toasts: next };
        }),
      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      // ---------- drag routing helpers ----------
      setDraggingNodeIds: (ids) => set({ draggingNodeIds: ids }),

      // ---------- autosave restore ----------
      setRestoreData: (data) => set({ restoreData: data }),
      dismissRestore: () => set({ restoreData: null }),

      // ---------- confirm dialog controller ----------
      confirmState: null, // { message, resolve }
      requestConfirm: (message) =>
        new Promise((resolve) => set({ confirmState: { message, resolve } })),
      resolveConfirm: (value) =>
        set((s) => {
          s.confirmState?.resolve(value);
          return { confirmState: null };
        }),
    }),
    {
      limit: 100,
      // Coalesce bursts of in-place edits: one arriving <400 ms after the
      // previous one joins its undo step, so typing a note or dragging a colour
      // picker is one undo, not one per keystroke (which would also flush the
      // 100-step cap). Adding/removing nodes or wires always gets its own step.
      handleSet: (handleSet) => {
        let last = 0;
        return (pastState, replace, currentState, deltaState) => {
          const now = Date.now();
          const structural =
            pastState?.nodes?.length !== currentState?.nodes?.length ||
            pastState?.edges?.length !== currentState?.edges?.length;
          if (structural || now - last > 400) handleSet(pastState, replace, currentState, deltaState);
          last = now;
        };
      },
      partialize: (s) => ({
        nodes: s.nodes,
        edges: s.edges,
        layers: s.layers,
        projectName: s.projectName,
        wireLabelTemplate: s.wireLabelTemplate,
        customDefinitions: s.customDefinitions,
      }),
      equality: (a, b) =>
        a.nodes === b.nodes &&
        a.edges === b.edges &&
        a.layers === b.layers &&
        a.projectName === b.projectName &&
        a.wireLabelTemplate === b.wireLabelTemplate &&
        a.customDefinitions === b.customDefinitions,
    }
  )
);

// ---- autosave: debounced 500ms after any tracked change (§2.8) ----
let autosaveTimer = null;
let autosaveFailed = false; // warn once per failure streak, not every change
useDiagramStore.subscribe((state, prev) => {
  const changed =
    state.nodes !== prev.nodes ||
    state.edges !== prev.edges ||
    state.layers !== prev.layers ||
    state.projectName !== prev.projectName ||
    state.wireLabelTemplate !== prev.wireLabelTemplate ||
    state.customDefinitions !== prev.customDefinitions ||
    // banner dismissed: edits made while it was up can be saved now
    (prev.restoreData && !state.restoreData);
  if (!changed) return;
  scheduleAutosave();
});

function flushAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  // While the "Restore your last session?" banner is up, the autosave slot
  // still holds that session — don't overwrite it until the user decides.
  if (useDiagramStore.getState().restoreData) return;
  const ok = writeAutosave(serializeProject(useDiagramStore.getState()));
  if (!ok && !autosaveFailed) {
    autosaveFailed = true;
    useDiagramStore
      .getState()
      .addToast('Autosave failed — storage is full or blocked. Save your project manually.');
  } else if (ok) {
    autosaveFailed = false;
  }
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, 500);
}

// Don't lose the last half-second of edits when the tab closes.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (autosaveTimer) flushAutosave();
  });
}

// Dev-only: expose the store for in-browser debugging / verification.
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__store = useDiagramStore;
}

export default useDiagramStore;
