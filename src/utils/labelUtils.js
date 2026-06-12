// §4 Wire label template engine.
import { typeGroup } from '../data/wireTypes';

// Supported tokens (only these four): {type} {index} {from} {to}.
export function expandTemplate(template, { group, index, from, to }) {
  const idx = String(index).padStart(3, '0');
  return (template || '{type}{index}')
    .split('{type}').join(group)
    .split('{index}').join(idx)
    .split('{from}').join(from ?? '')
    .split('{to}').join(to ?? '');
}

// Build a single label for a new edge. `index` is the 1-based per-group counter value.
export function buildLabel(template, type, index, fromLabel, toLabel) {
  return expandTemplate(template, {
    group: typeGroup(type),
    index,
    from: fromLabel,
    to: toLabel,
  });
}

// §4.2 Regenerate every label deterministically (group, then creation order).
// `nodeLabelById` maps a node id → its display label. Returns new edge array;
// resets labelEdited to false on all edges.
export function regenerateLabels(edges, template, nodeLabelById) {
  const counters = {};
  return edges.map((e) => {
    const group = typeGroup(e.data.type);
    const index = (counters[group] = (counters[group] ?? 0) + 1);
    const label = expandTemplate(template, {
      group,
      index,
      from: nodeLabelById(e.source),
      to: nodeLabelById(e.target),
    });
    return { ...e, data: { ...e.data, label, labelEdited: false } };
  });
}

// Count edges in the same label group (used to seed per-group counters on load).
export function groupCounts(edges) {
  const counts = {};
  for (const e of edges) {
    const g = typeGroup(e.data.type);
    counts[g] = (counts[g] ?? 0) + 1;
  }
  return counts;
}
