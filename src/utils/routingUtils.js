// §6 Wire routing engine — obstacle-avoiding A* + crossing hops.
// Pure functions; no React/DOM. Unit-tested in routingUtils.test.js.

export const STUB = 16; // perpendicular exit stub length (px)
export const PAD = 10; // obstacle inflation (px)
export const EXPAND = 250; // A* bounding-box expansion (px)
const BEND = 10; // bend penalty (step units) — high value keeps paths straight
const DIAG = Math.SQRT2; // diagonal step cost
const HOP_R = 5; // crossing hop radius (px)
const WIRE_OVERLAP_PENALTY = 20; // extra cost to enter a cell another wire already uses in same direction

// ---------- wire occupancy helpers (for sequential routing §6.5) ----------
// dirType: 'H' = horizontal, 'V' = vertical, 'D1' = NE/SW diagonal, 'D2' = NW/SE diagonal
export function getDirType(dx, dy) {
  if (Math.abs(dy) < 0.5) return 'H';
  if (Math.abs(dx) < 0.5) return 'V';
  return dx * dy > 0 ? 'D1' : 'D2';
}

// Mark the lattice cells along a routed wire's inner path (excluding port/stub
// endpoints) into wireOccupied so subsequent wires avoid parallel overlap.
// wireOccupied: Map<"gx,gy", Set<dirType>>  (global grid keys)
export function markWirePath(points, cell, wireOccupied) {
  // Skip first 2 and last 2 points (port position + stub tip at each end).
  const start = Math.min(2, points.length);
  const end = Math.max(points.length - 2, start);
  for (let i = start; i < end - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    const dirType = getDirType(dx, dy);
    const steps = Math.max(1, Math.round(len / cell));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const k = `${Math.round((a.x + dx * t) / cell)},${Math.round((a.y + dy * t) / cell)}`;
      if (!wireOccupied.has(k)) wireOccupied.set(k, new Set());
      wireOccupied.get(k).add(dirType);
    }
  }
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
    case 'top':
      return { x: p.x, y: p.y - STUB };
    case 'bottom':
      return { x: p.x, y: p.y + STUB };
    case 'left':
      return { x: p.x - STUB, y: p.y };
    case 'right':
    default:
      return { x: p.x + STUB, y: p.y };
  }
}

// ---------- A* over a uniform lattice ----------
// source/target: {x, y, side}. obstacles: array of {x,y,w,h} (already inflated).
// wireOccupied: Map<"gx,gy", Set<dirType>> — cells blocked for parallel travel.
// Returns array of lattice points {x,y} (excluding the port/stub endpoints), or
// null when no path is found.
function astar(start, goal, obstacles, cell, bounds, wireOccupied = null) {
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1;
  const rows = Math.ceil((bounds.maxY - bounds.minY) / cell) + 1;
  const toXY = (ix, iy) => ({ x: bounds.minX + ix * cell, y: bounds.minY + iy * cell });

  const free = (ix, iy) => {
    if (ix < 0 || iy < 0 || ix >= cols || iy >= rows) return false;
    const { x, y } = toXY(ix, iy);
    for (const o of obstacles) if (pointInRect(x, y, o)) return false;
    return true;
  };

  // Extra step cost when a routed wire already travels in the same direction
  // through this cell. Uses a penalty instead of hard blocking so the router
  // always finds SOME path on dense diagrams.
  const occupyCost = (ix, iy, dx, dy) => {
    if (!wireOccupied) return 0;
    const { x, y } = toXY(ix, iy);
    const k = `${Math.round(x / cell)},${Math.round(y / cell)}`;
    return wireOccupied.get(k)?.has(getDirType(dx, dy)) ? WIRE_OVERLAP_PENALTY : 0;
  };

  const snap = (pt) => {
    let bix = Math.round((pt.x - bounds.minX) / cell);
    let biy = Math.round((pt.y - bounds.minY) / cell);
    if (free(bix, biy)) return { ix: bix, iy: biy };
    // spiral outward to nearest free lattice node
    for (let r = 1; r < Math.max(cols, rows); r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (free(bix + dx, biy + dy)) return { ix: bix + dx, iy: biy + dy };
        }
      }
    }
    return null;
  };

  const s = snap(start);
  const g = snap(goal);
  if (!s || !g) return null;

  const key = (ix, iy) => iy * cols + ix;
  const startK = key(s.ix, s.iy);
  const goalK = key(g.ix, g.iy);

  // Orthogonal-only moves (no diagonals). Diagonal paths look messy in
  // electrical diagrams and prevent hop-arc detection at crossings.
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const gScore = new Map([[startK, 0]]);
  const cameFrom = new Map();
  const dirIn = new Map(); // incoming direction index per node

  // Manhattan heuristic (exact for orthogonal-only routing)
  const heur = (ix, iy) => Math.abs(ix - g.ix) + Math.abs(iy - g.iy);

  // binary heap with deterministic tie-break (f, then x, then y)
  const heap = [];
  const cmp = (a, b) =>
    a.f - b.f || a.ix - b.ix || a.iy - b.iy;
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cmp(heap[i], heap[p]) < 0) {
        [heap[i], heap[p]] = [heap[p], heap[i]];
        i = p;
      } else break;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < heap.length && cmp(heap[l], heap[m]) < 0) m = l;
        if (r < heap.length && cmp(heap[r], heap[m]) < 0) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };

  push({ ix: s.ix, iy: s.iy, f: heur(s.ix, s.iy) });
  const closed = new Set();

  while (heap.length) {
    const cur = pop();
    const ck = key(cur.ix, cur.iy);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (ck === goalK) break;

    for (let di = 0; di < DIRS.length; di++) {
      const [dx, dy] = DIRS[di];
      const nix = cur.ix + dx;
      const niy = cur.iy + dy;
      if (!free(nix, niy)) continue;
      const nk = key(nix, niy);
      if (closed.has(nk)) continue;
      const prevDir = dirIn.get(ck);
      const turn = prevDir !== undefined && prevDir !== di;
      const step = 1 + (turn ? BEND : 0) + occupyCost(nix, niy, dx, dy);
      const tentative = gScore.get(ck) + step;
      if (!gScore.has(nk) || tentative < gScore.get(nk)) {
        gScore.set(nk, tentative);
        cameFrom.set(nk, ck);
        dirIn.set(nk, di);
        push({ ix: nix, iy: niy, f: tentative + heur(nix, niy) });
      }
    }
  }

  if (!cameFrom.has(goalK) && goalK !== startK) return null;

  // reconstruct
  const path = [];
  let k = goalK;
  while (k !== undefined) {
    const ix = k % cols;
    const iy = Math.floor(k / cols);
    path.push(toXY(ix, iy));
    if (k === startK) break;
    k = cameFrom.get(k);
  }
  path.reverse();
  return path;
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

