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

// single unified power wire
const pwr = (label, side, gauge = null, fitting = null, requiredFittings = null) => [
  { type: 'PWR', label, side, gauge, fitting, requiredFittings },
];
// single unified CAN wire
const can = (label = 'CAN', side = 'bottom', requiredFittings = null) => [
  { type: 'CAN', label, side, requiredFittings },
];
const eth = (label = 'ETH', side = 'top') => [{ type: 'ETH', label, side }];
const usb = (label = 'USB', side = 'top') => [{ type: 'USB', label, side }];
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
      requiredFittings: p.requiredFittings ?? null,
    };
  });
  return { id, name, category, width: snapDim(width), height: snapDim(height), icon, defaultPorts, trackedFields };
}

// PDH/PDP shape: PWR IN (6 AWG/SB50), 2x CAN, N output channels (12 AWG/Ferrule).
function powerDistPorts(numChannels) {
  const ports = [
    ...pwr('PWR', 'bottom', '6 AWG', SB50, MAIN),
    ...can('CAN IN', 'bottom', CAN_WEID),
    ...can('CAN OUT', 'bottom', CAN_WEID),
  ];
  for (let i = 0; i < numChannels; i++) {
    const side = i <= 9 ? 'right' : 'left';
    // PDH channels 20–22 are the non-switchable 10 A roboRIO/radio channels
    // (R615); default the rest to a 40 A breaker.
    const breaker = i >= 20 && i <= 22 ? 10 : 40;
    ports.push({ type: 'PWR', label: `CH${i}`, side, gauge: '12 AWG', fitting: FERRULE, breaker, requiredFittings: WEID });
  }
  return ports;
}

