// §5 Component Library — built-in FRC component definitions.
// Each definition: { id, name, category, width, height, icon, defaultPorts, trackedFields }.
// Port spec shorthand expands to full Port objects (id/order auto-assigned per side).

// ---- port spec helpers (return arrays of partial port specs) ----
const SB50 = 'Anderson SB50';
const FERRULE = 'Ferrule';
const WAGO = 'Wago Lever Nut';

// generic power pair
const pwr = (posLabel, negLabel, side, gauge = null, fitting = null) => [
  { type: 'PWR+', label: posLabel, side, gauge, fitting },
  { type: 'PWR-', label: negLabel, side, gauge, fitting },
];
// CAN H/L pair
const can = (side = 'bottom') => [
  { type: 'CANH', label: 'CAN H', side },
  { type: 'CANL', label: 'CAN L', side },
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
    };
  });
  return { id, name, category, width, height, icon, defaultPorts, trackedFields };
}

// PDH/PDP shape: P± IN (6 AWG/SB50), CAN, 8 output channel pairs (12 AWG/Ferrule).
function powerDistPorts(numChannels) {
  const ports = [...pwr('V+', 'V-', 'bottom', '6 AWG', SB50), ...can('bottom'), ...can('bottom')];
  for (let i = 0; i < numChannels; i++) {
    if (i <= 9) {
      ports.push(
      { type: 'PWR+', label: `CH${i}+`, side: 'right', gauge: '12 AWG', fitting: FERRULE },
      { type: 'PWR-', label: `CH${i}-`, side: 'right', gauge: '12 AWG', fitting: FERRULE });
    } else {
      ports.push(
      { type: 'PWR+', label: `CH${i}+`, side: 'left', gauge: '12 AWG', fitting: FERRULE },
      { type: 'PWR-', label: `CH${i}-`, side: 'left', gauge: '12 AWG', fitting: FERRULE });
    }    
  }
  return ports;
}

