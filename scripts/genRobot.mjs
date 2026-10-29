// Generator for the demo robot example (examples/example.json): Perry, team
// 3467's second 2026 (REBUILT) robot. Motors, buses and CAN IDs follow the
// robot code (Skip-5.16-Perry: Ports.java + drive/DriveConstants.java):
//   - roboRIO bus: PDH 40, flywheels 18/16/21/22 (Kraken X60), hood 19 (X60),
//     tower 20 (X44), indexer 25 + follower 26 (X44), intake linear 27 (X44),
//     intake roller 28 (X60).
//   - CANivore "Drivetrain" bus: Pigeon 2 (14) and 4 swerve modules (Kraken X60
//     drive + steer, CANcoder) — FL 4/6/5, FR 9/8/10, BL 2/1/3, BR 11/13/12.
//   - Vision: a Jetson running the c2 pipeline with 4 ThriftyCAMs.
// Wiring assumptions (not in the code): every Kraken has the WCP Powerpole
// adapter board, CAN runs on Molex SL throughout, each CANcoder takes power +
// CAN from its steer motor's adapter board, the Jetson is powered from a
// MitoCANdria, and small loads (Pigeon, MitoCANdria) hang off a REV MPM.
// Run via: npx vite-node scripts/genRobot.mjs
import fs from 'fs';
import { getDefinition } from '../src/data/componentLibrary.js';
import { endFitting } from '../src/data/wireTypes.js';

let idc = 0;
const uid = (p) => `${p}-${++idc}`;
const LAYER = { PWR: 'power', CAN: 'canbus', ETH: 'ethernet', USB: 'usb', DATA: 'data' };
const FITTING_DEFAULTS = { CAN: 'Molex SL' }; // "we used Molex SL" for CAN

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
      notes: data.notes ?? '',
      locked: false,
      canId: data.canId ?? null,
      ipAddress: data.ipAddress ?? null,
      rotation: data.rotation ?? 0,
      ports,
    },
  };
  nodes.push(n);
  return n;
}

// Port by label; `label#k` picks the k-th (0-based) port sharing that label.
function port(n, ref) {
  const [label, k = '0'] = ref.split('#');
  return n.data.ports.filter((p) => p.label === label)[Number(k)];
}

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
      wireGauge: sp.gauge ?? tp.gauge ?? null,
      wireFittingFrom: endFitting(sp, type, FITTING_DEFAULTS),
      wireFittingTo: endFitting(tp, type, FITTING_DEFAULTS),
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

// Set a protection rating (breaker or fuse) on a channel port by label.
function setRating(n, label, amps) {
  const p = port(n, label);
  if (p) p.breaker = amps;
}

// A Molex SL pigtail fitted to a port whose native termination is something
// else (Weidmuller, flying leads) — the wire then mates with the SL.
const slPigtail = (labels) => (ports) =>
  ports.map((p) => (p.type === 'CAN' && (!labels || labels.includes(p.label)) ? { ...p, installedConnector: 'Molex SL' } : p));

// ---------------- vision (far left) ----------------
const jetson = mk('jetsonorinnano', 336, 128, { label: 'Jetson (c2 vision)', ipAddress: '10.34.67.11' });
// The 4 ThriftyCAMs from vision_configs/ttb_cam_1..4, turned so their USB
// faces the Jetson.
const cams = [1, 2, 3, 4].map((i) =>
  mk('thriftycam', 64, 64 + i * 96, { label: `ThriftyCAM ${i}`, rotation: 180 })
);
// MitoCANdria powers the Jetson from its boost output (set to 19 V). It isn't
// on the robot code's CAN buses, so its CAN ports are left off here.
const mito = mk('mitocandria', 336, 384, { label: 'MitoCANdria' }, (ports) => ports.filter((p) => p.type !== 'CAN'));

// ---------------- control (centre-left) ----------------
const rio = mk('roborio2', 704, 128, { ipAddress: '10.34.67.2' }, slPigtail());
const radio = mk('vh109', 704, 336, { ipAddress: '10.34.67.1' });
// CANivore for the "Drivetrain" bus — powered over its USB link to the roboRIO.
const canivore = mk('canivore', 1472, 128, { label: 'CANivore (Drivetrain)' }, (ports) =>
  slPigtail()(ports.filter((p) => p.type !== 'PWR'))
);
// MPM beside the vision group it mostly feeds, turned so its outputs face it.
const mpm = mk('mpm', 512, 320, { label: 'MPM', rotation: 180 });

// ---------------- power ----------------
const battery = mk('battery', 64, 640, {});
const breaker = mk('mainbreaker', 288, 640, {});
const pdh = mk('pdh', 1120, 144, { canId: 40 }, slPigtail(['CAN IN']));

// ---------------- drive base (right): CANivore bus ----------------
const pigeon = mk('pigeon2', 1680, 144, { label: 'Pigeon 2', canId: 14 }, slPigtail());
const COL = [1504, 1824];
const ROW = [304, 624];
const modules = {
  FL: { x: COL[0], y: ROW[0], ids: [4, 6, 5] },
  FR: { x: COL[1], y: ROW[0], ids: [9, 8, 10] },
  BL: { x: COL[0], y: ROW[1], ids: [2, 1, 3] },
  BR: { x: COL[1], y: ROW[1], ids: [11, 13, 12] },
};
const mods = {};
for (const [name, m] of Object.entries(modules)) {
  const [driveId, steerId, encId] = m.ids;
  const drive = mk('krakenx60_adapted', m.x, m.y, { label: `${name} Drive`, canId: driveId });
  const steer = mk('krakenx60_adapted', m.x, m.y + 96, { label: `${name} Steer`, canId: steerId });
  // CANcoder fed power + CAN by the steer motor's adapter board (4-pin SL), so
  // only its CAN connection is drawn; it sits in the chain after the steer.
  const enc = mk(
    'cancoder',
    m.x + 32,
    m.y + 192,
    { label: `${name} Enc`, canId: encId },
    (ports) => ports.filter((p) => p.type === 'CAN')
  );
  mods[name] = { drive, steer, enc };
}
const term = mk('canterminator', 2048, 832, { label: 'CAN Terminator' }, slPigtail());
zone(1440, 96, 704, 848, 'Drive Base (CANivore bus)', '#3b82f6');

