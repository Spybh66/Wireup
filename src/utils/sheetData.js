// Builds tabular rows for the Sheet view and exports from store state.
import { getDefinition } from '../data/componentLibrary';
import { typeGroup, typeColor } from '../data/wireTypes';

export function buildComponentRows(state) {
  const { nodes, customDefinitions } = state;
  return nodes
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
      fitting: e.data.wireFitting ?? '',
      color: e.data.color ?? typeColor(e.data.type),
      length: e.data.length,
      notes: e.data.notes ?? '',
      layer: layerName(e.data.layerId),
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}
