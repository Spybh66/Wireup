// Builds tabular rows for the Sheet view and exports from store state.
import { getDefinition } from '../data/componentLibrary';
import { typeGroup, typeColor, typeColor2, typeHasGaugeFitting } from '../data/wireTypes';
import { runDrc } from './drc/engine';
import { DRC_RULES } from './drc/rules';

// ---- Bill of Materials ----
const COLOR_NAMES = {
  '#ef4444': 'Red',
  '#52525b': 'Black',
  '#1a1a1a': 'Black',
  '#eab308': 'Yellow',
  '#22c55e': 'Green',
  '#3b82f6': 'Blue',
  '#a855f7': 'Purple',
  '#9ca3af': 'Gray',
};
export function colorName(hex) {
  return COLOR_NAMES[(hex ?? '').toLowerCase()] ?? hex ?? '—';
}

// Single-conductor fittings: one per conductor, so a 2-conductor CAN pair
// takes two per end. Everything else on CAN is a multi-pole housing.
const PER_CONDUCTOR = new Set(['Ferrule', 'Ring Terminal', 'Bullet']);
// Multi-pole housings: one per end however many conductors.
const MULTI_POLE = new Set(['Anderson SB50', 'Molex SL', 'Molex Micro-Fit+', 'JST', 'Barrel Jack', 'USB-A', 'USB-C']);

// Motor phase leads (A/B/C or U/V/W on a motor controller or motor) are a
// single conductor, unlike a PWR supply run which is a red+black pair.
const PHASE_LABEL = /^\s*[ABCUVW]\s*$/i;
const PHASE_CATEGORIES = new Set(['Motors', 'Motor Controllers']);
const isPhaseLead = (end) => !!end?.port && PHASE_CATEGORIES.has(end.category) && PHASE_LABEL.test(end.port.label ?? '');

// Number of conductors in a wire. `ends` = the [{ port, category }] it connects
// (either may be missing). CAN = H/L pair; PWR = +/− pair unless either end is a
// motor phase lead; everything else is counted as one.
export function conductorsFor(edge, ends = []) {
  const t = edge.data.type;
  if (t === 'CAN') return 2;
  if (t === 'PWR') return ends.some(isPhaseLead) ? 1 : 2;
  return 1;
}

// Connectors needed to terminate one END of a wire with `conductors` wires.
// Two-conductor PWR takes one of each polarity (Powerpole → Red + Black) or two
// of a single-pole part; two-conductor CAN takes two single-conductor fittings
// (ferrule/ring/bullet) or one multi-pole housing. Multi-pole housings (SB50,
// Molex SL, …) are one per end. Bare Wire = no connector.
function connectorUnits(type, fitting, conductors) {
  if (!fitting || fitting === 'Bare Wire') return [];
  if (conductors < 2 || MULTI_POLE.has(fitting)) return [{ name: fitting, qty: 1 }];
  if (fitting === 'Anderson Powerpole') {
    return type === 'PWR'
      ? [{ name: 'Anderson Powerpole (Red)', qty: 1 }, { name: 'Anderson Powerpole (Black)', qty: 1 }]
      : [{ name: 'Anderson Powerpole', qty: 1 }];
  }
  if (type === 'PWR' || PER_CONDUCTOR.has(fitting)) return [{ name: fitting, qty: conductors }];
  return [{ name: fitting, qty: 1 }];
}