// ---------------- superstructure (below): roboRIO bus ----------------
// Intake turned around so its power inputs face the PDH's power fan.
const intakeRoller = mk('krakenx60_adapted', 640, 1024, { label: 'Intake Roller', canId: 28, rotation: 180 });
const intakeLinear = mk('krakenx44_adapted', 640, 1120, { label: 'Intake Linear', canId: 27, rotation: 180 });
zone(608, 976, 224, 240, 'Intake', '#22c55e');

const indexer = mk('krakenx44_adapted', 896, 1024, { label: 'Indexer', canId: 25 });
const indexerF = mk('krakenx44_adapted', 896, 1120, { label: 'Indexer Follower', canId: 26 });
const tower = mk('krakenx44_adapted', 896, 1216, { label: 'Tower', canId: 20 });
zone(864, 976, 224, 336, 'Indexer / Tower', '#eab308');

const hood = mk('krakenx60_adapted', 1152, 1024, { label: 'Hood', canId: 19 });
const flyTL = mk('krakenx60_adapted', 1152, 1120, { label: 'Flywheel TL', canId: 18 });
const flyTR = mk('krakenx60_adapted', 1152, 1216, { label: 'Flywheel TR', canId: 16 });
const flyBL = mk('krakenx60_adapted', 1152, 1312, { label: 'Flywheel BL', canId: 21 });
const flyBR = mk('krakenx60_adapted', 1152, 1408, { label: 'Flywheel BR', canId: 22 });
zone(1120, 976, 224, 528, 'Shooter', '#f97316');

// ---------------- power wiring ----------------
wire(battery, 'BAT', breaker, 'IN');
wire(breaker, 'OUT', pdh, 'PWR');
// roboRIO + radio on non-switchable 10 A mini channels (R615/R617)
setRating(pdh, 'CH20', 10);
setRating(pdh, 'CH22', 10);
wire(pdh, 'CH20', rio, 'PWR');
wire(pdh, 'CH22', radio, 'PWR');
// Swerve on the right bank, in the modules' reading order.
const drivePower = [
  ['CH0', mods.FL.drive], ['CH1', mods.FL.steer],
  ['CH2', mods.FR.drive], ['CH3', mods.FR.steer],
  ['CH4', mods.BL.drive], ['CH5', mods.BL.steer],
  ['CH6', mods.BR.drive], ['CH7', mods.BR.steer],
];
for (const [ch, motor] of drivePower) wire(pdh, ch, motor, 'PWR');
// MPM for the small loads, on its own channel.
setRating(pdh, 'CH8', 20);
wire(pdh, 'CH8', mpm, 'PWR');
setRating(mpm, 'CH0', 5);
setRating(mpm, 'CH1', 10);
wire(mpm, 'CH0', pigeon, 'PWR');
wire(mpm, 'CH1', mito, 'PWR IN');
wire(mito, '15–24V BOOST', jetson, 'PWR (Barrel)');
// Superstructure on the left bank.
const mechPower = [
  ['CH10', intakeRoller], ['CH11', intakeLinear],
  ['CH12', indexer], ['CH13', indexerF], ['CH14', tower],
  ['CH15', hood], ['CH16', flyTL], ['CH17', flyTR], ['CH18', flyBL], ['CH19', flyBR],
];
for (const [ch, motor] of mechPower) wire(pdh, ch, motor, 'PWR');

// ---------------- CAN: roboRIO bus ----------------
// roboRIO → superstructure → PDH (which terminates the far end).
const rioChain = [intakeRoller, intakeLinear, indexer, indexerF, tower, hood, flyTL, flyTR, flyBL, flyBR];
wire(rio, 'CAN', rioChain[0], 'CAN IN');
for (let i = 1; i < rioChain.length; i++) wire(rioChain[i - 1], 'CAN OUT', rioChain[i], 'CAN IN');
wire(rioChain[rioChain.length - 1], 'CAN OUT', pdh, 'CAN IN');

// ---------------- CAN: CANivore "Drivetrain" bus ----------------
// CANivore → Pigeon → each module (drive → steer → CANcoder) → terminator. The
// CANcoder's single CAN port carries both its in and out runs.
wire(canivore, 'CAN', pigeon, 'CAN');
let prev = [pigeon, 'CAN'];
for (const name of ['FL', 'BL', 'FR', 'BR']) {
  const m = mods[name];
  wire(prev[0], prev[1], m.drive, 'CAN IN');
  wire(m.drive, 'CAN OUT', m.steer, 'CAN IN');
  wire(m.steer, 'CAN OUT', m.enc, 'CAN');
  prev = [m.enc, 'CAN'];
}
wire(prev[0], prev[1], term, 'CAN');

// ---------------- network + USB ----------------
wire(rio, 'ETH', radio, 'RIO');
wire(jetson, 'ETH', radio, 'AUX1');
wire(rio, 'USB-A', canivore, 'USB-A');
cams.forEach((cam, i) => wire(jetson, `USB-A#${i}`, cam, 'USB-A'));

const project = {
  app: 'wireup',
  version: 4,
  savedAt: new Date().toISOString(),
  projectName: 'Perry — 3467 (Example)',
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
