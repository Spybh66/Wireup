import { describe, it, expect } from 'vitest';
import { computeAllRoutes, zoneTitleBox } from './routeGraph';
import { nodeRect } from './geometry';
import { getDefinition } from '../data/componentLibrary';
import sampleProject from '../../examples/example.json';

const LAYERS = [{ id: 'power', visible: true }];

function node(id, defId, x, y) {
  const def = getDefinition(defId);
  return {
    id,
    type: 'component',
    position: { x, y },
    data: { definitionId: defId, ports: def.defaultPorts.map((p) => ({ ...p })) },
  };
}

// Does any segment of the polyline pass through the box's interior?
function crossesBox(points, b) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], c = points[i + 1];
    const x0 = Math.min(a.x, c.x), x1 = Math.max(a.x, c.x);
    const y0 = Math.min(a.y, c.y), y1 = Math.max(a.y, c.y);
    if (x1 > b.x && x0 < b.x + b.w && y1 > b.y && y0 < b.y + b.h) return true;
  }
  return false;
}

describe('zone title keep-out', () => {
  // battery BAT (right side) → breaker IN (left side): a straight run at y=48
  // that a zone's title strip sits right across.
  const battery = node('bat', 'battery', 0, 0);
  const breaker = node('brk', 'mainbreaker', 448, 0);
  const edge = {
    id: 'e1',
    source: 'bat',
    target: 'brk',
    sourceHandle: battery.data.ports[0].id,
    targetHandle: breaker.data.ports[0].id,
    data: { type: 'PWR', layerId: 'power' },
  };
  const zone = { id: 'z', type: 'zone', position: { x: 176, y: 32 }, data: { text: 'Drive', width: 240, height: 160 } };

  it('routes straight when there is no zone', () => {
    const { routes } = computeAllRoutes({ nodes: [battery, breaker], edges: [edge], layers: LAYERS });
    const pts = routes.get('e1').points;
    expect(pts.every((p) => p.y === 48)).toBe(true);
  });

  it('detours around a zone title instead of crossing it', () => {
    const { routes } = computeAllRoutes({ nodes: [battery, breaker, zone], edges: [edge], layers: LAYERS });
    expect(crossesBox(routes.get('e1').points, zoneTitleBox(zone))).toBe(false);
  });

  it('keeps wire labels off the title', () => {
    const labelled = { ...edge, data: { ...edge.data, label: 'PWR001' } };
    const { routes } = computeAllRoutes({ nodes: [battery, breaker, zone], edges: [labelled], layers: LAYERS });
    const { x, y } = routes.get('e1').labelPos;
    const t = zoneTitleBox(zone);
    expect(x > t.x && x < t.x + t.w && y > t.y && y < t.y + t.h).toBe(false);
  });

  it('ignores an untitled zone', () => {
    expect(zoneTitleBox({ position: { x: 0, y: 0 }, data: { text: '  ' } })).toBeNull();
  });
});

// The bundled example is the first thing new users see — keep it clean.
describe('example project layout', () => {
  const { nodes, edges, layers } = sampleProject;
  const { routes, fallbacks } = computeAllRoutes({ nodes, edges, layers });
  const comps = nodes.filter((n) => getDefinition(n.data?.definitionId));
  const zones = nodes.filter((n) => n.type === 'zone');

  it('routes every wire on the lattice', () => {
    expect(fallbacks).toEqual([]);
  });

  it('never runs a wire under a component it does not connect to', () => {
    const bad = [];
    for (const e of edges) {
      const pts = routes.get(e.id).points;
      for (const n of comps) {
        if (n.id === e.source || n.id === e.target) continue;
        if (crossesBox(pts, nodeRect(n, getDefinition(n.data.definitionId)))) bad.push(`${e.data.label} × ${n.data.label}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('puts every wire label nearest its own wire', () => {
    const dist = (x, y, pts) => {
      let best = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
      }
      return best;
    };
    const bad = [];
    for (const e of edges) {
      const { x, y } = routes.get(e.id).labelPos;
      const own = dist(x, y, routes.get(e.id).points);
      const other = edges.find((o) => o.id !== e.id && dist(x, y, routes.get(o.id).points) <= own);
      if (other) bad.push(`${e.data.label} reads as ${other.data.label}`);
    }
    expect(bad).toEqual([]);
  });

  it('keeps wires off zone titles', () => {
    const bad = [];
    for (const e of edges) {
      for (const z of zones) if (crossesBox(routes.get(e.id).points, zoneTitleBox(z))) bad.push(`${e.data.label} × ${z.data.text}`);
    }
    expect(bad).toEqual([]);
  });
});
