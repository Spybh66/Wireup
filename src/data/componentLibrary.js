// §5 Component Library — built-in FRC component definitions.
// Each definition: { id, name, category, width, height, icon, defaultPorts, trackedFields }.
// Port spec shorthand expands to full Port objects (id/order auto-assigned per side).
import { STEP } from '../utils/routingUtils';

// Round a component dimension to the wire grid (STEP) so that a node's edges —
// and therefore its ports — always land on the routing lattice. Combined with
// node positions snapping to the (coarser) component grid, every port sits on
// the wire grid, so wires and manual waypoints line up into clean straight runs.
const snapDim = (v) => Math.max(STEP, Math.round(v / STEP) * STEP);

// ---- port spec helpers (return arrays of partial port specs) ----
const SB50 = 'Anderson SB50';
const FERRULE = 'Ferrule';
const WAGO = 'Wago Lever Nut';
const RING = 'Ring Terminal';
const APP = 'Anderson Powerpole';
const MOLEX_SL = 'Molex SL';
const BARREL = 'Barrel Jack';
const USB_A = 'USB-A';
const USB_C = 'USB-C';
const BARE = 'Bare Wire';

// Allowed-fitting sets per physical termination style. `requiredFittings` on a
// port is the list a wire end may legally use; the DRC connector-mismatch rule
// flags anything outside it. Order = preferred first (also the default fitting).
const WEID = [FERRULE, BARE];          // Weidmuller / Wago screwless cage clamp
const STUD = [RING];                   // bolt/stud lug (motors, breaker, main lugs)
const MAIN = [SB50, RING];             // battery main run (SB50 quick-disconnect / ring)
const APP_LEADS = [APP, BARE];         // flying power/motor leads (Powerpole or screw-down)
const APP_IN = [APP, FERRULE, BARE];   // controller power input (Powerpole or into a PD terminal)
const CAN_WEID = [FERRULE, BARE];      // REV-style CAN terminal
const CAN_CTRE = [FERRULE, BARE, 'JST']; // CTRE CAN cable: keyed connector or terminal
const CAN_MOLEX = [MOLEX_SL, FERRULE, BARE]; // locking Molex SL CAN (MitoCANdria/ThriftyBot)
const PHASE = [RING, BARE];            // brushless 3-phase motor lead

// single unified power wire
const pwr = (label, side, gauge = null, fitting = null, requiredFittings = null) => [
  { type: 'PWR', label, side, gauge, fitting, requiredFittings },
];
// single unified CAN wire
const can = (label = 'CAN', side = 'bottom', requiredFittings = null) => [
  { type: 'CAN', label, side, requiredFittings },
];
const eth = (label = 'ETH', side = 'top') => [{ type: 'ETH', label, side }];
// USB ports carry a connector variant so USB-A host ports and USB-C
// power/config ports read distinctly in the diagram and the DRC.
const usbA = (label = 'USB-A', side = 'top') => [{ type: 'USB', label, side, requiredFittings: [USB_A] }];
const usbC = (label = 'USB-C', side = 'top') => [{ type: 'USB', label, side, requiredFittings: [USB_C] }];
const data = (label = 'Data', side = 'top') => [{ type: 'DATA', label, side }];

// Build a definition; assigns per-definition port ids and per-side order.
function def(id, name, category, icon, width, height, trackedFields, portSpecs) {
  const orderBySide = {};
  const defaultPorts = portSpecs.map((p, i) => {
    const order = (orderBySide[p.side] = (orderBySide[p.side] ?? -1) + 1);
    return {
      id: `${id}-p${i}`,
      type: p.type,
      label: p.label,
      side: p.side,
      order,
      gauge: p.gauge ?? null,
      fitting: p.fitting ?? null,
      breaker: p.breaker ?? null,
      slot: p.slot ?? null, // 'breaker' | 'fuse' | null — branch protection type
      requiredFittings: p.requiredFittings ?? null,
    };
  });
  return { id, name, category, width: snapDim(width), height: snapDim(height), icon, defaultPorts, trackedFields };
}

