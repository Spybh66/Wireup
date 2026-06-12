// §6 Wire routing engine — visibility-graph any-angle routing + crossing hops.
// Pure functions; no React/DOM. Unit-tested in routingUtils.test.js.

export const STUB = 16;         // perpendicular exit stub length (px)
export const PAD  = 10;         // obstacle inflation (px)
const HOP_R       = 5;          // crossing hop arc radius (px)
const BEND_COST   = 80;         // A* cost penalty per direction change
const WIRE_PROX_PENALTY = 0.5;  // extra cost per pixel running close to an existing wire
const PROX_DIST   = 8;          // px — "too close" proximity threshold
const CORNER_EPS  = 0.5;        // nudge vis-graph corners just off rect edges

// Kept for backward compatibility.
export function getDirType(dx, dy) {
  if (Math.abs(dy) < 0.5) return 'H';
  if (Math.abs(dx) < 0.5) return 'V';
  return dx * dy > 0 ? 'D1' : 'D2';
}

// Sequential path tracking — wirePolylines is an array of already-routed
// point-arrays. markWirePath pushes the new wire in so later wires can apply a
// proximity cost when passing near it.
export function markWirePath(points, _cell, wirePolylines) {
  if (Array.isArray(wirePolylines)) wirePolylines.push(points);
}

// ---------- geometry helpers ----------
export function inflate(rect, pad) {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad };
}

function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function stubTip(p) {
  switch (p.side) {
    case 'top':    return { x: p.x, y: p.y - STUB };
    case 'bottom': return { x: p.x, y: p.y + STUB };
    case 'left':   return { x: p.x - STUB, y: p.y };
    case 'right':
    default:       return { x: p.x + STUB, y: p.y };
  }
}

// ---------- visibility-graph helpers ----------

// Strict segment–segment intersection (touching endpoints not counted).
function segsIntersectStrict(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax, d1y = by - ay;
  const d2x = dx - cx, d2y = dy - cy;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / denom;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / denom;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

// Returns true when segment a→b passes clear of every obstacle's interior.
function segClear(a, b, obstacles) {
  for (const r of obstacles) {
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    if (maxX <= r.x || minX >= r.x + r.w || maxY <= r.y || minY >= r.y + r.h) continue;
    if (pointInRect(a.x, a.y, r) || pointInRect(b.x, b.y, r)) return false;
    if (segsIntersectStrict(a.x, a.y, b.x, b.y, r.x,       r.y,       r.x + r.w, r.y      )) return false;
    if (segsIntersectStrict(a.x, a.y, b.x, b.y, r.x + r.w, r.y,       r.x + r.w, r.y + r.h)) return false;
    if (segsIntersectStrict(a.x, a.y, b.x, b.y, r.x + r.w, r.y + r.h, r.x,       r.y + r.h)) return false;
    if (segsIntersectStrict(a.x, a.y, b.x, b.y, r.x,       r.y + r.h, r.x,       r.y      )) return false;
  }
  return true;
}

// Squared distance from point to segment.
function ptSegDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2;
}

// Additional A* cost for a segment that runs close to already-routed wires.
function wireProxCost(a, b, wirePolylines) {
  if (!wirePolylines || wirePolylines.length === 0) return 0;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return 0;
  const proxSq = PROX_DIST * PROX_DIST;
  const steps = Math.max(2, Math.ceil(len / 12));
  const segLen = len / steps;
  let cost = 0;
  for (let s = 0; s < steps; s++) {
    const t = (s + 0.5) / steps;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    let near = false;
    outer: for (const poly of wirePolylines) {
      for (let i = 0; i < poly.length - 1; i++) {
        if (ptSegDistSq(px, py, poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y) < proxSq) {
          near = true;
          break outer;
        }
      }
    }
    if (near) cost += WIRE_PROX_PENALTY * segLen;
  }
  return cost;
}

