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
  annotationsVisible: true, // notes + zones layer visibility
  // Design Rule Check — disabled rule ids + per-rule severity overrides
  // ('error' | 'warning' | 'info' | 'off').
  drc: { disabledRules: [], severityOverrides: {} },
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
          nodes: nodes.map((n) => ({
            ...deepCopy(n),
            position: { x: n.position.x - minX, y: n.position.y - minY },
          })),
          edges: edges.map((e) => deepCopy(e)),
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

      // Stamp a template onto the canvas at `position` (top-left), with fresh ids.
      instantiateTemplate: (id, position = { x: 80, y: 80 }) => {
        const tpl = get().templates.find((t) => t.id === id);
        if (!tpl) return;
        const idMap = new Map();
        const newNodes = tpl.nodes.map((n) => {
          const nid = uuid();
          idMap.set(n.id, nid);
          return {
            ...deepCopy(n),
            id: nid,
            position: { x: n.position.x + position.x, y: n.position.y + position.y },
            data: { ...n.data, label: dedupeLabel(get().nodes, getDefinition(n.data.definitionId, get().customDefinitions)?.name ?? n.data.label) },
          };
        });
        const newEdges = tpl.edges.map((e) => ({
          ...deepCopy(e),
          id: uuid(),
          source: idMap.get(e.source),
          target: idMap.get(e.target),
        }));
        get().pasteGraph(newNodes, newEdges);
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
