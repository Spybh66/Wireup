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
  'Molex SL',
  'Ring Terminal',
  'Ferrule',
  'Wago Lever Nut',
  'JST',
  'Bullet',
  'Barrel Jack',
  'USB-A',
  'USB-C',
  'Bare Wire',
];

// Power-distribution branch protection. Full-size channels (PDH ch 0–19, PDP)
// take ATO blade circuit breakers; miniature/low-current channels (PDH ch
// 20–23, REV MPM) take small ATM blade fuses. The valid amp ratings differ, so
// the per-channel editor offers the right set based on each port's `slot`.
export const BREAKER_RATINGS = [10, 20, 30, 40]; // ATO breaker (40 A branch max, R619)
export const FUSE_RATINGS = [1, 2, 3, 5, 7.5, 10, 15]; // ATM mini blade fuse (15 A max/ch)

// Valid amp ratings for a port's protection slot ('fuse' → mini fuses, else
// full-size breakers). Defaults to breaker ratings for legacy/undefined slots.
export function slotRatings(slot) {
  return slot === 'fuse' ? FUSE_RATINGS : BREAKER_RATINGS;
}

// Approximate continuous current capacity (amps) per gauge for chassis/robot
// power wiring. Advisory values used by the DRC gauge-vs-current check.
export const GAUGE_AMPACITY = {
  '2 AWG': 200,
  '4 AWG': 150,
  '6 AWG': 115,
  '8 AWG': 73,
  '10 AWG': 55,
  '12 AWG': 41,
  '14 AWG': 32,
  '16 AWG': 22,
  '18 AWG': 16,
  '20 AWG': 11,
  '22 AWG': 7,
};

// Max continuous amps a gauge can carry (null if unknown).
export function ampacityForGauge(gauge) {
  return GAUGE_AMPACITY[gauge] ?? null;
}

// Numeric AWG of a gauge string ('12 AWG' → 12). Lower = thicker. null if N/A.
export function awgNumber(gauge) {
  const n = parseInt(gauge, 10);
  return Number.isFinite(n) ? n : null;
}

// FRC R622 — minimum wire gauge required for a branch breaker rating, as an AWG
// number (wire's AWG number must be ≤ this). null = no specific minimum (≤10 A).
export function requiredAwgForBreaker(amps) {
  if (amps > 30) return 12; // up to 40 A
  if (amps > 20) return 14; // 21–30 A
  if (amps > 10) return 18; // 11–20 A
  return null;
}

// The required minimum gauge as a label ('12 AWG'), or null.
export function requiredGaugeForBreaker(amps) {
  const n = requiredAwgForBreaker(amps);
  return n == null ? null : `${n} AWG`;
}

// Smallest gauge from GAUGE_OPTIONS rated for the given current (or null).
export function minGaugeForAmps(amps) {
  for (let i = GAUGE_OPTIONS.length - 1; i >= 0; i--) {
    if (ampacityForGauge(GAUGE_OPTIONS[i]) >= amps) return GAUGE_OPTIONS[i];
  }
  return null;
}

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
