// DRC engine — builds a shared evaluation context once, runs the enabled rules,
// and returns the flat violation list plus severity counts. Pure (no React).
import { getDefinition } from '../../data/componentLibrary';
import { DRC_RULES, SEVERITY_ORDER } from './rules';

// Build the context the rules read from.
function buildContext({ nodes, edges, customDefinitions = [] }) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const defCache = new Map();
  const defOf = (node) => {
    if (!node) return null;
    if (defCache.has(node.id)) return defCache.get(node.id);
    const def = getDefinition(node.data.definitionId, customDefinitions);
    defCache.set(node.id, def);
    return def;
  };

  // edges attached to each (node, port)
  const portEdges = new Map();
  const push = (nodeId, portId, edge) => {
    const k = `${nodeId}:${portId}`;
    const arr = portEdges.get(k);
    if (arr) arr.push(edge);
    else portEdges.set(k, [edge]);
  };
  for (const e of edges) {
    push(e.source, e.sourceHandle, e);
    push(e.target, e.targetHandle, e);
  }

  const portsOfType = (node, type) => node.data.ports.filter((p) => p.type === type);
  const typeEdges = (node, type) =>
    edges.filter((e) => (e.source === node.id || e.target === node.id) && e.data.type === type);

  return { nodes, edges, nodeById, defOf, portEdges, portsOfType, typeEdges };
}

// Run all enabled rules. `disabledRules` is an array/Set of rule ids to skip.
export function runDrc(state, disabledRules = []) {
  const disabled = new Set(disabledRules);
  const ctx = buildContext(state);
  const violations = [];
  for (const rule of DRC_RULES) {
    if (disabled.has(rule.id)) continue;
    let found;
    try {
      found = rule.run(ctx) || [];
    } catch {
      found = []; // a buggy rule must never break the whole check
    }
    for (const v of found) violations.push(v);
  }
  violations.sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      a.ruleId.localeCompare(b.ruleId)
  );
  const counts = { error: 0, warning: 0, info: 0 };
  for (const v of violations) counts[v.severity] = (counts[v.severity] ?? 0) + 1;
  return { violations, counts };
}
