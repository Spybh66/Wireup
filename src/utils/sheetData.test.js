import { describe, it, expect } from 'vitest';
import { buildBom, conductorsFor } from './sheetData';

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

  it('counts installed connectors from node ports, excluding Bare Wire', () => {
    const node = (ports) => ({ id: 'n1', data: { ports } });
    const { installedConnectors } = buildBom({
      edges: [],
      nodes: [
        node([
          { id: 'p1', installedConnector: 'Molex SL' },
          { id: 'p2', installedConnector: 'Molex SL' },
          { id: 'p3', installedConnector: 'Bare Wire' }, // excluded
          { id: 'p4', installedConnector: null },         // excluded
        ]),
      ],
    });
    expect(installedConnectors).toHaveLength(1);
    expect(installedConnectors[0]).toEqual({ name: 'Molex SL', qty: 2 });
  });

  it('counts single-conductor fittings per CAN conductor (H + L)', () => {
    const { connectors } = buildBom({
      edges: [e({ type: 'CAN', wireGauge: '22 AWG', length: 12, wireFittingFrom: 'Ferrule', wireFittingTo: 'Molex SL' })],
    });
    const qty = (n) => connectors.find((c) => c.name === n)?.qty;
    expect(qty('Ferrule')).toBe(2); // one per conductor
    expect(qty('Molex SL')).toBe(1); // one multi-pole housing
  });

  it('treats motor phase leads as a single conductor', () => {
    const mc = {
      id: 'mc',
      data: { definitionId: 'talonfxs', ports: [{ id: 'u', type: 'PWR', label: 'U' }, { id: 'in', type: 'PWR', label: 'V+/V−' }] },
    };
    const motor = { id: 'm', data: { definitionId: 'minion', ports: [{ id: 'mu', type: 'PWR', label: 'U' }] } };
    const pdh = { id: 'pd', data: { definitionId: 'pdh', ports: [{ id: 'ch', type: 'PWR', label: 'CH0' }] } };
    const phase = { id: 'p1', source: 'mc', sourceHandle: 'u', target: 'm', targetHandle: 'mu',
      data: { type: 'PWR', wireGauge: '12 AWG', length: 10, wireFittingFrom: 'Ring Terminal', wireFittingTo: 'Ring Terminal' } };
    const feed = { id: 'p2', source: 'pd', sourceHandle: 'ch', target: 'mc', targetHandle: 'in',
      data: { type: 'PWR', wireGauge: '12 AWG', length: 20, wireFittingFrom: 'Ferrule', wireFittingTo: 'Ring Terminal' } };
    expect(conductorsFor(phase, [{ port: mc.data.ports[0], category: 'Motor Controllers' }])).toBe(1);
    expect(conductorsFor(feed, [{ port: mc.data.ports[1], category: 'Motor Controllers' }])).toBe(2);

    const { wires, connectors } = buildBom({ nodes: [mc, motor, pdh], edges: [phase, feed] });
    const wire = (c) => wires.find((w) => w.gauge === '12 AWG' && w.color === c)?.lengthIn;
    expect(wire('Red')).toBe(30); // 10 (phase) + 20 (feed +)
    expect(wire('Black')).toBe(20); // feed − only — the phase lead has no black half
    const qty = (n) => connectors.find((c) => c.name === n)?.qty;
    expect(qty('Ring Terminal')).toBe(4); // phase: 1 + 1; feed V+/V− end: 2
    expect(qty('Ferrule')).toBe(2); // feed PDH end: + and −
  });

  it('counts installed Powerpole pigtails on a power pair as red + black', () => {
    const { installedConnectors } = buildBom({
      edges: [],
      nodes: [{ id: 'n', data: { definitionId: 'sparkmax', ports: [{ id: 'p', type: 'PWR', label: 'V+/V−', installedConnector: 'Anderson Powerpole' }] } }],
    });
    expect(installedConnectors).toEqual([
      { name: 'Anderson Powerpole (Black)', qty: 1 },
      { name: 'Anderson Powerpole (Red)', qty: 1 },
    ]);
  });
});
