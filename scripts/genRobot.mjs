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
// adapter board, CAN runs on Molex SL throughout and daisy-chains through each
// CANcoder, the four CANcoders and the Pigeon are powered from a REV MPM, the
// Jetson is powered from a MitoCANdria, and every other load is fed straight
// from the PDH channel nearest it (the MitoCANdria on the switchable mini fuse).
// Run via: npx vite-node scripts/genRobot.mjs
// Check it with: npx vite-node scripts/renderProject.mjs examples/example.json out.png
// (needs @resvg/resvg-js installed).
import fs from 'fs';
import { getDefinition } from '../src/data/componentLibrary.js';
import { endFitting } from '../src/data/wireTypes.js';
import { portPosition } from '../src/utils/geometry.js';

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

// Layout: the PDH sits in the middle turned 180°, so each bank faces the loads
// it feeds — the superstructure on its left (CH0–9), the swerve modules on its
// right (CH11–18, their MPM on CH19), the battery feed on top and the
// roboRIO/radio/MitoCANdria fuses along the bottom. Motors face their power side toward the PDH and keep CAN
// on the outside edge, where the daisy chains run clear of the power fans.

// ---------------- power ----------------
const pdh = mk('pdh', 640, 576, { canId: 40, rotation: 180 }, slPigtail(['CAN IN', 'CAN OUT']));
// Main breaker stood upright right over the PDH's input, battery beside it.
const breaker = mk('mainbreaker', 736, 384, { rotation: 90 });
const battery = mk('battery', 848, 224, { rotation: 180 });

// ---------------- superstructure (left): roboRIO bus ----------------
// Turned so power faces the PDH's left bank; stacked in channel order.
const SX = 320;
const intakeRoller = mk('krakenx60_adapted', SX, 320, { label: 'Intake Roller', canId: 28, rotation: 180 });
const intakeLinear = mk('krakenx44_adapted', SX, 400, { label: 'Intake Linear', canId: 27, rotation: 180 });
zone(272, 280, 240, 200, 'Intake', '#22c55e');
const indexer = mk('krakenx44_adapted', SX, 536, { label: 'Indexer', canId: 25, rotation: 180 });
const indexerF = mk('krakenx44_adapted', SX, 616, { label: 'Indexer Follower', canId: 26, rotation: 180 });
const tower = mk('krakenx44_adapted', SX, 696, { label: 'Tower', canId: 20, rotation: 180 });
zone(272, 496, 240, 280, 'Indexer / Tower', '#eab308');
const hood = mk('krakenx60_adapted', SX, 832, { label: 'Hood', canId: 19, rotation: 180 });
const flyTL = mk('krakenx60_adapted', SX, 912, { label: 'Flywheel TL', canId: 18, rotation: 180 });
const flyTR = mk('krakenx60_adapted', SX, 992, { label: 'Flywheel TR', canId: 16, rotation: 180 });
const flyBL = mk('krakenx60_adapted', SX, 1072, { label: 'Flywheel BL', canId: 21, rotation: 180 });
const flyBR = mk('krakenx60_adapted', SX, 1152, { label: 'Flywheel BR', canId: 22, rotation: 180 });
zone(272, 792, 240, 440, 'Shooter', '#f97316');
const mech = [intakeRoller, intakeLinear, indexer, indexerF, tower, hood, flyTL, flyTR, flyBL, flyBR];

// ---------------- drive base (right): CANivore bus ----------------
// Each module: drive over steer, with its CANcoder beside the gap below the
// steer, turned so its two CAN leads face the motors' CAN column (in from the
// steer above, out to the next drive below) and its power lead points up to
// the MPM that feeds all four.
const DX = 992;
const modules = {
  FL: { y: 384, ids: [4, 6, 5] },
  FR: { y: 592, ids: [9, 8, 10] },
  BL: { y: 800, ids: [2, 1, 3] },
  BR: { y: 1008, ids: [11, 13, 12] },
};
const mods = {};
for (const [name, m] of Object.entries(modules)) {
  const [driveId, steerId, encId] = m.ids;
  const drive = mk('krakenx60_adapted', DX, m.y, { label: `${name} Drive`, canId: driveId });
  const steer = mk('krakenx60_adapted', DX, m.y + 80, { label: `${name} Steer`, canId: steerId });
  // CANcoder: sits in the chain after the steer, powered from the MPM.
  const enc = mk('cancoder', DX + 224, m.y + 96, { label: `${name} Enc`, canId: encId, rotation: 90 });
  mods[name] = { drive, steer, enc };
}
const term = mk('canterminator', DX + 208, 368, { label: 'CAN Terminator' }, slPigtail());
// CANivore for the "Drivetrain" bus — powered over its USB link to the roboRIO.
const canivore = mk('canivore', DX + 16, 1264, { label: 'CANivore (Drivetrain)' }, (ports) =>
  slPigtail()(ports.filter((p) => p.type !== 'PWR'))
);
const pigeon = mk('pigeon2', DX + 208, 1264, { label: 'Pigeon 2', canId: 14, rotation: 90 }, slPigtail());
// MPM for the CANcoders and Pigeon, turned so its outputs face them.
const mpm = mk('mpm', DX + 384, 352, { label: 'MPM', rotation: 180 });
zone(960, 336, 560, 1040, 'Drive Base (CANivore bus)', '#3b82f6');