// PDH/PDP shape: PWR IN (6 AWG/SB50), 2x CAN, N output channels.
// `miniFrom` = index of the first low-current MINIATURE fuse channel. On the
// REV PDH channels 20–23 are 15 A mini-fuse slots (20–22 non-switchable, used
// for the roboRIO/radio on a 10 A fuse per R615); channels 0–19 are full-size
// 40 A ATO breaker slots. Pass `null` (CTRE PDP 2.0) for all-breaker, every
// channel 40 A — the PDP has no miniature tier.
function powerDistPorts(numChannels, miniFrom = null) {
  const ports = [
    ...pwr('PWR', 'bottom', '6 AWG', SB50, MAIN),
    ...can('CAN IN', 'bottom', CAN_WEID),
    ...can('CAN OUT', 'bottom', CAN_WEID),
  ];
  for (let i = 0; i < numChannels; i++) {
    const side = i <= 9 ? 'right' : 'left';
    const isMini = miniFrom != null && i >= miniFrom;
    ports.push(
      isMini
        ? { type: 'PWR', label: `CH${i}`, side, gauge: '18 AWG', fitting: FERRULE, slot: 'fuse', breaker: 10, requiredFittings: WEID }
        : { type: 'PWR', label: `CH${i}`, side, gauge: '12 AWG', fitting: FERRULE, slot: 'breaker', breaker: 40, requiredFittings: WEID }
    );
  }
  return ports;
}