// Returns { wires: [{gauge, hex, color, lengthIn, lengthFt}], connectors: [{name, qty}], installedConnectors: [{name, qty}] }.
// Two-conductor wires (PWR pair, CAN) contribute their length to both colors
// (color + color2); a single-conductor phase lead only to its own color.
export function buildBom(state) {
  const { edges, nodes, customDefinitions } = state;
  const wireMap = new Map(); // `${gauge}|${hex}` -> { gauge, hex, lengthIn }
  const connMap = new Map(); // name -> qty
  const instMap = new Map(); // name -> qty (installed connectors / pigtails)
  const addWire = (gauge, hex, len) => {
    if (!gauge || !len) return;
    const key = `${gauge}|${hex}`;
    const r = wireMap.get(key) ?? { gauge, hex, lengthIn: 0 };
    r.lengthIn += len;
    wireMap.set(key, r);
  };
  const addConn = (name, qty) => connMap.set(name, (connMap.get(name) ?? 0) + qty);
  const addInst = (name, qty) => instMap.set(name, (instMap.get(name) ?? 0) + qty);

  const nodeById = new Map((nodes ?? []).map((n) => [n.id, n]));
  const categoryOf = (n) =>
    n?.data?.definitionId ? getDefinition(n.data.definitionId, customDefinitions ?? [])?.category : undefined;
  const endOf = (nodeId, handleId) => {
    const n = nodeById.get(nodeId);
    const port = n?.data?.ports?.find((p) => p.id === handleId);
    return port ? { port, category: categoryOf(n) } : null;
  };

  for (const e of edges) {
    const t = e.data.type;
    const len = Number(e.data.length) || 0;
    const gauge = e.data.wireGauge;
    const c1 = e.data.color ?? typeColor(t);
    const c2 = e.data.color2 ?? typeColor2(t);
    const conductors = conductorsFor(e, [endOf(e.source, e.sourceHandle), endOf(e.target, e.targetHandle)]);
    if (typeHasGaugeFitting(t) && len > 0 && gauge) {
      addWire(gauge, c1, len); // + / CAN H / phase lead
      if (c2 && conductors > 1) addWire(gauge, c2, len); // − / CAN L (second conductor of the pair)
    }
    for (const fit of [e.data.wireFittingFrom ?? e.data.wireFitting, e.data.wireFittingTo ?? e.data.wireFitting]) {
      for (const u of connectorUnits(t, fit, conductors)) addConn(u.name, u.qty);
    }
  }

  // Installed connectors/pigtails added to device ports by the builder.
  for (const n of (nodes ?? [])) {
    for (const p of (n.data?.ports ?? [])) {
      // Counted like one wire end on this port (a PWR pair's Powerpole pigtail
      // is a red + black housing; a phase lead's is a single one).
      const conductors = conductorsFor({ data: { type: p.type } }, [{ port: p, category: categoryOf(n) }]);
      for (const u of connectorUnits(p.type, p.installedConnector, conductors)) addInst(u.name, u.qty);
    }
  }

  const wires = [...wireMap.values()]
    .map((r) => ({
      gauge: r.gauge,
      hex: r.hex,
      color: colorName(r.hex),
      lengthIn: Math.round(r.lengthIn),
      lengthFt: Math.round((r.lengthIn / 12) * 10) / 10,
    }))
    .sort((a, b) => a.gauge.localeCompare(b.gauge) || a.color.localeCompare(b.color));
  const connectors = [...connMap.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const installedConnectors = [...instMap.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { wires, connectors, installedConnectors };
}

const RULE_LABEL = new Map(DRC_RULES.map((r) => [r.id, r.label]));

// Design-rule-check rows for the Sheet view / exports.
export function buildValidationRows(state) {
  const { nodes, edges, customDefinitions, settings } = state;
  const { violations } = runDrc(
    { nodes, edges, customDefinitions },
    {
      disabledRules: settings?.drc?.disabledRules ?? [],
      severityOverrides: settings?.drc?.severityOverrides ?? {},
      dismissed: settings?.drc?.dismissed ?? [],
    }
  );
  const labelOf = (id) => nodes.find((n) => n.id === id)?.data.label ?? id;
  return violations.map((v) => ({
    severity: v.severity,
    rule: RULE_LABEL.get(v.ruleId) ?? v.ruleId,
    message: v.message,
    elements: (v.nodes ?? []).map(labelOf).join(', '),
  }));
}

export function buildComponentRows(state) {
  const { nodes, customDefinitions } = state;
  return nodes
    .filter((n) => n.data?.definitionId) // skip annotation nodes
    .map((n) => {
      const def = getDefinition(n.data.definitionId, customDefinitions);
      return {
        id: n.id,
        name: n.data.label,
        type: def?.name ?? 'Unknown',
        category: def?.category ?? '',
        canId: n.data.canId,
        ipAddress: n.data.ipAddress,
        notes: n.data.notes ?? '',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// From/To formatted as `Component (Port)` (§10).
function endpointLabel(nodes, customDefinitions, nodeId, handleId) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return '?';
  const port = node.data.ports.find((p) => p.id === handleId);
  return `${node.data.label} (${port?.label ?? '?'})`;
}

export function buildWireRows(state) {
  const { nodes, edges, layers, customDefinitions } = state;
  const layerName = (id) => layers.find((l) => l.id === id)?.name ?? '';
  return edges
    .map((e) => ({
      id: e.id,
      label: e.data.label,
      group: typeGroup(e.data.type),
      type: e.data.type,
      from: endpointLabel(nodes, customDefinitions, e.source, e.sourceHandle),
      to: endpointLabel(nodes, customDefinitions, e.target, e.targetHandle),
      gauge: e.data.wireGauge ?? '',
      fittingFrom: e.data.wireFittingFrom ?? e.data.wireFitting ?? '',
      fittingTo: e.data.wireFittingTo ?? e.data.wireFitting ?? '',
      color: e.data.color ?? typeColor(e.data.type),
      length: e.data.length,
      notes: e.data.notes ?? '',
      layer: layerName(e.data.layerId),
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}