// Tiny binary min-heap.
function makeHeap() {
  const h = [];
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[i].f < h[p].f) { [h[i], h[p]] = [h[p], h[i]]; i = p; } else break;
    }
  };
  const dn = (i) => {
    for (;;) {
      const l = 2 * i + 1, r = 2 * i + 2;
      let m = i;
      if (l < h.length && h[l].f < h[m].f) m = l;
      if (r < h.length && h[r].f < h[m].f) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m], h[i]]; i = m;
    }
  };
  return {
    push(x) { h.push(x); up(h.length - 1); },
    pop()   { const top = h[0]; const last = h.pop(); if (h.length) { h[0] = last; dn(0); } return top; },
    get length() { return h.length; },
  };
}

// Visibility-graph A* from stub s to stub t.
// Returns the intermediate waypoints (obstacle corners to route through),
// or null when no path exists.
function visgraphRoute(s, t, obstacles, wirePolylines) {
  // Node 0 = s (source stub tip), Node 1 = t (target stub tip),
  // then the 4 epsilon-nudged corners of every obstacle.
  const nodes = [s, t];
  for (const r of obstacles) {
    const e = CORNER_EPS;
    const candidates = [
      { x: r.x - e,        y: r.y - e        },
      { x: r.x + r.w + e,  y: r.y - e        },
      { x: r.x - e,        y: r.y + r.h + e  },
      { x: r.x + r.w + e,  y: r.y + r.h + e  },
    ];
    // Skip corners that fall inside another obstacle.
    for (const c of candidates) {
      if (!obstacles.some((o) => pointInRect(c.x, c.y, o))) nodes.push(c);
    }
  }
  const N = nodes.length;
  const S = 0, T = 1;

  // Precompute pairwise line-of-sight — O(N² × |obstacles|).
  const vis = new Uint8Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++)
      if (segClear(nodes[i], nodes[j], obstacles))
        vis[i * N + j] = vis[j * N + i] = 1;

  const gScore   = new Float64Array(N).fill(Infinity);
  const cameFrom = new Int32Array(N).fill(-1);
  gScore[S] = 0;

  const heap = makeHeap();
  heap.push({ i: S, f: Math.hypot(t.x - s.x, t.y - s.y) });
  const closed = new Uint8Array(N);

  while (heap.length) {
    const { i: ci } = heap.pop();
    if (closed[ci]) continue;
    closed[ci] = 1;
    if (ci === T) break;

    for (let j = 0; j < N; j++) {
      if (!vis[ci * N + j] || closed[j]) continue;
      const d = Math.hypot(nodes[j].x - nodes[ci].x, nodes[j].y - nodes[ci].y);

      // Bend penalty for any direction change from the incoming segment.
      let bendCost = 0;
      const prev = cameFrom[ci];
      if (prev >= 0) {
        const ax = nodes[ci].x - nodes[prev].x, ay = nodes[ci].y - nodes[prev].y;
        const bx = nodes[j].x  - nodes[ci].x,  by = nodes[j].y  - nodes[ci].y;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (la > 0 && lb > 0 && (ax * bx + ay * by) / (la * lb) < 0.9999) bendCost = BEND_COST;
      }

      const proxCost = wireProxCost(nodes[ci], nodes[j], wirePolylines);
      const tentative = gScore[ci] + d + bendCost + proxCost;
      if (tentative < gScore[j]) {
        gScore[j] = tentative;
        cameFrom[j] = ci;
        heap.push({ i: j, f: tentative + Math.hypot(nodes[T].x - nodes[j].x, nodes[T].y - nodes[j].y) });
      }
    }
  }

  if (gScore[T] === Infinity) return null;

  // Reconstruct: walk cameFrom from T back to S, build forward path.
  const path = [];
  const seen = new Set();
  let k = T;
  while (k >= 0 && !seen.has(k)) {
    seen.add(k);
    path.unshift(k);
    if (k === S) break;
    k = cameFrom[k];
  }
  if (path[0] !== S) return null;
  // Return intermediate waypoints only (not S=sStub nor T=tStub).
  return path.slice(1, -1).map((idx) => nodes[idx]);
}

// Remove middle point of any 3 collinear consecutive points.
export function simplifyCollinear(points) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

