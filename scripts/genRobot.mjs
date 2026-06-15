// Generator for the demo robot example (examples/example.json).
// Builds a basic swerve robot: battery → main breaker → PDH, roboRIO + radio,
// and a drive-base zone with 4 swerve modules (Kraken X60 drive + X44 steer +
// CANcoder). Run via: npx vite-node scripts/genRobot.mjs
import fs from 'fs';
import { getDefinition } from '../src/data/componentLibrary.js';

let idc = 0;
const uid = (p) => `${p}-${++idc}`;
const LAYER = { PWR: 'power', CAN: 'canbus', ETH: 'ethernet', USB: 'usb', DATA: 'data' };

const nodes = [];
const edges = [];
const counters = { PWR: 0, CAN: 0, ETH: 0, USB: 0, DATA: 0 };

function mk(defId, x, y, data = {}, portPatch = null) {
  const def = getDefinition(defId);
  let ports = def.defaultPorts.map((p) => ({ ...p, id: uid(`${defId}-p`) }));
  if (portPatch) ports = portPatch(ports);
  const n = {
    id: uid(defId),
    type: 'component',
    position: { x, y },
    draggable: true,
    data: {
      definitionId: defId,
      label: data.label ?? def.name,
      color: data.color ?? null,
      notes: '',
      locked: false,
      canId: data.canId ?? null,
      ipAddress: data.ipAddress ?? null,
      ports,
    },
  };
  nodes.push(n);
  return n;
}

const port = (n, label) => n.data.ports.find((p) => p.label === label);

function wire(srcN, srcLabel, tgtN, tgtLabel) {
  const sp = port(srcN, srcLabel);
  const tp = port(tgtN, tgtLabel);
  if (!sp || !tp) throw new Error(`missing port ${srcLabel}->${tgtLabel} on ${srcN.data.label}/${tgtN.data.label}`);
  const type = sp.type;
  const idx = (counters[type] += 1);
  edges.push({
    id: uid('e'),
    source: srcN.id,
    target: tgtN.id,
    sourceHandle: sp.id,
    targetHandle: tp.id,
    type: 'wire',
    data: {
      type,
      layerId: LAYER[type],
      color: null,
      color2: null,
      wireGauge: sp.gauge ?? null,
      wireFittingFrom: sp.fitting ?? null,
      wireFittingTo: tp.fitting ?? null,
      label: `${type}${String(idx).padStart(3, '0')}`,
      labelEdited: false,
      length: null,
      notes: '',
      manual: false,
      waypoints: [],
    },
  });
}

function zone(x, y, w, h, text, color) {
  nodes.push({
    id: uid('zone'),
    type: 'zone',
    position: { x, y },
    draggable: true,
    zIndex: -1,
    data: { text, color, width: w, height: h },
  });
}

// Set a PDH channel's breaker rating by label.
function setBreaker(pdhNode, label, amps) {
  const p = port(pdhNode, label);
  if (p) p.breaker = amps;
}

// ---------------- electronics bay (left) ----------------
const battery = mk('battery', 64, 612, {});
const breaker = mk('mainbreaker', 288, 620, {});
const pdh = mk('pdh', 520, 120, { canId: 1 });
const rio = mk('roborio2', 96, 120, { ipAddress: '10.0.0.2' });
const radio = mk('vh109', 96, 320, { ipAddress: '10.0.0.1' });

// ---------------- drive base (right): 4 swerve modules ----------------
const COL = [960, 1240];
const ROW = [160, 470];
const corners = {
  FL: { x: COL[0], y: ROW[0] },
  FR: { x: COL[1], y: ROW[0] },
  BL: { x: COL[0], y: ROW[1] },
  BR: { x: COL[1], y: ROW[1] },
};

let canId = 10;
const mods = {};
for (const [name, c] of Object.entries(corners)) {
  const drive = mk('krakenx60', c.x, c.y, { label: `${name} Drive`, canId: canId++ });
  const steer = mk('krakenx44', c.x, c.y + 96, { label: `${name} Steer`, canId: canId++ });
  // CANcoder is powered over the CAN bus → keep only its CAN port.
  const enc = mk('cancoder', c.x + 10, c.y + 192, { label: `${name} Enc`, canId: canId++ },
    (ports) => ports.filter((p) => p.type === 'CAN'));
  mods[name] = { name, ...c, drive, steer, enc };
}

const term = mk('canterminator', 1268, 724, {});

// drive-base zone behind the modules
zone(912, 120, 480, 660, 'Drive Base', '#3b82f6');

// ---------------- power wiring ----------------
wire(battery, 'BAT', breaker, 'IN');
wire(breaker, 'OUT', pdh, 'PWR');
// roboRIO + radio on non-switchable 10 A channels (R615/R617)
setBreaker(pdh, 'CH20', 10);
setBreaker(pdh, 'CH22', 10);
wire(pdh, 'CH20', rio, 'PWR');
wire(pdh, 'CH22', radio, 'PWR');
// each module's drive (X60) + steer (X44) on its own 40 A channel. Assign by
// proximity: left column (FL,BL) on the lower-numbered right-side channels.
const powerCh = {
  FL: ['CH0', 'CH1'],
  BL: ['CH2', 'CH3'],
  FR: ['CH4', 'CH5'],
  BR: ['CH6', 'CH7'],
};
for (const [name, [dCh, sCh]] of Object.entries(powerCh)) {
  wire(pdh, dCh, mods[name].drive, 'PWR');
  wire(pdh, sCh, mods[name].steer, 'PWR');
}

// ---------------- CAN bus (daisy chain) ----------------
// rio → (drive → steer → enc) per module → terminator. Snake by column so each
// hop is short: down the left column, across, up the right column. The
// CANcoder's single CAN port is used twice (in + out) so it sits mid-chain
// instead of being a loose end (which would fail CAN termination).
const order = ['FL', 'BL', 'FR', 'BR'];
const chain = [];
for (const name of order) {
  const m = mods[name];
  chain.push([m.drive, 'CAN IN', 'CAN OUT']);
  chain.push([m.steer, 'CAN IN', 'CAN OUT']);
  chain.push([m.enc, 'CAN', 'CAN']);
}
// rio → PDH (REV PDH reports current over CAN) → drive base → terminator.
wire(rio, 'CAN', pdh, 'CAN IN');
let prev = [pdh, null, 'CAN OUT'];
for (const cur of chain) {
  wire(prev[0], prev[2], cur[0], cur[1]);
  prev = cur;
}
wire(prev[0], prev[2], term, 'CAN');

// ---------------- network ----------------
wire(rio, 'ETH', radio, 'RIO');

const project = {
  app: 'wireup',
  version: 2,
  savedAt: new Date().toISOString(),
  projectName: 'Swerve Robot (Example)',
  nodes,
  edges,
  layers: [
    { id: 'power', name: 'Power', visible: true, builtIn: true },
    { id: 'canbus', name: 'CAN Bus', visible: true, builtIn: true },
    { id: 'ethernet', name: 'Ethernet', visible: true, builtIn: true },
    { id: 'usb', name: 'USB', visible: true, builtIn: true },
    { id: 'data', name: 'Data', visible: true, builtIn: true },
  ],
  wireLabelTemplate: '{type}{index}',
  customDefinitions: [],
};

fs.writeFileSync('examples/example.json', JSON.stringify(project, null, 2));
console.log(`wrote examples/example.json: ${nodes.length} nodes, ${edges.length} edges`);
