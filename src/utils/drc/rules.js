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

// Power distribution devices (the only legal direct roboRIO/radio supplies).
const PD_DEFS = new Set(['pdh', 'pdp2', 'pdp_legacy']);

// Robot controllers (roboRIO 2, SystemCore) — same power rules (R615).
const ROBOT_CONTROLLERS = new Set(['roborio2', 'systemcore']);

// CAN controllers — each connected CAN group containing one is its own bus
// (roboRIO bus, CANivore bus, each SystemCore bus).
const CAN_CONTROLLERS = new Set(['roborio2', 'systemcore', 'canivore']);

// Controllers whose CAN ports are separate buses (SystemCore: 5 independent
// CAN-FD buses, each with built-in 120Ω termination). In the CAN graph each
// such port becomes its own vertex `${nodeId}#${portId}`.
const MULTI_BUS = new Set(['systemcore']);
const baseId = (id) => id.split('#')[0];

// Devices that report the same CAN device class share one ID space, so the
// same ID on any of them collides. Default class = the definitionId.
const CAN_DEVICE_CLASS = {
  krakenx60: 'talonfx',
  krakenx44: 'talonfx',
  krakenx60_adapted: 'talonfx',
  krakenx44_adapted: 'talonfx',
  sparkmax: 'spark',
  sparkflex: 'spark',
};
const canClassOf = (definitionId) => CAN_DEVICE_CLASS[definitionId] ?? definitionId;

function pluralDef(count, name) {
  return `${count}× ${name}`;
}

// The port's label as defined by its component definition (matched by port
// id), so renamed ports are still recognized. Falls back to the live label.
function defLabel(def, port) {
  return def?.defaultPorts?.find((dp) => dp.id === port.id)?.label ?? port.label;
}

// The roboRIO's RSL output is modelled as a PWR port but is not a power input.
const isRslPort = (def, port) => ROBOT_CONTROLLERS.has(def?.id) && defLabel(def, port) === 'RSL';

// PD output channel number for a port (by its index among the definition's
// breaker/fuse channel ports), or null if it isn't a channel. Falls back to a
// `CHn` label for ports the definition doesn't know about.
function pdChannel(def, port) {
  const channels = (def?.defaultPorts ?? []).filter((dp) => dp.slot);
  const i = channels.findIndex((dp) => dp.id === port.id);
  if (i >= 0) return i;
  const m = /^CH(\d+)$/.exec(port.label ?? '');
  return m ? Number(m[1]) : null;
}

// CAN connectivity: connected groups of CAN-wired nodes plus the number of CAN
// links on each node (counted per node, not per port — a daisy-chained device
// may run both its in and out wires from one CAN port).
function canGraph(ctx) {
  const canNodes = new Set(ctx.nodes.filter((n) => ctx.portsOfType(n, 'CAN').length).map((n) => n.id));
  const multi = new Set(ctx.nodes.filter((n) => MULTI_BUS.has(ctx.defOf(n)?.id)).map((n) => n.id));
  const vertex = (nodeId, portId) => (multi.has(nodeId) ? `${nodeId}#${portId}` : nodeId);
  const adj = new Map();
  const links = new Map();
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
    links.set(a, (links.get(a) ?? 0) + 1);
  };
  for (const e of ctx.edges) {
    if (e.data.type !== 'CAN' || e.source === e.target) continue;
    if (!canNodes.has(e.source) || !canNodes.has(e.target)) continue;
    const a = vertex(e.source, e.sourceHandle);
    const b = vertex(e.target, e.targetHandle);
    add(a, b);
    add(b, a);
  }
  const seen = new Set();
  const comps = [];
  for (const start of adj.keys()) {
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
  return { comps, links };
}

