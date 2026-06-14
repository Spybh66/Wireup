import { describe, it, expect } from 'vitest';
import { buildBom } from './sheetData';

const e = (data) => ({ id: Math.random().toString(36), source: 'a', target: 'b', data });

describe('buildBom', () => {
  it('splits combined wires into conductors and counts connectors correctly', () => {
    const { wires, connectors } = buildBom({
      edges: [
        // PWR: two conductors (red+black); Powerpole → one of each per end
        e({ type: 'PWR', wireGauge: '12 AWG', length: 36, wireFittingFrom: 'Anderson Powerpole', wireFittingTo: 'Anderson Powerpole' }),
        // CAN: two conductors (yellow+green) but ONE connector per end
        e({ type: 'CAN', wireGauge: '22 AWG', length: 24, wireFittingFrom: 'Wago Lever Nut', wireFittingTo: 'Wago Lever Nut' }),
        // SB50 is a 2-pole housing → one per end even for PWR
        e({ type: 'PWR', wireGauge: '6 AWG', length: 12, wireFittingFrom: 'Anderson SB50', wireFittingTo: 'Anderson SB50' }),
      ],
    });
    const wire = (g, c) => wires.find((w) => w.gauge === g && w.color === c)?.lengthIn;
    expect(wire('12 AWG', 'Red')).toBe(36);
    expect(wire('12 AWG', 'Black')).toBe(36);
    expect(wire('22 AWG', 'Yellow')).toBe(24);
    expect(wire('22 AWG', 'Green')).toBe(24);

    const qty = (n) => connectors.find((c) => c.name === n)?.qty;
    expect(qty('Anderson Powerpole (Red)')).toBe(2); // 1 per end × 2 ends
    expect(qty('Anderson Powerpole (Black)')).toBe(2);
    expect(qty('Wago Lever Nut')).toBe(2); // CAN: 1 per end × 2 ends (not per-conductor)
    expect(qty('Anderson SB50')).toBe(2); // single 2-pole housing per end
  });

  it('sums lengths across wires of the same gauge+color and ignores Bare Wire connectors', () => {
    const { wires, connectors } = buildBom({
      edges: [
        e({ type: 'PWR', wireGauge: '12 AWG', length: 10, color: '#ef4444', color2: '#52525b' }),
        e({ type: 'PWR', wireGauge: '12 AWG', length: 5, color: '#ef4444', color2: '#52525b', wireFittingFrom: 'Bare Wire' }),
      ],
    });
    expect(wires.find((w) => w.color === 'Red').lengthIn).toBe(15);
    expect(connectors).toHaveLength(0);
  });
});
