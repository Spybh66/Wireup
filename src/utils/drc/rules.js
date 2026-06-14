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

import { awgNumber, requiredAwgForBreaker, requiredGaugeForBreaker } from '../../data/wireTypes';

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

// Components that form the protected main power run (R609).
const MAIN_RUN_DEFS = new Set(['battery', 'mainbreaker', 'pdh', 'pdp2', 'pdp_legacy']);

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
    id: 'can-termination',
    label: 'CAN bus termination',
    description:
      'A CAN bus must include a controller (roboRIO/CANivore) and be terminated at each end by a PDH, CANivore, or 120Ω terminator (R-spec / hardware).',
    severity: 'warning',
    run(ctx) {
      const CONTROLLERS = new Set(['roborio2', 'canivore']);
      const TERMINATORS = new Set(['roborio2', 'canivore', 'pdh', 'pdp2', 'pdp_legacy', 'canterminator']);
      const canNodes = new Set(ctx.nodes.filter((n) => ctx.portsOfType(n, 'CAN').length).map((n) => n.id));
      const adj = new Map();
      const deg = new Map();
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
        deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
        deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
        canEdgeCount++;
      }
      if (!canEdgeCount) return [];
      const defId = (id) => ctx.defOf(ctx.nodeById.get(id))?.id;
      const labelOf = (id) => ctx.nodeById.get(id)?.data.label ?? 'device';

      const seen = new Set();
      const out = [];
      for (const start of adj.keys()) {
        if (seen.has(start)) continue;
        const comp = [];
        const stack = [start];
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
        // The bus must start at a controller (roboRIO or CANivore).
        if (!comp.some((id) => CONTROLLERS.has(defId(id)))) {
          out.push({
            ruleId: this.id,
            severity: this.severity,
            message: 'CAN bus has no controller — it must connect to a roboRIO or CANivore',
            nodes: comp,
            edges: [],
          });
        }
        // Each physical end of the chain (a single CAN link) must be a terminator.
        for (const id of comp) {
          if ((deg.get(id) ?? 0) === 1 && !TERMINATORS.has(defId(id))) {
            out.push({
              ruleId: this.id,
              severity: this.severity,
              message: `CAN bus is unterminated at ${labelOf(id)} — end it on a PDH/roboRIO/CANivore or add a 120Ω terminator`,
              nodes: [id],
              edges: [],
            });
          }
        }
      }
      return out;
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
      'A branch wire’s gauge is thinner than FRC R622 requires for the breaker protecting it (set the breaker on the PDH/MPM port).',
    severity: 'warning',
    run(ctx) {
      const out = [];
      const breakerOf = (nodeId, portId) => {
        const node = ctx.nodeById.get(nodeId);
        const port = node?.data.ports.find((p) => p.id === portId);
        const v = Number(port?.breaker);
        return Number.isFinite(v) && v > 0 ? v : 0;
      };
      for (const e of ctx.edges) {
        if (e.data.type !== 'PWR') continue;
        const amps = Math.max(breakerOf(e.source, e.sourceHandle), breakerOf(e.target, e.targetHandle));
        if (amps <= 0) continue;
        const reqAwg = requiredAwgForBreaker(amps);
        const wireAwg = awgNumber(e.data.wireGauge);
        if (reqAwg == null || wireAwg == null || wireAwg <= reqAwg) continue; // adequate
        out.push({
          ruleId: this.id,
          severity: this.severity,
          message: `${e.data.label}: ${e.data.wireGauge} on a ${amps} A breaker — R622 needs ${requiredGaugeForBreaker(amps)} or thicker`,
          nodes: [e.source, e.target],
          edges: [e.id],
        });
      }
      return out;
    },
  },
  {
    id: 'main-run-gauge',
    label: 'Main power run too thin',
    description: 'Battery ↔ main breaker ↔ power distribution wiring must be 6 AWG or thicker (R609).',
    severity: 'warning',
    run(ctx) {
      const out = [];
      for (const e of ctx.edges) {
        if (e.data.type !== 'PWR') continue;
        const sDef = ctx.defOf(ctx.nodeById.get(e.source))?.id;
        const tDef = ctx.defOf(ctx.nodeById.get(e.target))?.id;
        if (!MAIN_RUN_DEFS.has(sDef) || !MAIN_RUN_DEFS.has(tDef)) continue;
        const awg = awgNumber(e.data.wireGauge);
        if (awg == null || awg <= 6) continue; // 6 AWG or thicker is fine
        out.push({
          ruleId: this.id,
          severity: this.severity,
          message: `${e.data.label}: main power run is ${e.data.wireGauge} — R609 requires 6 AWG or thicker`,
          nodes: [e.source, e.target],
          edges: [e.id],
        });
      }
      return out;
    },
  },
  {
    id: 'breaker-too-large',
    label: 'Breaker over 40 A',
    description: 'A power-distribution branch breaker exceeds the 40 A maximum (R619).',
    severity: 'error',
    run(ctx) {
      const out = [];
      for (const n of ctx.nodes) {
        for (const p of ctx.portsOfType(n, 'PWR')) {
          const v = Number(p.breaker);
          if (Number.isFinite(v) && v > 40) {
            out.push({
              ruleId: this.id,
              severity: this.severity,
              message: `${n.data.label} · ${p.label}: ${v} A breaker exceeds the 40 A branch limit`,
              nodes: [n.id],
              edges: [],
            });
          }
        }
      }
      return out;
    },
  },
  {
    id: 'roborio-power-breaker',
    label: 'roboRIO not on a 10 A circuit',
    description: 'The roboRIO must be powered from a dedicated 10 A circuit (R615).',
    severity: 'warning',
    run(ctx) {
      const out = [];
      for (const n of ctx.nodes) {
        if (ctx.defOf(n)?.id !== 'roborio2') continue;
        for (const e of ctx.edges) {
          if (e.data.type !== 'PWR') continue;
          const otherId = e.source === n.id ? e.target : e.target === n.id ? e.source : null;
          if (!otherId) continue;
          const otherHandle = e.source === n.id ? e.targetHandle : e.sourceHandle;
          const port = ctx.nodeById.get(otherId)?.data.ports.find((p) => p.id === otherHandle);
          const v = Number(port?.breaker);
          if (Number.isFinite(v) && v > 0 && v !== 10) {
            out.push({
              ruleId: this.id,
              severity: this.severity,
              message: `${n.data.label} is on a ${v} A circuit — R615 requires a dedicated 10 A breaker`,
              nodes: [n.id, otherId],
              edges: [e.id],
            });
          }
        }
      }
      return out;
    },
  },
  {
    id: 'roborio-channel',
    label: 'roboRIO on an illegal PD channel',
    description:
      'On a PDH the roboRIO must be powered from a non-switchable channel — CH20, CH21, or CH22 (R615).',
    severity: 'warning',
    run(ctx) {
      const out = [];
      const LEGAL = new Set(['CH20', 'CH21', 'CH22']);
      for (const n of ctx.nodes) {
        if (ctx.defOf(n)?.id !== 'roborio2') continue;
        for (const e of ctx.edges) {
          if (e.data.type !== 'PWR') continue;
          const otherId = e.source === n.id ? e.target : e.target === n.id ? e.source : null;
          if (!otherId) continue;
          if (ctx.defOf(ctx.nodeById.get(otherId))?.id !== 'pdh') continue; // PDP 2.0 allows any channel
          const otherHandle = e.source === n.id ? e.targetHandle : e.sourceHandle;
          const port = ctx.nodeById.get(otherId)?.data.ports.find((p) => p.id === otherHandle);
          if (port && /^CH\d+$/.test(port.label) && !LEGAL.has(port.label)) {
            out.push({
              ruleId: this.id,
              severity: this.severity,
              message: `${n.data.label} is on PDH ${port.label} — use a non-switchable channel (CH20–CH22) per R615`,
              nodes: [n.id, otherId],
              edges: [e.id],
            });
          }
        }
      }
      return out;
    },
  },
  {
    id: 'radio-power',
    label: 'Radio power',
    description:
      'The VH-109 radio must be powered directly from the PD on a 10 A circuit — VRM/RPM are not legal radio supplies in 2026 (R616/R617).',
    severity: 'warning',
    run(ctx) {
      const out = [];
      const PD = new Set(['pdh', 'pdp2', 'pdp_legacy']);
      for (const n of ctx.nodes) {
        if (ctx.defOf(n)?.id !== 'vh109') continue;
        for (const e of ctx.edges) {
          if (e.data.type !== 'PWR') continue;
          const otherId = e.source === n.id ? e.target : e.target === n.id ? e.source : null;
          if (!otherId) continue;
          const otherNode = ctx.nodeById.get(otherId);
          const otherDef = ctx.defOf(otherNode)?.id;
          if (otherDef === 'vrm' || otherDef === 'rpm') {
            out.push({
              ruleId: this.id,
              severity: this.severity,
              message: `${n.data.label} is powered via ${otherNode.data.label} — radios must be powered directly from the PD (R616)`,
              nodes: [n.id, otherId],
              edges: [e.id],
            });
          } else if (PD.has(otherDef)) {
            const handle = e.source === n.id ? e.targetHandle : e.sourceHandle;
            const port = otherNode?.data.ports.find((p) => p.id === handle);
            const v = Number(port?.breaker);
            if (Number.isFinite(v) && v > 0 && v !== 10) {
              out.push({
                ruleId: this.id,
                severity: this.severity,
                message: `${n.data.label} radio circuit is ${v} A — R617 requires 10 A`,
                nodes: [n.id, otherId],
                edges: [e.id],
              });
            }
          }
        }
      }
      return out;
    },
  },
  {
    id: 'power-system',
    label: 'Power system completeness',
    description:
      'A robot needs exactly one battery and one 120 A main breaker, and a power distribution device (R601/R612/R613).',
    severity: 'warning',
    run(ctx) {
      const PD = new Set(['pdh', 'pdp2', 'pdp_legacy']);
      const batteries = ctx.nodes.filter((n) => ctx.defOf(n)?.id === 'battery');
      const breakers = ctx.nodes.filter((n) => ctx.defOf(n)?.id === 'mainbreaker');
      const pds = ctx.nodes.filter((n) => PD.has(ctx.defOf(n)?.id));
      if (!batteries.length && !pds.length) return []; // no power system started yet
      const out = [];
      const flag = (message, nodes) => out.push({ ruleId: this.id, severity: this.severity, message, nodes, edges: [] });
      if (batteries.length > 1) flag(`More than one battery (${batteries.length}) — only one is legal (R601)`, batteries.map((n) => n.id));
      if (batteries.length) {
        if (breakers.length === 0) flag('No 120 A main breaker between the battery and PD (R612)', batteries.map((n) => n.id));
        else if (breakers.length > 1) flag(`More than one main breaker (${breakers.length}) — only one is allowed (R612)`, breakers.map((n) => n.id));
        if (pds.length === 0) flag('No power distribution device (PDH/PDP) found (R613)', batteries.map((n) => n.id));
      }
      return out;
    },
  },
  {
    id: 'connector-mismatch',
    label: 'Wrong connector type',
    description:
      'A wire fitting at one end does not match what the connected port requires (e.g. ring terminal on a PDH channel instead of ferrule).',
    severity: 'warning',
    run(ctx) {
      const out = [];
      for (const e of ctx.edges) {
        const fittingFrom = e.data.wireFittingFrom ?? e.data.wireFitting ?? null;
        const fittingTo   = e.data.wireFittingTo   ?? e.data.wireFitting ?? null;

        const check = (nodeId, portId, fitting) => {
          const node = ctx.nodeById.get(nodeId);
          const port = node?.data.ports.find((p) => p.id === portId);
          const req = port?.requiredFittings;
          if (!req?.length || !fitting) return;
          if (!req.includes(fitting)) {
            out.push({
              ruleId: this.id,
              severity: this.severity,
              message: `${node.data.label} · ${port.label} requires ${req.join(' or ')} — wire has ${fitting}`,
              nodes: [nodeId],
              edges: [e.id],
            });
          }
        };

        check(e.source, e.sourceHandle, fittingFrom);
        check(e.target, e.targetHandle, fittingTo);
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