export const DRC_RULES = [
  // ---------------- CAN ID / IP conflicts (idea #2) ----------------
  {
    id: 'duplicate-can-id',
    label: 'Duplicate CAN ID',
    description:
      'Two or more devices of the same CAN device class share a CAN ID on one bus. IDs must be unique within a device class on a bus.',
    severity: 'error',
    run(ctx) {
      // Bus of each wired node = its connected CAN group. Unwired devices are
      // assumed to be headed for the roboRIO bus.
      const { comps } = canGraph(ctx);
      const busOf = new Map();
      let rioBus = '';
      comps.forEach((comp, i) => {
        for (const id of comp) busOf.set(id, String(i));
        if (!rioBus && comp.some((id) => ROBOT_CONTROLLERS.has(ctx.defOf(ctx.nodeById.get(baseId(id)))?.id)))
          rioBus = String(i);
      });
      const groups = new Map(); // `${class}::${bus}::${canId}` -> nodes[]
      for (const n of ctx.nodes) {
        const def = ctx.defOf(n);
        if (!def?.trackedFields?.includes('canId')) continue;
        if (isBlank(n.data.canId)) continue;
        const key = `${canClassOf(n.data.definitionId)}::${busOf.get(n.id) ?? rioBus}::${String(n.data.canId).trim()}`;
        (groups.get(key) ?? groups.set(key, []).get(key)).push(n);
      }
      const out = [];
      for (const [, group] of groups) {
        if (group.length < 2) continue;
        const names = [...new Set(group.map((n) => ctx.defOf(n)?.name ?? 'device'))].join(' / ');
        out.push({
          ruleId: this.id,
          severity: this.severity,
          message: `CAN ID ${group[0].data.canId} used by ${pluralDef(group.length, names)}`,
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
        if (!ctx.portsOfType(n, 'CAN').length) continue; // CAN not in use on this unit
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
    description:
      'CAN-wired devices form a separate group with no controller. Each bus must reach a roboRIO or CANivore (a CANivore bus is legitimately separate).',
    severity: 'warning',
    run(ctx) {
      // Nothing wired yet → handled by unconnected-can. A single group without a
      // controller is reported by can-termination.
      const { comps } = canGraph(ctx);
      if (comps.length < 2) return [];
      // Every group holding a controller is a legitimate bus; only the rest are stranded.
      const stray = comps.filter(
        (comp) => !comp.some((id) => CAN_CONTROLLERS.has(ctx.defOf(ctx.nodeById.get(baseId(id)))?.id))
      );
      if (!stray.length) return [];
      return [
        {
          ruleId: this.id,
          severity: this.severity,
          message: `CAN bus is split — ${stray.length} group${stray.length === 1 ? '' : 's'} not connected to a robot controller or CANivore`,
          nodes: [...new Set(stray.flat().map(baseId))],
          edges: [],
        },
      ];
    },
  },
  {
    id: 'can-termination',
    label: 'CAN bus termination',
    description:
      'A CAN bus must include a controller (roboRIO/SystemCore/CANivore), be a single daisy chain, and be terminated at exactly its two ends by a roboRIO, PDH/PDP, CANivore, or 120Ω terminator (R-spec / hardware).',
    severity: 'warning',
    run(ctx) {
      // Fixed termination (can't be disabled) — must sit at a bus end.
      const FIXED_TERM = new Set(['roborio2', 'systemcore', 'canterminator']);
      // End-of-bus termination (switch/jumper/built-in) — counts only at an end.
      const END_TERM = new Set(['canivore', 'pdh', 'pdp2', 'pdp_legacy']);
      const { comps, links } = canGraph(ctx);
      const nodeOf = (id) => ctx.nodeById.get(baseId(id));
      const defId = (id) => ctx.defOf(nodeOf(id))?.id;
      // a SystemCore bus vertex reads as "SystemCore CAN 2"
      const labelOf = (id) => {
        const n = nodeOf(id);
        const port = id.includes('#') ? n?.data.ports.find((p) => p.id === id.split('#')[1]) : null;
        return `${n?.data.label ?? 'device'}${port ? ` ${port.label}` : ''}`;
      };
      const flagged = (id) => nodeOf(id)?.data.canTermination === true; // optional per-device flag
      const out = [];
      const flag = (message, nodes) =>
        out.push({ ruleId: this.id, severity: this.severity, message, nodes: [...new Set(nodes.map(baseId))], edges: [] });

      for (const comp of comps) {
        // The bus must start at a controller (roboRIO, SystemCore or CANivore).
        if (!comp.some((id) => CAN_CONTROLLERS.has(defId(id)))) {
          flag('CAN bus has no controller — it must connect to a robot controller or CANivore', comp);
        }
        let terminated = 0;
        let looseEnd = false;
        for (const id of comp) {
          const n = links.get(id) ?? 0;
          const d = defId(id);
          const fixed = FIXED_TERM.has(d) || flagged(id);
          if (fixed || (n === 1 && END_TERM.has(d))) terminated++;
          // Each physical end of the chain (a single CAN link) must be a terminator.
          if (n === 1 && !fixed && !END_TERM.has(d)) {
            looseEnd = true;
            flag(`CAN bus is unterminated at ${labelOf(id)} — end it on a PDH/roboRIO/CANivore or add a 120Ω terminator`, [id]);
          }
          // Built-in termination that can't be disabled must be at an end.
          if (FIXED_TERM.has(d) && n >= 2) {
            flag(`${labelOf(id)} is mid-chain — its fixed 120Ω termination must be at a bus end`, [id]);
          }
          // A third link on one device is a stub/branch, not a daisy chain.
          if (n >= 3) {
            flag(`${labelOf(id)} has ${n} CAN links — the bus must be a single daisy chain (no stubs)`, [id]);
          }
        }
        // Exactly two terminating ends (≈60Ω across H/L). Too few with a loose
        // end is already reported above.
        if (terminated > 2 || (terminated < 2 && !looseEnd)) {
          flag(`CAN bus has ${terminated} terminations — it needs exactly 2 (one at each end)`, comp);
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
        // Power inputs only — the roboRIO's RSL output doesn't power it.
        const inputs = new Set(ctx.portsOfType(n, 'PWR').filter((p) => !isRslPort(def, p)).map((p) => p.id));
        if (!inputs.size) continue;
        const fed = ctx
          .typeEdges(n, 'PWR')
          .some((e) => inputs.has(e.source === n.id ? e.sourceHandle : e.targetHandle));
        if (fed) continue;
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
        if (!ROBOT_CONTROLLERS.has(ctx.defOf(n)?.id)) continue;
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
    id: 'roborio-power-source',
    label: 'roboRIO not powered from the PD',
    description: 'The roboRIO must be powered directly from a PDH/PDP channel (R615).',
    severity: 'warning',
    run(ctx) {
      const out = [];
      for (const n of ctx.nodes) {
        const def = ctx.defOf(n);
        if (!ROBOT_CONTROLLERS.has(def?.id)) continue;
        for (const e of ctx.typeEdges(n, 'PWR')) {
          const mine = e.source === n.id ? e.sourceHandle : e.targetHandle;
          const port = n.data.ports.find((p) => p.id === mine);
          if (port && isRslPort(def, port)) continue; // RSL output, not the power input
          const otherId = e.source === n.id ? e.target : e.source;
          const other = ctx.nodeById.get(otherId);
          if (PD_DEFS.has(ctx.defOf(other)?.id)) continue;
          out.push({
            ruleId: this.id,
            severity: this.severity,
            message: `${n.data.label} is powered from ${other?.data.label ?? 'a non-PD device'} — R615 requires a direct PDH/PDP channel`,
            nodes: [n.id, otherId],
            edges: [e.id],
          });
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
      const LEGAL = new Set([20, 21, 22]);
      for (const n of ctx.nodes) {
        if (!ROBOT_CONTROLLERS.has(ctx.defOf(n)?.id)) continue;
        for (const e of ctx.edges) {
          if (e.data.type !== 'PWR') continue;
          const otherId = e.source === n.id ? e.target : e.target === n.id ? e.source : null;
          if (!otherId) continue;
          const otherDef = ctx.defOf(ctx.nodeById.get(otherId));
          if (otherDef?.id !== 'pdh') continue; // PDP 2.0 allows any channel
          const otherHandle = e.source === n.id ? e.targetHandle : e.sourceHandle;
          const port = ctx.nodeById.get(otherId)?.data.ports.find((p) => p.id === otherHandle);
          // Channel by port index (not label) so renamed ports are still checked.
          const ch = port ? pdChannel(otherDef, port) : null;
          if (ch != null && !LEGAL.has(ch)) {
            out.push({
              ruleId: this.id,
              severity: this.severity,
              message: `${n.data.label} is on PDH CH${ch}${port.label !== `CH${ch}` ? ` (${port.label})` : ''} — use a non-switchable channel (CH20–CH22) per R615`,
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
      const PD = PD_DEFS;
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
          if (!fitting) return;
          // An installed connector (pigtail soldered to the port) overrides the
          // port's native requiredFittings — the wire must mate with it instead.
          if (port?.installedConnector && port.installedConnector !== 'Bare Wire') {
            if (fitting !== port.installedConnector) {
              out.push({
                ruleId: this.id,
                severity: this.severity,
                message: `${node.data.label} · ${port.label} has a ${port.installedConnector} installed — wire has ${fitting}`,
                nodes: [nodeId],
                edges: [e.id],
              });
            }
            return;
          }
          const req = port?.requiredFittings;
          if (!req?.length) return;
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