// ---------------- control + vision (below the PDH) ----------------
const rio = mk('roborio2', 736, 1296, { ipAddress: '10.34.67.2' }, slPigtail());
const radio = mk('vh109', 512, 1312, { ipAddress: '10.34.67.1', rotation: 180 });
const jetson = mk('jetsonorinnano', 272, 1328, { label: 'Jetson (c2 vision)', ipAddress: '10.34.67.11' });
// The 4 ThriftyCAMs from vision_configs/ttb_cam_1..4, in a row under the
// Jetson, turned so their USB faces it.
const cams = [1, 2, 3, 4].map((i) => mk('thriftycam', 96 + i * 80, 1520, { label: `ThriftyCAM ${i}`, rotation: 90 }));
// MitoCANdria powers the Jetson from its boost output (set to 19 V). It isn't
// on the robot code's CAN buses, so its CAN ports are left off here.
const mito = mk('mitocandria', 64, 1344, { label: 'MitoCANdria' }, (ports) => ports.filter((p) => p.type !== 'CAN'));
zone(32, 1296, 464, 384, 'Vision', '#a855f7');

// ---------------- power wiring ----------------
wire(battery, 'BAT', breaker, 'IN');
wire(breaker, 'OUT', pdh, 'PWR');
// roboRIO + radio on non-switchable 10 A mini channels (R615/R617), the
// MitoCANdria on the switchable one beside them.
setRating(pdh, 'CH20', 10);
setRating(pdh, 'CH22', 10);
wire(pdh, 'CH20', rio, 'PWR');
wire(pdh, 'CH22', radio, 'PWR');
wire(pdh, 'CH23', mito, 'PWR IN');
// CANcoders + Pigeon off an MPM on the free channel at the top of the drive
// bank.
setRating(pdh, 'CH19', 20);
wire(pdh, 'CH19', mpm, 'PWR');
['FL', 'FR', 'BL', 'BR'].forEach((n, i) => {
  setRating(mpm, `CH${4 - i}`, 5);
  wire(mpm, `CH${4 - i}`, mods[n].enc, 'PWR');
});
// The Pigeon, furthest away, on the bottom output so its run passes no unused
// output (the spare, CH5, is at the top).
setRating(mpm, 'CH0', 5);
wire(mpm, 'CH0', pigeon, 'PWR');
wire(mito, '15–24V BOOST', jetson, 'PWR (Barrel)');
// Superstructure on the left bank, top to bottom.
mech.forEach((motor, i) => wire(pdh, `CH${9 - i}`, motor, 'PWR'));
// Swerve on the right bank, in the modules' reading order.
const swerve = ['FL', 'FR', 'BL', 'BR'].flatMap((n) => [mods[n].drive, mods[n].steer]);
swerve.forEach((motor, i) => wire(pdh, `CH${18 - i}`, motor, 'PWR'));

// ---------------- CAN ----------------
// A CAN bus is a plain daisy chain — IN/OUT just name the two connectors — so
// each link takes the free pair of ports nearest each other, wired OUT → IN
// where it can be. A CANcoder's single port carries both of its runs.
function chain(list) {
  const canPorts = (n) => n.data.ports.filter((p) => p.type === 'CAN');
  const free = new Map(list.map((n) => [n, canPorts(n)]));
  const pos = (n, p) => portPosition(n, p, getDefinition(n.data.definitionId));
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    const fa = free.get(a).length ? free.get(a) : canPorts(a);
    const fb = free.get(b);
    // Look one link ahead: of b's ports, leave free the one nearest the next
    // device, so the two runs through b don't cross.
    const c = list[i + 1];
    const dist = (q, r) => Math.abs(q.x - r.x) + Math.abs(q.y - r.y);
    const ahead = (pb) => {
      const rest = fb.filter((p) => p !== pb);
      if (!c || !rest.length) return 0;
      return Math.min(...rest.flatMap((p) => canPorts(c).map((q) => dist(pos(b, p), pos(c, q)))));
    };
    let best = null;
    for (const pa of fa)
      for (const pb of fb) {
        const d = dist(pos(a, pa), pos(b, pb)) + ahead(pb);
        if (!best || d < best.d) best = { pa, pb, d };
      }
    free.set(a, free.get(a).filter((p) => p !== best.pa));
    free.set(b, fb.filter((p) => p !== best.pb));
    const ref = (n, p) => `${p.label}#${canPorts(n).filter((q) => q.label === p.label).indexOf(p)}`;
    if (best.pa.label === 'CAN IN' && best.pb.label === 'CAN OUT') wire(b, ref(b, best.pb), a, ref(a, best.pa));
    else wire(a, ref(a, best.pa), b, ref(b, best.pb));
  }
}
// roboRIO bus: roboRIO → superstructure (bottom up) → PDH, which terminates
// the far end.
chain([rio, ...[...mech].reverse(), pdh]);
// CANivore "Drivetrain" bus: CANivore → Pigeon → modules (back to front) →
// terminator.
const driveChain = ['BR', 'BL', 'FR', 'FL'].flatMap((n) => [mods[n].enc, mods[n].steer, mods[n].drive]);
chain([canivore, pigeon, ...driveChain, term]);

// ---------------- network + USB ----------------
wire(rio, 'ETH', radio, 'RIO');
wire(jetson, 'ETH', radio, 'AUX1');
wire(rio, 'USB-A#1', canivore, 'USB-A');
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
