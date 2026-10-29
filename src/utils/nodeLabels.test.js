import { describe, it, expect } from 'vitest';
import { nameLayout, NAME_FONT, NAME_MIN_FONT } from './nodeLabels';
import { orientedPorts, nodeSize } from './geometry';
import { getDefinition } from '../data/componentLibrary';

// Layout for a library part at a rotation, as ComponentNode computes it.
function layout(defId, rotation, name, filter = () => true) {
  const def = getDefinition(defId);
  const data = { rotation, ports: def.defaultPorts.filter(filter) };
  return nameLayout(orientedPorts(data.ports, rotation), nodeSize({ data }, def), { name });
}

describe('nameLayout', () => {
  it('uses the middle at full size when there is room', () => {
    const l = layout('krakenx60_adapted', 0, 'Intake Roller');
    expect(l.fontSize).toBe(NAME_FONT);
    expect(l.box.x).toBeGreaterThan(0); // padded clear of the PWR label
  });

  it('wraps between words, never inside one', () => {
    // ThriftyCAM turned 90° is only 64 px wide
    const l = layout('thriftycam', 90, 'ThriftyCAM 1');
    expect(l.lines).toEqual(['ThriftyCAM', '1']);
  });

  it('moves the name off the side-label row when the middle is too narrow', () => {
    // MitoCANdria: PWR IN and the boost output's labels share the middle row
    const l = layout('mitocandria', 0, 'MitoCANdria', (p) => p.type !== 'CAN');
    const def = getDefinition('mitocandria');
    expect(l.lines).toEqual(['MitoCANdria']);
    expect(l.box.w).toBeGreaterThan(def.width / 2);
    expect(l.box.y + l.box.h <= 40 || l.box.y >= 56).toBe(true); // clear of the y=48 row
  });

  it('never goes below the minimum font', () => {
    const l = layout('pigeon2', 90, 'A very long name for a tiny part');
    expect(l.fontSize).toBeGreaterThanOrEqual(NAME_MIN_FONT);
  });
});

describe('nameLayout part type', () => {
  const sized = (defId, rotation, name) => {
    const def = getDefinition(defId);
    const data = { rotation, ports: def.defaultPorts };
    return nameLayout(orientedPorts(data.ports, rotation), nodeSize({ data }, def), { name, sub: def.name });
  };
  it('shows it when it fits whole', () => {
    expect(sized('krakenx60_adapted', 0, 'Hood').showSub).toBe(true);
  });
  it('wraps it between words on a narrow part', () => {
    expect(sized('thriftycam', 90, 'ThriftyCAM 1').subLines).toEqual(['ThriftyCAM', '(ThriftyBot)']);
  });
  it('drops it rather than clipping a word that cannot fit', () => {
    const def = getDefinition('thriftycam');
    const data = { rotation: 90, ports: def.defaultPorts };
    const l = nameLayout(orientedPorts(data.ports, 90), nodeSize({ data }, def), { name: 'Cam', sub: 'Supercalifragilistic' });
    expect(l.showSub).toBe(false);
  });
});
