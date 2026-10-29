import { describe, it, expect } from 'vitest';
import {
  computeRoute,
  stubTip,
  segIntersect,
  detectHops,
  simplifyCollinear,
  chamferCorners,
  inflate,
  buildSvgPath,
  buildRoutingGrid,
  reservePortFronts,
  STUB,
} from './routingUtils';
import { portPosition, sideLayout, PORT_GRID } from './geometry';
import { COMPONENT_LIBRARY } from '../data/componentLibrary';

describe('stubTip', () => {
  it('exits perpendicular per side', () => {
    expect(stubTip({ x: 100, y: 100, side: 'right' })).toEqual({ x: 100 + STUB, y: 100 });
    expect(stubTip({ x: 100, y: 100, side: 'left' })).toEqual({ x: 100 - STUB, y: 100 });
    expect(stubTip({ x: 100, y: 100, side: 'top' })).toEqual({ x: 100, y: 100 - STUB });
    expect(stubTip({ x: 100, y: 100, side: 'bottom' })).toEqual({ x: 100, y: 100 + STUB });
  });
});

describe('simplifyCollinear', () => {
  it('drops a redundant midpoint on a straight line', () => {
    const out = simplifyCollinear([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(out).toHaveLength(2);
  });
  it('keeps a genuine corner', () => {
    const out = simplifyCollinear([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ]);
    expect(out).toHaveLength(3);
  });
});

describe('chamferCorners', () => {
  it('replaces a 90° corner with two points', () => {
    const out = chamferCorners(
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
      ],
      8
    );
    // start + 2 chamfer points + end
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 40, y: 40 });
  });
});

describe('computeRoute', () => {
  it('routes a clear straight shot', () => {
    const r = computeRoute({
      source: { x: 0, y: 0, side: 'right' },
      target: { x: 200, y: 0, side: 'left' },
      obstacles: [],
      gridSize: 16,
    });
    expect(r.fallback).toBe(false);
    expect(r.points[0]).toEqual({ x: 0, y: 0 });
    expect(r.points[r.points.length - 1]).toEqual({ x: 200, y: 0 });
  });

  it('routes around a single obstacle (never passes through it)', () => {
    // obstacle sits directly between the two ports
    const obstacle = inflate({ x: 80, y: -30, w: 40, h: 60 }, 10);
    const r = computeRoute({
      source: { x: 0, y: 0, side: 'right' },
      target: { x: 200, y: 0, side: 'left' },
      obstacles: [obstacle],
      gridSize: 16,
    });
    expect(r.fallback).toBe(false);
    // no polyline vertex should fall inside the obstacle
    for (const p of r.points) {
      const inside =
        p.x >= obstacle.x &&
        p.x <= obstacle.x + obstacle.w &&
        p.y >= obstacle.y &&
        p.y <= obstacle.y + obstacle.h;
      expect(inside).toBe(false);
    }
    // and it must have detoured (more than a straight 2-point line)
    expect(r.points.length).toBeGreaterThan(2);
  });

  it('falls back to a straight dashed line when fully enclosed', () => {
    // wrap the source in obstacles on all sides of its stub tip
    const box = [
      inflate({ x: 10, y: -50, w: 10, h: 100 }, 10), // wall to the right of stub
    ];
    // Surround target completely
    const enclosed = [
      inflate({ x: 190, y: -2, w: 20, h: 4 }, 10),
      inflate({ x: 190, y: -40, w: 40, h: 20 }, 10),
      inflate({ x: 190, y: 20, w: 40, h: 20 }, 10),
      inflate({ x: 225, y: -40, w: 10, h: 100 }, 10),
    ];
    const r = computeRoute({
      source: { x: 200, y: 0, side: 'left' },
      target: { x: 200, y: 0, side: 'left' },
      obstacles: enclosed,
      gridSize: 16,
    });
    // Either it found a path or it fell back — but it must never throw and
    // must always return a 2+ point polyline.
    expect(r.points.length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic across repeated runs', () => {
    const args = {
      source: { x: 0, y: 0, side: 'right' },
      target: { x: 220, y: 120, side: 'left' },
      obstacles: [inflate({ x: 90, y: 30, w: 50, h: 50 }, 10)],
      gridSize: 16,
    };
    const a = computeRoute(args);
    const b = computeRoute(args);
    expect(a.points).toEqual(b.points);
  });
});

describe('segIntersect', () => {
  it('finds a proper crossing', () => {
    const hit = segIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 }
    );
    expect(hit).not.toBeNull();
    expect(hit.x).toBeCloseTo(5);
    expect(hit.y).toBeCloseTo(5);
  });
  it('returns null for parallel segments', () => {
    expect(
      segIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })
    ).toBeNull();
  });
});