export const COMPONENT_LIBRARY = [
  // ---------------- Controllers ----------------
  def('roborio2', 'roboRIO 2', 'Controllers', 'controller', 160, 80, ['ipAddress'], [
    ...pwr('PWR', 'top', '12 AWG', FERRULE, WEID),
    ...can('CAN', 'left', CAN_WEID),
    ...eth('ETH', 'top'),
    ...usb('USB', 'right'),
    ...usb('USB', 'right'),
    ...pwr('RSL', 'bottom', '18 AWG', FERRULE, WEID),
  ]),
  def('orangepi5', 'Orange Pi 5', 'Controllers', 'pi', 160, 80, ['ipAddress'], [
    ...usb('USBC - PWR', 'left'),
    ...eth('ETH', 'top'),
    ...usb('USB', 'right'),
    ...usb('USB', 'right'),
  ]),
  def('raspberrypi5', 'Raspberry Pi 5', 'Controllers', 'pi', 160, 80, ['ipAddress'], [
    ...usb('USBC - PWR', 'left'),
    ...eth('ETH', 'top'),
    ...usb('USB', 'right'),
    ...usb('USB', 'right'),
  ]),
  def('jetsonorinnano', 'Jetson Orin Nano', 'Controllers', 'pi', 160, 80, ['ipAddress'], [
    ...pwr('PWR', 'left'), // Barrel Jack
    ...usb('USBC - PWR', 'top'),
    ...eth('ETH', 'top'),
    ...usb('USB', 'bottom'),
    ...usb('USB', 'bottom'),
    ...usb('USB', 'bottom'),
    ...usb('USB', 'bottom'),
  ]),
  def('beelink', 'Beelink Mini PC', 'Controllers', 'pi', 160, 80, ['ipAddress'], [
    ...pwr('PWR', 'left'),
    ...eth('ETH', 'top'),
    ...usb('USB', 'right'),
    ...usb('USB', 'right'),
  ]),

  // ---------------- Power ----------------
  def('battery', 'Battery (12V)', 'Power', 'battery', 120, 80, [], [
    ...pwr('BAT', 'right', '6 AWG', SB50, MAIN),
  ]),
  def('mainbreaker', 'Main Breaker (120A)', 'Power', 'breaker', 120, 80, [], [
    { type: 'PWR', label: 'IN', side: 'left', gauge: '6 AWG', fitting: RING, requiredFittings: STUD },
    { type: 'PWR', label: 'OUT', side: 'right', gauge: '6 AWG', fitting: RING, requiredFittings: STUD },
  ]),
  def('pdh', 'PDH (REV)', 'Power', 'powerdist', 240, 320, ['canId'], powerDistPorts(24)),
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
  def('rpm', 'Radio Power Module (REV RPM)', 'Power', 'radioPower', 140, 80, [], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, WEID),
    ...eth('ETH IN', 'top'),
    ...eth('ETH OUT', 'top'),
    ...pwr('AUX', 'right', '18 AWG', FERRULE, WEID),
  ]),
  def('mpm', 'Mini Power Module (CTRE MPM)', 'Power', 'vrm', 120, 160, [], [
    ...pwr('PWR', 'bottom', '18 AWG', FERRULE, WEID),
    ...pwr('CH0', 'right', '18 AWG', FERRULE, WEID),
    ...pwr('CH1', 'right', '18 AWG', FERRULE, WEID),
    ...pwr('CH2', 'right', '18 AWG', FERRULE, WEID),
    ...pwr('CH3', 'right', '18 AWG', FERRULE, WEID),
    ...pwr('CH4', 'right', '18 AWG', FERRULE, WEID),
    ...pwr('CH5', 'right', '18 AWG', FERRULE, WEID),
  ]),
  def('mitocandria', 'MitoCANDria (ThriftyBot)', 'Power', 'vrm', 160, 80, ['canId'], [
    ...pwr('PWR', 'left', '18 AWG', FERRULE, WEID),
    ...can('CAN', 'bottom', CAN_WEID),
    ...can('CAN', 'bottom', CAN_WEID),
    ...usb('5V USBC', 'top'),
    ...usb('5V USBC', 'top'),
    ...pwr('BOOST', 'right', '20 AWG', FERRULE, WEID),
    ...pwr('5VA', 'right', '20 AWG', FERRULE, WEID),
    ...pwr('5VB', 'right', '20 AWG', FERRULE, WEID),
  ]),
  def('canjunction', 'CANJunction (ThriftyBot)', 'Power', 'canjunction', 120, 60, [], [
    ...can('CAN', 'left', MOLEX_SL),
    ...can('CAN', 'right', MOLEX_SL),
  ]),

  // ---------------- Motor Controllers ----------------
  def('sparkmax', 'SPARK MAX', 'Motor Controllers', 'motorController', 160, 80, ['canId'], [
    ...pwr('PWR', 'left', '12 AWG', APP, APP_IN),
    ...can('CAN', 'bottom', CAN_WEID),
    ...can('CAN', 'bottom', CAN_WEID),
    ...pwr('MOTOR', 'right', '12 AWG', APP, APP_LEADS),
    ...data('Encoder', 'top'),
  ]),
  def('sparkflex', 'SPARK Flex', 'Motor Controllers', 'motorController', 160, 80, ['canId'], [
    ...pwr('PWR', 'left', '12 AWG', APP, APP_IN),
    ...can('CAN', 'bottom', CAN_WEID),
    ...can('CAN', 'bottom', CAN_WEID),
    ...pwr('MOTOR', 'right', '12 AWG', APP, APP_LEADS),
    ...data('Encoder', 'top'),
  ]),
  def('talonfxs', 'Talon FXS', 'Motor Controllers', 'motorController', 120, 70, ['canId'], [
    ...pwr('PWR', 'left', '12 AWG', APP, APP_IN),
    ...can('CAN', 'bottom', CAN_CTRE),
    ...pwr('MOTOR', 'right', '12 AWG', APP, APP_LEADS),
    ...data('Data port', 'top'),
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
    ...usb('USB', 'left'),
  ]),
  def('usbcamera', 'Generic USB Camera', 'Sensors', 'camera', 120, 70, [], [
    ...usb('USB', 'left'),
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
    ...usb('USB', 'left'),
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
