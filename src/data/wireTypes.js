// §3 Wire Type System — colors, label groups, default layers, gauges, fittings.

// Port/wire types (§2.3)
export const PORT_TYPES = ['PWR', 'CAN', 'ETH', 'USB', 'DATA'];

// §3.1 — default color (hex), label group, default layer name per type.
// `color2` (optional) makes a striped two-tone wire: PWR = red/black,
// CAN = yellow/green (the FRC wiring convention). The "black" is a visible
// dark gray so the stripe reads against the dark canvas.
export const WIRE_TYPE_INFO = {
  PWR: { color: '#ef4444', color2: '#52525b', group: 'PWR', layer: 'Power' },
  CAN: { color: '#eab308', color2: '#22c55e', group: 'CAN', layer: 'CAN Bus' },
  ETH: { color: '#3b82f6', group: 'ETH', layer: 'Ethernet' },
  USB: { color: '#a855f7', group: 'USB', layer: 'USB' },
  DATA: { color: '#9ca3af', group: 'DATA', layer: 'Data' },
};

export function typeColor(type) {
  return WIRE_TYPE_INFO[type]?.color ?? '#9ca3af';
}

// Secondary stripe color, or null for solid (single-color) wires.
export function typeColor2(type) {
  return WIRE_TYPE_INFO[type]?.color2 ?? null;
}

export function typeGroup(type) {
  return WIRE_TYPE_INFO[type]?.group ?? 'DATA';
}

export function defaultLayerNameForType(type) {
  return WIRE_TYPE_INFO[type]?.layer ?? 'Data';
}

// Types that carry a gauge + fitting (PWR and CAN). ETH/USB/DATA do not.
export function typeHasGaugeFitting(type) {
  return type === 'PWR' || type === 'CAN';
}

// §3.4 — option lists
export const GAUGE_OPTIONS = [
  '2 AWG',
  '4 AWG',
  '6 AWG',
  '8 AWG',
  '10 AWG',
  '12 AWG',
  '14 AWG',
  '16 AWG',
  '18 AWG',
  '20 AWG',
  '22 AWG',
];

export const FITTING_OPTIONS = [
  'Anderson Powerpole',
  'Anderson SB50',
  'Ring Terminal',
  'Ferrule',
  'Wago Lever Nut',
  'JST',
  'Bare Wire',
];

// §3.4 — type defaults when a port doesn't specify gauge/fitting.
export function defaultGaugeForType(type) {
  if (type === 'CAN') return '22 AWG';
  if (type === 'PWR') return '12 AWG';
  return null;
}

export function defaultFittingForType(type) {
  if (type === 'CAN') return 'Wago Lever Nut';
  if (type === 'PWR') return 'Ferrule';
  return null;
}

// §2.5 — five built-in layers (order matters for display).
export const BUILTIN_LAYER_NAMES = ['Power', 'CAN Bus', 'Ethernet', 'USB', 'Data'];

export const SILVER = '#d4d4d8';
