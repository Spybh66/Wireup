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

// Connectors needed to terminate one END of a wire, accounting for combined
// wires: a CAN wire is one connector; a PWR wire is two conductors, so it takes
// one of each polarity (Powerpole → Red + Black) or two of a single-pole part.
// Anderson SB50 is a 2-pole housing (one per end). Bare Wire = no connector.
function connectorUnits(type, fitting) {
  if (!fitting || fitting === 'Bare Wire') return [];
  if (fitting === 'Anderson SB50') return [{ name: 'Anderson SB50', qty: 1 }];
  if (fitting === 'Anderson Powerpole') {
    return type === 'PWR'
      ? [{ name: 'Anderson Powerpole (Red)', qty: 1 }, { name: 'Anderson Powerpole (Black)', qty: 1 }]
      : [{ name: 'Anderson Powerpole', qty: 1 }];
  }
  return type === 'PWR' ? [{ name: fitting, qty: 2 }] : [{ name: fitting, qty: 1 }];
}

// Returns { wires: [{gauge, hex, color, lengthIn, lengthFt}], connectors: [{name, qty}] }.
// PWR contributes its length to two conductors (color + color2); so does CAN.
export function buildBom(state) {
  const { edges } = state;
  const wireMap = new Map(); // `${gauge}|${hex}` -> { gauge, hex, lengthIn }
  const connMap = new Map(); // name -> qty
  const addWire = (gauge, hex, len) => {
    if (!gauge || !len) return;
    const key = `${gauge}|${hex}`;
    const r = wireMap.get(key) ?? { gauge, hex, lengthIn: 0 };
    r.lengthIn += len;
    wireMap.set(key, r);
  };
  const addConn = (name, qty) => connMap.set(name, (connMap.get(name) ?? 0) + qty);

  for (const e of edges) {
    const t = e.data.type;
    const len = Number(e.data.length) || 0;
    const gauge = e.data.wireGauge;
    const c1 = e.data.color ?? typeColor(t);
    const c2 = e.data.color2 ?? typeColor2(t);
    if (typeHasGaugeFitting(t) && len > 0 && gauge) {
      addWire(gauge, c1, len); // + / CAN H
      if (c2) addWire(gauge, c2, len); // − / CAN L (second conductor of the pair)
    }
    for (const fit of [e.data.wireFittingFrom ?? e.data.wireFitting, e.data.wireFittingTo ?? e.data.wireFitting]) {
      for (const u of connectorUnits(t, fit)) addConn(u.name, u.qty);
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
  return { wires, connectors };
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