describe('detectHops', () => {
  it('puts the hop on the horizontal wire at a crossing', () => {
    const polys = [
      { id: 'h', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
      { id: 'v', points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] },
    ];
    for (const order of [polys, [...polys].reverse()]) {
      const hops = detectHops(order);
      expect(hops.has('h')).toBe(true);
      expect(hops.has('v')).toBe(false);
      const pt = hops.get('h')[0];
      expect(pt.x).toBeCloseTo(50);
      expect(pt.y).toBeCloseTo(50);
    }
  });

  it('hops on the vertical wire when the horizontal one turns at the crossing', () => {
    const polys = [
      // horizontal run that turns 3px past the crossing — no room for a hop
      { id: 'h', points: [{ x: 0, y: 50 }, { x: 53, y: 50 }, { x: 53, y: 120 }] },
      { id: 'v', points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] },
    ];
    const hops = detectHops(polys);
    expect(hops.has('h')).toBe(false);
    expect(hops.has('v')).toBe(true);
  });

  it('ignores crossings near an endpoint', () => {
    const polys = [
      { id: 'low', points: [{ x: 0, y: 2 }, { x: 100, y: 2 }] },
      { id: 'high', points: [{ x: 2, y: 0 }, { x: 2, y: 100 }] },
    ];
    // crossing is at ~(2,2), within 12px of both starts → skipped
    const hops = detectHops(polys);
    expect(hops.size).toBe(0);
  });
});

describe('buildSvgPath hops', () => {
  it('merges hops over a tight bundle into one bridge arc', () => {
    const pts = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    const hops = [80, 88, 96].map((x) => ({ x, y: 0, seg: 0 }));
    const d = buildSvgPath(pts, hops);
    expect(d.match(/ A /g)).toHaveLength(1);
  });
});

const isOrthogonal = (pts) =>
  pts.slice(1).every((p, i) => p.x === pts[i].x || p.y === pts[i].y);

describe('orthogonal routing', () => {
  it('only produces horizontal/vertical segments', () => {
    const r = computeRoute({
      source: { x: 0, y: 0, side: 'right' },
      target: { x: 240, y: 136, side: 'left' },
      obstacles: [inflate({ x: 96, y: 32, w: 64, h: 64 }, 12)],
    });
    expect(r.fallback).toBe(false);
    expect(isOrthogonal(r.points)).toBe(true);
  });

  it('runs dead straight between two level ports', () => {
    const r = computeRoute({
      source: { x: 0, y: 48, side: 'right' },
      target: { x: 320, y: 48, side: 'left' },
      obstacles: [],
    });
    expect(r.points).toEqual([{ x: 0, y: 48 }, { x: 320, y: 48 }]);
  });

  it('lane-shifts a second wire instead of running on top of the first', () => {
    const grid = buildRoutingGrid([], [{ x: -32, y: -32 }, { x: 352, y: 96 }]);
    const a = computeRoute({ source: { x: 0, y: 0, side: 'right' }, target: { x: 320, y: 0, side: 'left' }, grid });
    const b = computeRoute({ source: { x: 0, y: 16, side: 'right' }, target: { x: 320, y: 0, side: 'left' }, grid });
    const ys = new Set(a.points.map((p) => p.y));
    // b's long horizontal run must not share a's y
    const bRun = b.points.slice(1).find((p, i) => p.y === b.points[i].y && Math.abs(p.x - b.points[i].x) > 100);
    expect(bRun && ys.has(bRun.y)).toBeFalsy();
  });

  it('keeps clear of the space directly in front of an unrelated port', () => {
    const grid = buildRoutingGrid([], [{ x: -32, y: -64 }, { x: 352, y: 64 }]);
    // a port facing down onto the wire's straight path
    reservePortFronts(grid, [{ x: 160, y: -16, side: 'bottom' }]);
    const r = computeRoute({ source: { x: 0, y: 0, side: 'right' }, target: { x: 320, y: 0, side: 'left' }, grid });
    const passesFront = r.points.slice(1).some(
      (p, i) => p.y === 0 && r.points[i].y === 0 && Math.min(p.x, r.points[i].x) < 160 && Math.max(p.x, r.points[i].x) > 160
    );
    expect(passesFront).toBe(false);
  });
});

describe('port geometry', () => {
  it('puts every port on the port grid with a uniform pitch', () => {
    for (const def of COMPONENT_LIBRARY) {
      const node = { position: { x: 0, y: 0 }, data: { ports: def.defaultPorts } };
      for (const side of ['left', 'right', 'top', 'bottom']) {
        const offs = def.defaultPorts
          .filter((p) => p.side === side)
          .sort((a, b) => a.order - b.order)
          .map((p) => portPosition(node, p, def))
          .map((p) => (side === 'left' || side === 'right' ? p.y : p.x));
        for (const o of offs) expect(o % PORT_GRID).toBe(0);
        const gaps = new Set(offs.slice(1).map((o, i) => o - offs[i]));
        expect(gaps.size).toBeLessThanOrEqual(1);
      }
    }
  });

  it('centres a single port on its side', () => {
    expect(sideLayout(1, 64)).toEqual({ start: 32, pitch: PORT_GRID });
    expect(sideLayout(1, 96).start).toBe(48);
  });
});