export const COMPONENT_LIBRARY = [
  // ---------------- Controllers ----------------
  def('roborio2', 'roboRIO 2', 'Controllers', 'controller', 200, 120, ['ipAddress'], [
    ...pwr('V+', 'V-', 'top', '12 AWG', FERRULE),
    ...can('left'),
    ...eth('ETH', 'top'),
    ...usb('USB1', 'right'),
    ...usb('USB2', 'right'),
    ...pwr('RSL+', 'RSL-', 'bottom', '12 AWG', FERRULE),
  ]),
  def('orangepi5', 'Orange Pi 5', 'Controllers', 'pi', 140, 80, ['ipAddress'], [
    ...pwr('V+', 'V-', 'left'),
    ...eth('ETH', 'top'),
    ...usb('USB1', 'right'),
    ...usb('USB2', 'right'),
  ]),
  def('raspberrypi5', 'Raspberry Pi 5', 'Controllers', 'pi', 140, 80, ['ipAddress'], [
    ...pwr('V+', 'V-', 'left'),
    ...eth('ETH', 'top'),
    ...usb('USB1', 'right'),
    ...usb('USB2', 'right'),
  ]),
  def('jetsonorinnano', 'Jetson Orin Nano', 'Controllers', 'pi', 170, 90, ['ipAddress'], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...eth('ETH', 'top'),
    ...usb('USB1', 'top'),
    ...usb('USB2', 'top'),
    ...usb('USB3', 'top'),
  ]),

  // ---------------- Power ----------------
  def('battery', 'Battery (12V)', 'Power', 'battery', 140, 80, [], [
    ...pwr('BAT+', 'BAT-', 'right', '6 AWG', SB50),
  ]),
  def('mainbreaker', 'Main Breaker (120A)', 'Power', 'breaker', 120, 70, [], [
    { type: 'PWR+', label: 'IN', side: 'left', gauge: '6 AWG', fitting: SB50 },
    { type: 'PWR+', label: 'OUT', side: 'right', gauge: '6 AWG', fitting: SB50 },
  ]),
  def('pdh', 'PDH (REV)', 'Power', 'powerdist', 280, 400, ['canId'], powerDistPorts(24)),
  def('pdp2', 'PDP 2.0 (CTRE)', 'Power', 'powerdist', 180, 110, ['canId'], powerDistPorts(24)),
  def('pdp_legacy', 'PDP (CTRE, legacy)', 'Power', 'powerdist', 180, 110, ['canId'], powerDistPorts(24)),
  def('vrm', 'VRM', 'Power', 'vrm', 140, 80, [], [
    ...pwr('V+', 'V-', 'left'),
    ...pwr('12V+', '12V-', 'right', '18 AWG', FERRULE),
    ...pwr('5V+', '5V-', 'right', '18 AWG', FERRULE),
  ]),
  def('rpm', 'Radio Power Module (REV RPM)', 'Power', 'radioPower', 140, 80, [], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...eth('ETH IN', 'top'),
    ...eth('ETH OUT', 'top'),
    ...pwr('AUX+', 'AUX-', 'right', '18 AWG', FERRULE),
  ]),
  def('mpm', 'Mini Power Module (CTRE MPM)', 'Power', 'vrm', 140, 80, [], [
    ...pwr('V+', 'V-', 'left'),
    ...pwr('A+', 'A-', 'right', '18 AWG', FERRULE),
    ...pwr('B+', 'B-', 'right', '18 AWG', FERRULE),
    ...pwr('C+', 'C-', 'right', '18 AWG', FERRULE),
    ...pwr('D+', 'D-', 'right', '18 AWG', FERRULE),
  ]),
  def('mitocandria', 'MitoCANDria (ThriftyBot)', 'Power', 'vrm', 150, 100, ['canId'], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...can('bottom'),
    ...pwr('OUT1+', 'OUT1-', 'right', '20 AWG', FERRULE),
    ...pwr('OUT2+', 'OUT2-', 'right', '20 AWG', FERRULE),
    ...pwr('OUT3+', 'OUT3-', 'right', '20 AWG', FERRULE),
    ...pwr('OUT4+', 'OUT4-', 'right', '20 AWG', FERRULE),
  ]),
  def('canjunction', 'CANJunction (ThriftyBot)', 'Power', 'canjunction', 150, 110, [], [
    ...pwr('V+', 'V-', 'left', '18 AWG', WAGO),
    { type: 'CANH', label: 'BUS H', side: 'left' },
    { type: 'CANL', label: 'BUS L', side: 'left' },
    { type: 'CANH', label: 'T1 H', side: 'right' },
    { type: 'CANL', label: 'T1 L', side: 'right' },
    { type: 'CANH', label: 'T2 H', side: 'right' },
    { type: 'CANL', label: 'T2 L', side: 'right' },
    { type: 'CANH', label: 'T3 H', side: 'right' },
    { type: 'CANL', label: 'T3 L', side: 'right' },
    { type: 'CANH', label: 'T4 H', side: 'right' },
    { type: 'CANL', label: 'T4 L', side: 'right' },
  ]),

  // ---------------- Motor Controllers ----------------
  def('sparkmax', 'SPARK MAX', 'Motor Controllers', 'motorController', 120, 70, ['canId'], [
    ...pwr('V+', 'V-', 'left', '12 AWG', FERRULE),
    ...can('bottom'),
    ...pwr('M+', 'M-', 'right', '12 AWG', FERRULE),
    ...data('Encoder', 'top'),
  ]),
  def('sparkflex', 'SPARK Flex', 'Motor Controllers', 'motorController', 120, 70, ['canId'], [
    ...pwr('V+', 'V-', 'left', '12 AWG', FERRULE),
    ...can('bottom'),
    ...pwr('M+', 'M-', 'right', '12 AWG', FERRULE),
    ...data('Encoder', 'top'),
  ]),
  def('talonfxs', 'Talon FXS', 'Motor Controllers', 'motorController', 120, 70, ['canId'], [
    ...pwr('V+', 'V-', 'left', '12 AWG', FERRULE),
    ...can('bottom'),
    ...pwr('M+', 'M-', 'right', '12 AWG', FERRULE),
    ...data('Data port', 'top'),
  ]),
  def('generic_mc', 'Generic Motor Controller', 'Motor Controllers', 'motorController', 120, 70, ['canId'], [
    ...pwr('V+', 'V-', 'left', '12 AWG', FERRULE),
    ...can('bottom'),
    ...pwr('M+', 'M-', 'right', '12 AWG', FERRULE),
    ...data('Data', 'top'),
  ]),

  // ---------------- Motors ----------------
  def('krakenx60', 'Kraken X60', 'Motors', 'krakenMotor', 120, 70, ['canId'], [
    ...pwr('V+', 'V-', 'left', '12 AWG', FERRULE),
    ...can('right'),
  ]),
  def('krakenx44', 'Kraken X44', 'Motors', 'krakenMotor', 120, 70, ['canId'], [
    ...pwr('V+', 'V-', 'left', '12 AWG', FERRULE),
    ...can('right'),
  ]),
  def('minion', 'Minion', 'Motors', 'motor', 120, 70, [], [
    ...pwr('V+', 'V-', 'left', '12 AWG', FERRULE),
    ...data('Hall', 'top'),
  ]),
  def('neo', 'NEO', 'Motors', 'motor', 120, 70, [], [
    ...pwr('V+', 'V-', 'left', '12 AWG', FERRULE),
    ...data('Encoder', 'top'),
  ]),
  def('neo550', 'NEO 550', 'Motors', 'motor', 120, 70, [], [
    ...pwr('V+', 'V-', 'left', '12 AWG', FERRULE),
    ...data('Encoder', 'top'),
  ]),
  def('neovortex', 'NEO Vortex', 'Motors', 'motor', 120, 70, [], [
    ...pwr('V+', 'V-', 'left', '12 AWG', FERRULE),
    ...data('Encoder', 'top'),
  ]),
  def('generic_motor', 'Generic Motor', 'Motors', 'motor', 120, 70, [], [
    ...pwr('V+', 'V-', 'left', '12 AWG', FERRULE),
  ]),

  // ---------------- Sensors ----------------
  def('cancoder', 'CANcoder', 'Sensors', 'canSensor', 100, 60, ['canId'], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...can('bottom'),
  ]),
  def('pigeon2', 'Pigeon 2', 'Sensors', 'canSensor', 100, 60, ['canId'], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...can('bottom'),
  ]),
  def('candle', 'CANdle', 'Sensors', 'canSensor', 100, 60, ['canId'], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...can('bottom'),
    ...data('LED out', 'top'),
  ]),
  def('canrange', 'CANrange', 'Sensors', 'canSensor', 100, 60, ['canId'], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...can('bottom'),
  ]),
  def('candi', 'CANdi', 'Sensors', 'canSensor', 100, 60, ['canId'], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...can('bottom'),
    ...data('S1', 'top'),
    ...data('S2', 'top'),
  ]),
  def('limelight4', 'Limelight 4', 'Sensors', 'camera', 120, 70, ['ipAddress'], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...eth('ETH', 'top'),
  ]),
  def('lasercan', 'LaserCAN (Grapple)', 'Sensors', 'canSensor', 100, 60, ['canId'], [
    ...pwr('V+', 'V-', 'left', '22 AWG', FERRULE),
    ...can('bottom'),
  ]),
  def('thriftycam', 'ThriftyCAM (ThriftyBot)', 'Sensors', 'camera', 120, 70, [], [
    ...usb('USB', 'left'),
  ]),
  def('usbcamera', 'Generic USB Camera', 'Sensors', 'camera', 120, 70, [], [
    ...usb('USB', 'left'),
  ]),
  def('generic_sensor', 'Generic Sensor', 'Sensors', 'sensor', 100, 60, [], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...data('Data', 'top'),
  ]),

  // ---------------- Networking ----------------
  def('vh109', 'VH-109 Radio', 'Networking', 'radio', 140, 80, ['ipAddress'], [
    ...eth('AUX2', 'left'),
    ...eth('RIO', 'left'),
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...eth('AUX1', 'right'),
    ...eth('DS', 'right'),
    
  ]),
  def('ethswitch', 'Ethernet Switch', 'Networking', 'switch', 140, 80, ['ipAddress'], [
    ...pwr('V+', 'V-', 'left'),
    ...eth('1', 'top'),
    ...eth('2', 'top'),
    ...eth('3', 'top'),
    ...eth('4', 'top'),
    ...eth('5', 'top'),
  ]),

  // ---------------- Other ----------------
  def('rsl', 'Robot Signal Light (RSL)', 'Other', 'rsl', 100, 60, [], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
  ]),
  def('servohub', 'Servo Hub (REV)', 'Other', 'servo', 120, 70, ['canId'], [
    ...pwr('V+', 'V-', 'left'),
    ...can('bottom'),
  ]),
  def('ledstrip', 'LED Strip', 'Other', 'ledstrip', 120, 60, [], [
    ...pwr('V+', 'V-', 'left', '18 AWG', FERRULE),
    ...data('Din', 'left'),
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