export const COMPONENT_LIBRARY = [
  // ---------------- Controllers ----------------
  def('roborio2', 'roboRIO 2', 'Controllers', 'controller', 160, 80, ['ipAddress'], [
    ...pwr('PWR', 'top', '12 AWG', FERRULE, WEID),
    ...can('CAN', 'left', CAN_WEID),
    ...eth('ETH', 'top'),
    ...usbA('USB-A', 'right'),
    ...usbA('USB-A', 'right'),
    ...pwr('RSL', 'bottom', '18 AWG', FERRULE, WEID),
  ]),
  def('orangepi5', 'Orange Pi 5', 'Controllers', 'pi', 160, 80, ['ipAddress'], [
    ...usbC('USB-C PWR', 'left'),
    ...eth('ETH', 'top'),
    ...usbA('USB-A', 'right'),
    ...usbA('USB-A', 'right'),
  ]),
  def('raspberrypi5', 'Raspberry Pi 5', 'Controllers', 'pi', 160, 80, ['ipAddress'], [
    ...usbC('USB-C PWR', 'left'),
    ...eth('ETH', 'top'),
    ...usbA('USB-A', 'right'),
    ...usbA('USB-A', 'right'),
  ]),
  // Jetson Orin Nano — primary power is the DC barrel jack (USB-C is an
  // alternate input); 4× USB-A host ports + 1× USB-C + Gigabit Ethernet.
  def('jetsonorinnano', 'Jetson Orin Nano', 'Controllers', 'pi', 160, 90, ['ipAddress'], [
    ...pwr('PWR (Barrel)', 'left', null, BARREL, [BARREL]),
    ...usbC('USB-C', 'top'),
    ...eth('ETH', 'top'),
    ...usbA('USB-A', 'bottom'),
    ...usbA('USB-A', 'bottom'),
    ...usbA('USB-A', 'bottom'),
    ...usbA('USB-A', 'bottom'),
  ]),
  def('beelink', 'Beelink Mini PC', 'Controllers', 'pi', 160, 80, ['ipAddress'], [
    ...pwr('PWR (Barrel)', 'left', null, BARREL, [BARREL]),
    ...eth('ETH', 'top'),
    ...usbA('USB-A', 'right'),
    ...usbA('USB-A', 'right'),
  ]),

  // ---------------- Power ----------------
  def('battery', 'Battery (12V)', 'Power', 'battery', 120, 80, [], [
    ...pwr('BAT', 'right', '6 AWG', SB50, MAIN),
  ]),
  def('mainbreaker', 'Main Breaker (120A)', 'Power', 'breaker', 120, 80, [], [
    { type: 'PWR', label: 'IN', side: 'left', gauge: '6 AWG', fitting: RING, requiredFittings: STUD },
    { type: 'PWR', label: 'OUT', side: 'right', gauge: '6 AWG', fitting: RING, requiredFittings: STUD },
  ]),
  // PDH: 20 full-size breaker channels (0–19) + 4 miniature fuse channels (20–23).
  def('pdh', 'PDH (REV)', 'Power', 'powerdist', 240, 320, ['canId'], powerDistPorts(24, 20)),
  // PDP 2.0 / legacy PDP: 24 identical full-size channels, all default 40 A.
  def('pdp2', 'PDP 2.0 (CTRE)', 'Power', 'powerdist', 240, 320, ['canId'], powerDistPorts(24)),
  def('pdp_legacy', 'PDP (CTRE, legacy)', 'Power', 'powerdist', 240, 320, ['canId'], powerDistPorts(24)),
  def('vrm', 'VRM', 'Power', 'vrm', 160, 80, [], [
    ...pwr('PWR', 'top', '18 AWG', FERRULE, WEID),
    ...pwr('12V/2A', 'left', '18 AWG', FERRULE, WEID),
    ...pwr('12V/2A', 'left', '18 AWG', FERRULE, WEID),
    ...pwr('12V/500mA', 'left', '18 AWG', FERRULE, WEID),
    ...pwr('12V/500mA', 'left', '18 AWG', FERRULE, WEID),
    ...pwr('5V/2A', 'right', '18 AWG', FERRULE, WEID),
    ...pwr('5V/2A', 'right', '18 AWG', FERRULE, WEID),
    ...pwr('5V/500mA', 'right', '18 AWG', FERRULE, WEID),
    ...pwr('5V/500mA', 'right', '18 AWG', FERRULE, WEID),
  ]),
  // REV Mini Power Module — fed from one 40 A PDH channel, fans out to 6
  // low-current outputs each protected by an ATM mini blade FUSE (15 A max),
  // sized per peripheral. Same miniature-fuse picker as the PDH mini channels.
  def('mpm', 'Mini Power Module (REV MPM)', 'Power', 'vrm', 120, 160, [], [
    ...pwr('PWR', 'bottom', '12 AWG', FERRULE, WEID),
    { type: 'PWR', label: 'CH0', side: 'right', gauge: '18 AWG', fitting: FERRULE, slot: 'fuse', requiredFittings: WEID },
    { type: 'PWR', label: 'CH1', side: 'right', gauge: '18 AWG', fitting: FERRULE, slot: 'fuse', requiredFittings: WEID },
    { type: 'PWR', label: 'CH2', side: 'right', gauge: '18 AWG', fitting: FERRULE, slot: 'fuse', requiredFittings: WEID },
    { type: 'PWR', label: 'CH3', side: 'right', gauge: '18 AWG', fitting: FERRULE, slot: 'fuse', requiredFittings: WEID },
    { type: 'PWR', label: 'CH4', side: 'right', gauge: '18 AWG', fitting: FERRULE, slot: 'fuse', requiredFittings: WEID },
    { type: 'PWR', label: 'CH5', side: 'right', gauge: '18 AWG', fitting: FERRULE, slot: 'fuse', requiredFittings: WEID },
  ]),
  // MitoCANdria — 4.5–14 V in via locking Molex SL; 4× 5 V USB-C outputs +
  // one adjustable 15–24 V boost; CAN over locking Molex SL.
  def('mitocandria', 'MitoCANdria (ThriftyBot)', 'Power', 'vrm', 160, 96, ['canId'], [
    ...pwr('PWR IN', 'left', '18 AWG', MOLEX_SL, [MOLEX_SL]),
    ...can('CAN', 'bottom', CAN_MOLEX),
    ...can('CAN', 'bottom', CAN_MOLEX),
    ...usbC('5V USB-C', 'top'),
    ...usbC('5V USB-C', 'top'),
    ...usbC('5V USB-C', 'top'),
    ...usbC('5V USB-C', 'top'),
    ...pwr('15–24V BOOST', 'right', '20 AWG', FERRULE, WEID),
  ]),
  def('canjunction', 'CANJunction (ThriftyBot)', 'Power', 'canjunction', 120, 60, [], [
    ...can('CAN', 'left', MOLEX_SL),
    ...can('CAN', 'right', MOLEX_SL),
  ]),

  // ---------------- Motor Controllers ----------------
  // SPARK MAX/Flex drive brushless motors over 3 phase leads (A/B/C flying
  // leads); brushed motors use A/B only. Power in is V+/V- (red/black leads).
  def('sparkmax', 'SPARK MAX', 'Motor Controllers', 'motorController', 160, 100, ['canId'], [
    ...pwr('V+/V−', 'left', '12 AWG', APP, APP_IN),
    ...can('CAN', 'bottom', CAN_WEID),
    ...can('CAN', 'bottom', CAN_WEID),
    { type: 'PWR', label: 'A', side: 'right', gauge: '12 AWG', fitting: BARE, requiredFittings: APP_LEADS },
    { type: 'PWR', label: 'B', side: 'right', gauge: '12 AWG', fitting: BARE, requiredFittings: APP_LEADS },
    { type: 'PWR', label: 'C', side: 'right', gauge: '12 AWG', fitting: BARE, requiredFittings: APP_LEADS },
    ...data('Encoder', 'top'),
  ]),
  def('sparkflex', 'SPARK Flex', 'Motor Controllers', 'motorController', 160, 100, ['canId'], [
    ...pwr('V+/V−', 'left', '12 AWG', APP, APP_IN),
    ...can('CAN', 'bottom', CAN_WEID),
    ...can('CAN', 'bottom', CAN_WEID),
    { type: 'PWR', label: 'A', side: 'right', gauge: '12 AWG', fitting: BARE, requiredFittings: APP_LEADS },
    { type: 'PWR', label: 'B', side: 'right', gauge: '12 AWG', fitting: BARE, requiredFittings: APP_LEADS },
    { type: 'PWR', label: 'C', side: 'right', gauge: '12 AWG', fitting: BARE, requiredFittings: APP_LEADS },
    ...data('Encoder', 'top'),
  ]),
  // Talon FXS — brushless 3-phase out on 3 ring-terminal stator leads (U/V/W);
  // brushed uses 2 of them. Power in is V+/V- ring terminals (6-32 studs).
  def('talonfxs', 'Talon FXS', 'Motor Controllers', 'motorController', 140, 100, ['canId'], [
    ...pwr('V+/V−', 'left', '12 AWG', RING, STUD),
    ...can('CAN', 'bottom', CAN_CTRE),
    { type: 'PWR', label: 'U', side: 'right', gauge: '12 AWG', fitting: RING, requiredFittings: PHASE },
    { type: 'PWR', label: 'V', side: 'right', gauge: '12 AWG', fitting: RING, requiredFittings: PHASE },
    { type: 'PWR', label: 'W', side: 'right', gauge: '12 AWG', fitting: RING, requiredFittings: PHASE },
    ...data('Sensor (JST)', 'top'),
  ]),
  def('generic_mc', 'Generic Motor Controller', 'Motor Controllers', 'motorController', 120, 70, ['canId'], [
    ...pwr('PWR', 'left', '12 AWG', FERRULE),
    ...can('CAN', 'bottom'),
    ...pwr('MOTOR', 'right', '12 AWG', FERRULE),
    ...data('Data', 'top'),
  ]),

  // ---------------- Motors ----------------
  def('krakenx60', 'Kraken X60', 'Motors', 'krakenMotor', 120, 70, ['canId'], [
    { type: 'PWR', label: 'PWR', side: 'left', gauge: '12 AWG', fitting: RING, requiredFittings: STUD },
    { type: 'CAN', label: 'CAN IN', side: 'right', requiredFittings: CAN_CTRE },
    { type: 'CAN', label: 'CAN OUT', side: 'right', requiredFittings: CAN_CTRE },
  ]),
  def('krakenx44', 'Kraken X44', 'Motors', 'krakenMotor', 120, 70, ['canId'], [
    { type: 'PWR', label: 'PWR', side: 'left', gauge: '12 AWG', fitting: RING, requiredFittings: STUD },
    { type: 'CAN', label: 'CAN IN', side: 'right', requiredFittings: CAN_CTRE },
    { type: 'CAN', label: 'CAN OUT', side: 'right', requiredFittings: CAN_CTRE },
  ]),
  def('krakenx60_adapted', 'Kraken X60 + Adapter', 'Motors', 'krakenMotor', 120, 70, ['canId'], [
    { type: 'PWR', label: 'PWR', side: 'left', gauge: '12 AWG', fitting: APP, requiredFittings: [APP, MOLEX_SL] },
    { type: 'CAN', label: 'CAN IN', side: 'right', requiredFittings: CAN_CTRE },
    { type: 'CAN', label: 'CAN OUT', side: 'right', requiredFittings: CAN_CTRE },
  ]),
  def('krakenx44_adapted', 'Kraken X44 + Adapter', 'Motors', 'krakenMotor', 120, 70, ['canId'], [
    { type: 'PWR', label: 'PWR', side: 'left', gauge: '12 AWG', fitting: APP, requiredFittings: [APP, MOLEX_SL] },
    { type: 'CAN', label: 'CAN IN', side: 'right', requiredFittings: CAN_CTRE },
    { type: 'CAN', label: 'CAN OUT', side: 'right', requiredFittings: CAN_CTRE },
  ]),
  def('minion', 'Minion', 'Motors', 'motor', 120, 70, [], [
    ...pwr('PWR', 'left', '12 AWG', RING, STUD),
    ...data('Hall', 'top'),
  ]),
  def('neo', 'NEO', 'Motors', 'motor', 120, 70, [], [
    ...pwr('PWR', 'left', '12 AWG', APP, APP_LEADS),
    ...data('Encoder', 'top'),
  ]),
  def('neo550', 'NEO 550', 'Motors', 'motor', 120, 70, [], [
    ...pwr('PWR', 'left', '12 AWG', APP, APP_LEADS),
    ...data('Encoder', 'top'),
  ]),
  def('neovortex', 'NEO Vortex', 'Motors', 'motor', 120, 70, [], [
    ...pwr('PWR', 'left', '12 AWG', APP, APP_LEADS),
    ...data('Encoder', 'top'),
  ]),
  def('generic_motor', 'Generic Motor', 'Motors', 'motor', 120, 70, [], [
    ...pwr('PWR', 'left', '12 AWG', FERRULE),
  ]),

  // ---------------- Sensors ----------------
  def('cancoder', 'CANcoder', 'Sensors', 'canSensor', 100, 60, ['canId'], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, CAN_CTRE),
    ...can('CAN', 'bottom', CAN_CTRE),
  ]),
  def('pigeon2', 'Pigeon 2', 'Sensors', 'canSensor', 100, 60, ['canId'], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, CAN_CTRE),
    ...can('CAN', 'bottom', CAN_CTRE),
  ]),
  def('candle', 'CANdle', 'Sensors', 'canSensor', 100, 60, ['canId'], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, WEID),
    ...can('CAN', 'bottom', CAN_CTRE),
    ...data('LED out', 'top'),
  ]),
  def('canrange', 'CANrange', 'Sensors', 'canSensor', 100, 60, ['canId'], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, CAN_CTRE),
    ...can('CAN', 'bottom', CAN_CTRE),
  ]),
  def('candi', 'CANdi', 'Sensors', 'canSensor', 100, 60, ['canId'], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, CAN_CTRE),
    ...can('CAN', 'bottom', CAN_CTRE),
    ...data('S1', 'top'),
    ...data('S2', 'top'),
  ]),
  def('limelight4', 'Limelight 4', 'Sensors', 'camera', 120, 70, ['ipAddress'], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, WEID),
    ...eth('ETH', 'top'),
  ]),
  def('limelight3g', 'Limelight 3G', 'Sensors', 'camera', 120, 70, ['ipAddress'], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, WEID),
    ...eth('ETH', 'top'),
  ]),
  def('lasercan', 'LaserCAN (Grapple)', 'Sensors', 'canSensor', 120, 80, ['canId'], [
    ...pwr('PWR', 'bottom', '22 AWG', FERRULE, WEID),
    ...pwr('PWR', 'top', '22 AWG', FERRULE, WEID),
    { type: 'CAN', label: 'CAN IN', side: 'left', requiredFittings: CAN_WEID },
    { type: 'CAN', label: 'CAN OUT', side: 'right', requiredFittings: CAN_WEID },
  ]),
  def('thriftycam', 'ThriftyCAM (ThriftyBot)', 'Sensors', 'camera', 120, 70, [], [
    ...usbA('USB-A', 'left'),
  ]),
  def('usbcamera', 'Generic USB Camera', 'Sensors', 'camera', 120, 70, [], [
    ...usbA('USB-A', 'left'),
  ]),
  def('throughboreencoder', 'REV Through Bore Encoder', 'Sensors', 'canSensor', 100, 64, [], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, WEID),
    ...data('Data', 'left'),
  ]),
  def('generic_sensor', 'Generic Sensor', 'Sensors', 'sensor', 100, 60, [], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE),
    ...data('Data', 'top'),
  ]),

  // ---------------- Networking ----------------
  def('vh109', 'VH-109 Radio', 'Networking', 'radio', 140, 80, ['ipAddress'], [
    ...eth('AUX2', 'left'),
    ...eth('RIO', 'left'),
    ...pwr('PWR', 'left', '18 AWG', FERRULE, WEID),
    ...eth('AUX1', 'right'),
    ...eth('DS', 'right'),

  ]),
  def('ethswitch', 'Ethernet Switch', 'Networking', 'switch', 140, 80, ['ipAddress'], [
    ...pwr('PWR', 'left'),
    ...eth('1', 'top'),
    ...eth('2', 'top'),
    ...eth('3', 'top'),
    ...eth('4', 'top'),
    ...eth('5', 'top'),
  ]),
  def('canivore', 'CANivore (CTRE)', 'Networking', 'canjunction', 120, 80, [], [
    ...usbA('USB-A', 'left'),
    ...can('CAN', 'right', CAN_CTRE),
    ...pwr('V+/V-', 'bottom', '22 AWG', FERRULE, WEID),
  ]),

  // ---------------- Other ----------------
  def('rsl', 'Robot Signal Light (RSL)', 'Other', 'rsl', 100, 60, [], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, WEID),
  ]),
  def('servohub', 'Servo Hub (REV)', 'Other', 'servo', 120, 70, ['canId'], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, WEID),
    ...can('CAN', 'bottom', CAN_WEID),
  ]),
  def('ledstrip', 'LED Strip', 'Other', 'ledstrip', 120, 60, [], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE),
    ...data('Din', 'left'),
  ]),
  def('canterminator', 'CAN Terminator (120Ω)', 'Other', 'canjunction', 96, 48, [], [
    ...can('CAN', 'left'),
  ]),
];

// Category display order for the sidebar.
export const CATEGORY_ORDER = [
  'Controllers',
  'Power',
  'Motor Controllers',
  'Motors',
  'Sensors',
  'Networking',
  'Other',
  'Custom',
];

const BY_ID = new Map(COMPONENT_LIBRARY.map((d) => [d.id, d]));

// Look up a definition by id from built-ins or a list of custom definitions.
export function getDefinition(id, customDefinitions = []) {
  return BY_ID.get(id) ?? customDefinitions.find((d) => d.id === id) ?? null;
}