// Compute a full polyline for one edge (port → stub → route → stub → port).
// wireOccupied is now an array of already-routed polylines (kept as param name
// to avoid changing routeGraph.js call-sites).
export function computeRoute({ source, target, obstacles, gridSize = 16, wireOccupied = null }) {
  const sStub = stubTip(source);
  const tStub = stubTip(target);
  const wirePolylines = wireOccupied;

  // Fast path: direct line when stubs have clear line-of-sight.
  if (segClear(sStub, tStub, obstacles)) {
    return {
      points: simplifyCollinear([
        { x: source.x, y: source.y },
        sStub,
        tStub,
        { x: target.x, y: target.y },
      ]),
      fallback: false,
    };
  }

  // Visibility-graph route around obstacles.
  const waypoints = visgraphRoute(sStub, tStub, obstacles, wirePolylines);
  if (!waypoints) {
    return { points: [{ x: source.x, y: source.y }, { x: target.x, y: target.y }], fallback: true };
  }

  return {
    points: simplifyCollinear([
      { x: source.x, y: source.y },
      sStub,
      ...waypoints,
      tStub,
      { x: target.x, y: target.y },
    ]),
    fallback: false,
  };
}

// ---------- crossing detection ----------
// Segment intersection (proper crossing). Returns point or null.
export function segIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y, t };
}

const ENDPOINT_SKIP = 12; // ignore crossings within 12px of either path's ends

function nearEndpoint(pt, poly) {
  const a = poly[0];
  const b = poly[poly.length - 1];
  return (
    Math.hypot(pt.x - a.x, pt.y - a.y) < ENDPOINT_SKIP ||
    Math.hypot(pt.x - b.x, pt.y - b.y) < ENDPOINT_SKIP
  );
}

// orderedPolys: [{ id, points }] in z-order (later = higher, hops over earlier).
// Returns Map<id, Array<{x,y}>> of crossing points the edge must hop over.
export function detectHops(orderedPolys) {
  const hops = new Map();
  for (let j = 0; j < orderedPolys.length; j++) {
    const hi = orderedPolys[j];
    const list = [];
    for (let i = 0; i < j; i++) {
      const lo = orderedPolys[i];
      for (let a = 0; a < hi.points.length - 1; a++) {
        for (let b = 0; b < lo.points.length - 1; b++) {
          const hit = segIntersect(
            hi.points[a],
            hi.points[a + 1],
            lo.points[b],
            lo.points[b + 1]
          );
          if (!hit) continue;
          if (nearEndpoint(hit, hi.points) || nearEndpoint(hit, lo.points)) continue;
          list.push({ x: hit.x, y: hit.y, seg: a });
        }
      }
    }
    if (list.length) hops.set(hi.id, list);
  }
  return hops;
}

// ---------- SVG path building ----------
// Build an SVG path string, inserting semicircular hops at the given crossings.
export function buildSvgPath(points, hops = []) {
  if (!points.length) return '';
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segHops = hops
      .filter((h) => h.seg === i)
      .map((h) => ({ ...h, dist: Math.hypot(h.x - a.x, h.y - a.y) }))
      .sort((p, q) => p.dist - q.dist);
    if (!segHops.length) {
      d += ` L ${round(b.x)} ${round(b.y)}`;
      continue;
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    let cursor = a;
    for (const h of segHops) {
      // skip hops too close to the segment ends to fit the arc
      if (h.dist < HOP_R || h.dist > len - HOP_R) continue;
      const entry = { x: h.x - ux * HOP_R, y: h.y - uy * HOP_R };
      const exit = { x: h.x + ux * HOP_R, y: h.y + uy * HOP_R };
      d += ` L ${round(entry.x)} ${round(entry.y)}`;
      // sweep=1 gives a consistent bulge to one side of travel
      d += ` A ${HOP_R} ${HOP_R} 0 0 1 ${round(exit.x)} ${round(exit.y)}`;
      cursor = exit;
    }
    d += ` L ${round(b.x)} ${round(b.y)}`;
  }
  return d;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// Midpoint of a polyline (for label placement).
export function polylineMidpoint(points) {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  let total = 0;
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segs.push(len);
    total += len;
  }
  let half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const f = segs[i] === 0 ? 0 : half / segs[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * f,
        y: points[i].y + (points[i + 1].y - points[i].y) * f,
      };
    }
    half -= segs[i];
  }
  return points[points.length - 1];
}