// Chamfer each interior corner into a short 45° segment when space allows.
export function chamferCorners(points, amount = CHAMFER) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const lenAB = Math.hypot(b.x - a.x, b.y - a.y);
    const lenBC = Math.hypot(c.x - b.x, c.y - b.y);
    const d = Math.min(amount, lenAB / 2, lenBC / 2);
    if (d < 1) {
      out.push(b);
      continue;
    }
    const uxAB = (b.x - a.x) / lenAB;
    const uyAB = (b.y - a.y) / lenAB;
    const uxBC = (c.x - b.x) / lenBC;
    const uyBC = (c.y - b.y) / lenBC;
    out.push({ x: b.x - uxAB * d, y: b.y - uyAB * d });
    out.push({ x: b.x + uxBC * d, y: b.y + uyBC * d });
  }
  out.push(points[points.length - 1]);
  return out;
}

// Compute a full polyline for one edge (port → stub → A* → stub → port).
// Returns { points, fallback }. On A* failure returns a straight 2-point line.
export function computeRoute({ source, target, obstacles, gridSize = 16, wireOccupied = null }) {
  const sStub = stubTip(source);
  const tStub = stubTip(target);
  const cell = Math.max(8, gridSize / 2);

  // Snap ONLY the axis perpendicular to each stub's exit direction so the
  // stub→grid alignment segment is always a clean orthogonal step.
  // • Left/right ports exit horizontally → snap y only (x is already on-grid
  //   because port.x ± STUB inherits the component's snapped position).
  // • Top/bottom ports exit vertically → snap x only.
  const snapC = (v) => Math.round(v / cell) * cell;
  const snapStub = (stub, side) =>
    side === 'left' || side === 'right'
      ? { x: stub.x, y: snapC(stub.y) }
      : { x: snapC(stub.x), y: stub.y };
  const sSnapped = snapStub(sStub, source.side);
  const tSnapped = snapStub(tStub, target.side);

  // Align the A* bounding box to the global cell grid so snapped stub tips
  // always land exactly on a lattice node (eliminates snap() rounding drift).
  const rawMinX = Math.min(sSnapped.x, tSnapped.x) - EXPAND;
  const rawMinY = Math.min(sSnapped.y, tSnapped.y) - EXPAND;
  const minX = Math.floor(rawMinX / cell) * cell;
  const minY = Math.floor(rawMinY / cell) * cell;
  const maxX = Math.ceil((Math.max(sSnapped.x, tSnapped.x) + EXPAND) / cell) * cell;
  const maxY = Math.ceil((Math.max(sSnapped.y, tSnapped.y) + EXPAND) / cell) * cell;

  const lattice = astar(sSnapped, tSnapped, obstacles, cell, { minX, minY, maxX, maxY }, wireOccupied);

  if (!lattice) {
    return { points: [{ x: source.x, y: source.y }, { x: target.x, y: target.y }], fallback: true };
  }

  // Full path: port → stub (perpendicular exit) → snapped-stub (grid alignment,
  // tiny orthogonal jog ≤ cell/2 px) → A* lattice → snapped target stub →
  // target stub → target port.
  // simplifyCollinear merges any consecutive collinear triplets so the path has
  // no redundant interior points (e.g. when the jog is collinear with the route).
  let pts = [
    { x: source.x, y: source.y },
    sStub,
    sSnapped,
    ...lattice,
    tSnapped,
    tStub,
    { x: target.x, y: target.y },
  ];
  pts = simplifyCollinear(pts);
  return { points: pts, fallback: false };
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
