// DRC rule registry. Each rule is a pure data object with a `run(ctx)` that
// returns an array of violations. Rules are intentionally small and independent
// so they can be enabled/disabled individually and unit-tested in isolation.
//
// ctx (built once by the engine):
//   nodes              — all nodes
//   edges              — all edges
//   defOf(node)        — component definition (built-in or custom)
//   nodeById           — Map<id, node>
//   portEdges          — Map<`${nodeId}:${portId}`, edge[]>  (edges on a port)
//   typeEdges(node, t) — edges of wire-type `t` attached to a node
//   portsOfType(node,t)— node ports of a given type

import { ampacityForGauge, minGaugeForAmps } from '../../data/wireTypes';

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

function pluralDef(count, name) {
  return `${count}× ${name}`;
}

export const DRC_RULES = [
  // ---------------- CAN ID / IP conflicts (idea #2) ----------------
  {
    id: 'duplicate-can-id',
    label: 'Duplicate CAN ID',
    description:
      'Two or more devices of the same type share a CAN ID. IDs must be unique within a device class on a bus.',
    severity: 'error',
    run(ctx) {
      const groups = new Map(); // `${definitionId}::${canId}` -> nodes[]
      for (const n of ctx.nodes) {
        const def = ctx.defOf(n);
        if (!def?.trackedFields?.includes('canId')) continue;
        if (isBlank(n.data.canId)) continue;
        const key = `${n.data.definitionId}::${String(n.data.canId).trim()}`;
        (groups.get(key) ?? groups.set(key, []).get(key)).push(n);
      }
      const out = [];
      for (const [, group] of groups) {
        if (group.length < 2) continue;
        const def = ctx.defOf(group[0]);
        out.push({
          ruleId: this.id,
          severity: this.severity,
          message: `CAN ID ${group[0].data.canId} used by ${pluralDef(group.length, def?.name ?? 'device')}`,
          nodes: group.map((n) => n.id),
          edges: [],
          fix: { kind: 'autoAssignCanId' },
        });
      }
      return out;
    },
  },
  {
    id: 'duplicate-ip',
    label: 'Duplicate IP address',
    description: 'Two or more devices share an IP address. IPs must be unique on the network.',
    severity: 'error',
    run(ctx) {
      const groups = new Map();
      for (const n of ctx.nodes) {
        const def = ctx.defOf(n);
        if (!def?.trackedFields?.includes('ipAddress')) continue;
        if (isBlank(n.data.ipAddress)) continue;
        const key = String(n.data.ipAddress).trim();
        (groups.get(key) ?? groups.set(key, []).get(key)).push(n);
      }
      const out = [];
      for (const [ip, group] of groups) {
        if (group.length < 2) continue;
        out.push({
          ruleId: this.id,
          severity: this.severity,
          message: `IP ${ip} used by ${group.length} devices`,
          nodes: group.map((n) => n.id),
          edges: [],
          fix: { kind: 'autoAssignIp' },
        });
      }
      return out;
    },
  },
  {
    id: 'missing-can-id',
    label: 'Missing CAN ID',
    description: 'A CAN device has no CAN ID assigned.',
    severity: 'info',
    run(ctx) {
      const out = [];
      for (const n of ctx.nodes) {
        const def = ctx.defOf(n);
        if (!def?.trackedFields?.includes('canId')) continue;
        if (!isBlank(n.data.canId)) continue;
        out.push({
          ruleId: this.id,
          severity: this.severity,
          message: `${n.data.label} has no CAN ID`,
          nodes: [n.id],
          edges: [],
          fix: { kind: 'autoAssignCanId' },
        });
      }
      return out;
    },
  },

  // ---------------- Structural / connectivity (idea #1) ----------------
  {
    id: 'unconnected-can',
    label: 'Unconnected CAN device',
    description: 'A device with a CAN port has no CAN wiring.',
    severity: 'warning',
    run(ctx) {
      const out = [];
      for (const n of ctx.nodes) {
        if (!ctx.portsOfType(n, 'CAN').length) continue;
        if (ctx.typeEdges(n, 'CAN').length) continue;
        out.push({
          ruleId: this.id,
          severity: this.severity,
          message: `${n.data.label} is not on the CAN bus`,
          nodes: [n.id],
          edges: [],
        });
      }
      return out;
    },
  },
  {
    id: 'can-bus-fragmented',
    label: 'Fragmented CAN bus',
    description: 'CAN-wired devices form more than one separate bus; they should be one chain.',
    severity: 'warning',
    run(ctx) {
      // Build connectivity among CAN-capable nodes via CAN edges.
      const canNodes = new Set(ctx.nodes.filter((n) => ctx.portsOfType(n, 'CAN').length).map((n) => n.id));
      const adj = new Map();
      const add = (a, b) => {
        if (!adj.has(a)) adj.set(a, new Set());
        adj.get(a).add(b);
      };
      let canEdgeCount = 0;
      for (const e of ctx.edges) {
        if (e.data.type !== 'CAN') continue;
        if (!canNodes.has(e.source) || !canNodes.has(e.target)) continue;
        add(e.source, e.target);
        add(e.target, e.source);
        canEdgeCount++;
      }
      if (!canEdgeCount) return []; // nothing wired yet → handled by unconnected-can
      // Connected components over nodes that have at least one CAN edge.
      const wired = new Set(adj.keys());
      const seen = new Set();
      const comps = [];
      for (const start of wired) {
        if (seen.has(start)) continue;
        const stack = [start];
        const comp = [];
        seen.add(start);
        while (stack.length) {
          const cur = stack.pop();
          comp.push(cur);
          for (const nb of adj.get(cur) ?? []) {
            if (!seen.has(nb)) {
              seen.add(nb);
              stack.push(nb);
            }
          }
        }
        comps.push(comp);
      }
      if (comps.length < 2) return [];
      comps.sort((a, b) => b.length - a.length);
      const stranded = comps.slice(1).flat(); // everything outside the largest bus
      return [
        {
          ruleId: this.id,
          severity: this.severity,
          message: `CAN bus is split into ${comps.length} separate groups`,
          nodes: stranded,
          edges: [],
        },
      ];
    },
  },
  {
    id: 'unpowered-device',
    label: 'Unpowered device',
    description: 'A non-power component with a power port has no power wiring.',
    severity: 'warning',
    run(ctx) {
      const out = [];
      for (const n of ctx.nodes) {
        const def = ctx.defOf(n);
        if (!def || def.category === 'Power') continue; // skip sources/distribution
        if (!ctx.portsOfType(n, 'PWR').length) continue;
        if (ctx.typeEdges(n, 'PWR').length) continue;
        out.push({
          ruleId: this.id,
          severity: this.severity,
          message: `${n.data.label} has no power connection`,
          nodes: [n.id],
          edges: [],
        });
      }
      return out;
    },
  },
  {
    id: 'channel-oversubscribed',
    label: 'Power port overloaded',
    description: 'A single power port drives more than one wire.',
    severity: 'warning',
    run(ctx) {
      const out = [];
      for (const n of ctx.nodes) {
        for (const p of ctx.portsOfType(n, 'PWR')) {
          const es = ctx.portEdges.get(`${n.id}:${p.id}`) ?? [];
          if (es.length > 1) {
            out.push({
              ruleId: this.id,
              severity: this.severity,
              message: `${n.data.label} · ${p.label} drives ${es.length} wires`,
              nodes: [n.id],
              edges: es.map((e) => e.id),
            });
          }
        }
      }
      return out;
    },
  },
  {
    id: 'undersized-gauge',
    label: 'Undersized wire gauge',
    description:
      'A power wire’s gauge is too small for its breaker / current rating.',
    severity: 'warning',
    run(ctx) {
      const out = [];
      for (const e of ctx.edges) {
        if (e.data.type !== 'PWR') continue;
        const amps = Number(e.data.wireAmps);
        if (!Number.isFinite(amps) || amps <= 0) continue;
        const cap = ampacityForGauge(e.data.wireGauge);
        if (cap == null || cap >= amps) continue;
        const rec = minGaugeForAmps(amps);
        out.push({
          ruleId: this.id,
          severity: this.severity,
          message: `${e.data.label}: ${e.data.wireGauge} (~${cap} A) carries ${amps} A${rec ? ` — use ${rec}` : ''}`,
          nodes: [e.source, e.target],
          edges: [e.id],
        });
      }
      return out;
    },
  },
  {
    id: 'floating-component',
    label: 'Unconnected component',
    description: 'A component has no wiring at all.',
    severity: 'info',
    run(ctx) {
      const out = [];
      for (const n of ctx.nodes) {
        const connected = ctx.edges.some((e) => e.source === n.id || e.target === n.id);
        if (connected) continue;
        out.push({
          ruleId: this.id,
          severity: this.severity,
          message: `${n.data.label} is not wired to anything`,
          nodes: [n.id],
          edges: [],
        });
      }
      return out;
    },
  },
];

export const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
