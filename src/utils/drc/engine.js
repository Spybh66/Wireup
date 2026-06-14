// DRC engine — builds a shared evaluation context once, runs the enabled rules,
// and returns the flat violation list plus severity counts. Pure (no React).
import { getDefinition } from '../../data/componentLibrary';
import { DRC_RULES, SEVERITY_ORDER } from './rules';

// Build the context the rules read from.
function buildContext({ nodes: allNodes, edges, customDefinitions = [] }) {
  // Annotation nodes (notes/zones) have no definitionId — exclude from checks.
  const nodes = allNodes.filter((n) => n.data?.definitionId);
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

// Run all enabled rules.
//   opts — either an array/Set of disabled rule ids (back-compat) or
//          { disabledRules, severityOverrides } where severityOverrides maps a
//          rule id to 'error' | 'warning' | 'info' | 'off'.
// Each violation's severity is the effective severity (override ?? rule default).
export function runDrc(state, opts = {}) {
  const norm = Array.isArray(opts) || opts instanceof Set ? { disabledRules: opts } : opts;
  const disabled = new Set(norm.disabledRules ?? []);
  const overrides = norm.severityOverrides ?? {};
  const dismissed = new Set(norm.dismissed ?? []);
  const ctx = buildContext(state);
  const violations = [];
  for (const rule of DRC_RULES) {
    const sev = overrides[rule.id] ?? rule.severity;
    if (sev === 'off' || disabled.has(rule.id)) continue;
    let found;
    try {
      found = rule.run(ctx) || [];
    } catch {
      found = []; // a buggy rule must never break the whole check
    }
    for (const v of found) {
      v.severity = sev; // effective severity (may be overridden)
      // stable identity (independent of message text) for dismiss memory
      v.key = `${v.ruleId}|${[...(v.nodes ?? [])].sort().join(',')}|${[...(v.edges ?? [])].sort().join(',')}`;
      if (dismissed.has(v.key)) continue;
      violations.push(v);
    }
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
