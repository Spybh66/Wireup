// §2 Central store — Zustand + zundo temporal history + autosave + settings.
import { create } from 'zustand';
import { temporal } from 'zundo';
import { getDefinition } from '../data/componentLibrary';
import {
  WIRE_TYPE_INFO,
  defaultLayerNameForType,
  defaultGaugeForType,
  defaultFittingForType,
  typeGroup,
} from '../data/wireTypes';
import { buildLabel, regenerateLabels, groupCounts } from '../utils/labelUtils';
import {
  serializeProject,
  validateProject,
  writeAutosave,
} from '../utils/saveLoadUtils';

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
  gridSize: 16,
  snapToGrid: true,
  gridVisible: true,
  showPortLabels: true,
  showWireLabels: false,
  routingMode: 'auto', // 'auto' = A* route new wires; 'manual' = straight, user-shaped
  drc: { disabledRules: [] }, // Design Rule Check — ids of rules the user turned off
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

      updateNodeData: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
          ),
          dirty: true,
        })),

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
        if (!srcPort) return;

        const type = srcPort.type; // type inherits from SOURCE port
        if (tgtPort && tgtPort.type !== type) {
          get().addToast(`Type mismatch: ${type} → ${tgtPort.type}`);
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
            wireFittingFrom: srcPort.fitting ?? defaultFittingForType(type),
            wireFittingTo: tgtPort?.fitting ?? defaultFittingForType(type),
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
      pasteGraph: (newNodes, newEdges) =>
        set((s) => ({
          nodes: [...s.nodes, ...newNodes],
          edges: [...s.edges, ...newEdges],
          selection: { nodes: newNodes.map((n) => n.id), edges: [] },
          dirty: true,
        })),

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
        if (!srcPort) return;
        const type = srcPort.type;
        if (tgtPort && tgtPort.type !== type) {
          get().addToast(`Type mismatch: ${type} → ${tgtPort.type}`);
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
                    wireGauge: srcPort.gauge ?? defaultGaugeForType(type),
                    wireFittingFrom: srcPort.fitting ?? defaultFittingForType(type),
                    wireFittingTo: tgtPort?.fitting ?? defaultFittingForType(type),
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

      newProject: () =>
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
        }),

      markSaved: () => set({ dirty: false }),

      // ---------- undo / redo ----------
      undo: () => useDiagramStore.temporal.getState().undo(),
      redo: () => useDiagramStore.temporal.getState().redo(),

      // ---------- selection / UI ----------
      setActiveTab: (tab) => set({ activeTab: tab }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSelection: (selection) => set({ selection }),

      // ---------- settings ----------
      updateSettings: (patch) =>
        set((s) => {
          const settings = { ...s.settings, ...patch };
          persistSettings(settings);
          return { settings };
        }),

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
useDiagramStore.subscribe((state, prev) => {
  const changed =
    state.nodes !== prev.nodes ||
    state.edges !== prev.edges ||
    state.layers !== prev.layers ||
    state.projectName !== prev.projectName ||
    state.wireLabelTemplate !== prev.wireLabelTemplate ||
    state.customDefinitions !== prev.customDefinitions;
  if (!changed) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    writeAutosave(serializeProject(useDiagramStore.getState()));
  }, 500);
});

// Dev-only: expose the store for in-browser debugging / verification.
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__store = useDiagramStore;
}

export default useDiagramStore;
