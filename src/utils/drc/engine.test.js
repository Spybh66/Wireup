import { describe, it, expect } from 'vitest';
import { runDrc } from './engine';

// Minimal node/edge builders using real built-in definitions.
let pid = 0;
const node = (definitionId, label, data = {}) => ({
  id: `n${++pid}`,
  type: 'component',
  position: { x: 0, y: 0 },
  data: { definitionId, label, ports: [], canId: null, ipAddress: null, ...data },
});
const port = (id, type, label = type, side = 'left') => ({ id, type, label, side, order: 0 });
const edge = (id, source, sourceHandle, target, targetHandle, type) => ({
  id,
  source,
  sourceHandle,
  target,
  targetHandle,
  data: { type },
});

const findIds = (res, ruleId) => res.violations.filter((v) => v.ruleId === ruleId);

describe('DRC engine', () => {
  it('flags duplicate CAN IDs only within the same device type', () => {
    const a = node('krakenx60', 'K1', { canId: 3, ports: [port('a-can', 'CAN')] });
    const b = node('krakenx60', 'K2', { canId: 3, ports: [port('b-can', 'CAN')] });
    const c = node('pigeon2', 'P', { canId: 3, ports: [port('c-can', 'CAN')] }); // diff class, same id → ok
    const res = runDrc({ nodes: [a, b, c], edges: [] });
    const dups = findIds(res, 'duplicate-can-id');
    expect(dups).toHaveLength(1);
    expect(dups[0].nodes.sort()).toEqual([a.id, b.id].sort());
  });

  it('flags duplicate IPs across any devices', () => {
    const a = node('roborio2', 'RIO', { ipAddress: '10.0.0.2' });
    const b = node('orangepi5', 'Pi', { ipAddress: '10.0.0.2' });
    const res = runDrc({ nodes: [a, b], edges: [] });
    expect(findIds(res, 'duplicate-ip')).toHaveLength(1);
  });

  it('flags an unconnected CAN device and unpowered consumer', () => {
    const k = node('krakenx60', 'K', {
      canId: 1,
      ports: [port('k-can', 'CAN'), port('k-pwr', 'PWR')],
    });
    const res = runDrc({ nodes: [k], edges: [] });
    expect(findIds(res, 'unconnected-can')).toHaveLength(1);
    expect(findIds(res, 'unpowered-device')).toHaveLength(1);
    expect(findIds(res, 'floating-component')).toHaveLength(1);
  });

  it('does not flag a power SOURCE as unpowered', () => {
    const bat = node('battery', 'Battery', { ports: [port('b-pwr', 'PWR')] });
    const res = runDrc({ nodes: [bat], edges: [] });
    expect(findIds(res, 'unpowered-device')).toHaveLength(0);
  });

  it('flags a fragmented CAN bus (two separate groups)', () => {
    const a = node('krakenx60', 'A', { canId: 1, ports: [port('a-can', 'CAN')] });
    const b = node('krakenx60', 'B', { canId: 2, ports: [port('b-can', 'CAN')] });
    const c = node('krakenx60', 'C', { canId: 3, ports: [port('c-can', 'CAN')] });
    const d = node('krakenx60', 'D', { canId: 4, ports: [port('d-can', 'CAN')] });
    const edges = [
      edge('e1', a.id, 'a-can', b.id, 'b-can', 'CAN'), // group 1
      edge('e2', c.id, 'c-can', d.id, 'd-can', 'CAN'), // group 2
    ];
    const res = runDrc({ nodes: [a, b, c, d], edges });
    expect(findIds(res, 'can-bus-fragmented')).toHaveLength(1);
  });

  it('does not flag a single connected CAN bus', () => {
    const a = node('krakenx60', 'A', { canId: 1, ports: [port('a-can', 'CAN')] });
    const b = node('krakenx60', 'B', { canId: 2, ports: [port('b-can', 'CAN')] });
    const edges = [edge('e1', a.id, 'a-can', b.id, 'b-can', 'CAN')];
    const res = runDrc({ nodes: [a, b], edges });
    expect(findIds(res, 'can-bus-fragmented')).toHaveLength(0);
  });

  it('flags an overloaded power port', () => {
    const pdh = node('pdh', 'PDH', { ports: [port('ch', 'PWR', 'CH0', 'right')] });
    const m1 = node('krakenx60', 'M1', { ports: [port('m1', 'PWR')] });
    const m2 = node('krakenx60', 'M2', { ports: [port('m2', 'PWR')] });
    const edges = [
      edge('e1', pdh.id, 'ch', m1.id, 'm1', 'PWR'),
      edge('e2', pdh.id, 'ch', m2.id, 'm2', 'PWR'),
    ];
    const res = runDrc({ nodes: [pdh, m1, m2], edges });
    const over = findIds(res, 'channel-oversubscribed');
    expect(over).toHaveLength(1);
    expect(over[0].edges.sort()).toEqual(['e1', 'e2']);
  });

  it('applies per-rule severity overrides (and off = skip)', () => {
    const k = node('krakenx60', 'K', { canId: 1, ports: [port('k-can', 'CAN')] });
    // unconnected-can defaults to warning; override to error
    const res = runDrc({ nodes: [k], edges: [] }, { severityOverrides: { 'unconnected-can': 'error' } });
    const v = findIds(res, 'unconnected-can');
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('error');

    // 'off' removes it entirely
    const res2 = runDrc({ nodes: [k], edges: [] }, { severityOverrides: { 'unconnected-can': 'off' } });
    expect(findIds(res2, 'unconnected-can')).toHaveLength(0);
  });

  it('flags missing CAN ID and respects disabled rules', () => {
    const k = node('krakenx60', 'K', { canId: null, ports: [port('k-can', 'CAN')] });
    const res = runDrc({ nodes: [k], edges: [] });
    expect(findIds(res, 'missing-can-id')).toHaveLength(1);

    const res2 = runDrc({ nodes: [k], edges: [] }, ['missing-can-id', 'unconnected-can', 'floating-component']);
    expect(findIds(res2, 'missing-can-id')).toHaveLength(0);
    expect(findIds(res2, 'unconnected-can')).toHaveLength(0);
  });
});
