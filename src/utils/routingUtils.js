// §6 Wire routing engine — octilinear (45°) grid router, KiCAD-style.
// Wires run in H/V/45° segments, prefer 45° over square corners, avoid
// overlapping straight runs (occupancy lanes → spaced bundles), and only cross
// perpendicular (rendered with a jump-over hop). Pure functions; no React/DOM.
// Unit-tested in routingUtils.test.js.

export const STUB = 16;         // perpendicular exit stub length (px)
export const PAD  = 12;         // obstacle inflation (px)
export const STEP = 8;          // routing lattice resolution (px)

const HOP_R    = 5;             // crossing hop arc radius (px)
const CORNER_R = 7;             // rounded-corner fillet radius (px)
const DIAG     = Math.SQRT2;
const BEND_45  = STEP * 2.2;    // discourage staircasing into clean 45° runs
const BEND_90  = STEP * 9;      // strong penalty — discourage square corners
const BEND_135 = STEP * 22;     // very strong — discourage sharp turns
const OVERLAP_PENALTY = STEP * 50; // running ON an existing wire's edge → relane
const CROSS_PENALTY   = STEP * 2;  // crossing a perpendicular wire → a hop
const MAX_CELLS = 240000;          // grid-size guard (coarsen step if exceeded)

// Kept for backward compatibility.
export function getDirType(dx, dy) {
  if (Math.abs(dy) < 0.5) return 'H';
  if (Math.abs(dx) < 0.5) return 'V';
  return dx * dy > 0 ? 'D1' : 'D2';
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

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

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

// ---------- routing lattice ----------
// Build a shared octilinear lattice covering all obstacles. Occupancy (occ /
// cellOrient) accumulates as wires are routed so later wires lane-shift off
// existing straight runs and only cross perpendicular wires.
export function buildRoutingGrid(obstacles, extraPoints = [], step = STEP) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of obstacles) {
    minX = Math.min(minX, r.x);        minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);  maxY = Math.max(maxY, r.y + r.h);
  }
  for (const p of extraPoints) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = step; maxY = step; }

  const margin = step * 8;
  minX -= margin; minY -= margin; maxX += margin; maxY += margin;

  // Align the lattice origin to the world STEP grid so grid-snapped ports land
  // exactly on cells (and node edges, which sit on the 16px grid, do too).
  let s = step;
  let originX = Math.floor(minX / s) * s;
  let originY = Math.floor(minY / s) * s;
  let cols = Math.ceil((maxX - originX) / s) + 1;
  let rows = Math.ceil((maxY - originY) / s) + 1;
  while (cols * rows > MAX_CELLS) {
    s *= 2;
    originX = Math.floor(minX / s) * s;
    originY = Math.floor(minY / s) * s;
    cols = Math.ceil((maxX - originX) / s) + 1;
    rows = Math.ceil((maxY - originY) / s) + 1;
  }

  const origin = { x: originX, y: originY };
  const blocked = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const wy = minY + j * s;
    for (let i = 0; i < cols; i++) {
      const wx = minX + i * s;
      for (const r of obstacles) {
        if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) {
          blocked[j * cols + i] = 1;
          break;
        }
      }
    }
  }
  return { origin, step: s, cols, rows, blocked, occ: new Map(), cellOrient: new Map() };
}

function worldToCell(grid, p) {
  return {
    i: clamp(Math.round((p.x - grid.origin.x) / grid.step), 0, grid.cols - 1),
    j: clamp(Math.round((p.y - grid.origin.y) / grid.step), 0, grid.rows - 1),
  };
}
function cellToWorld(grid, c) {
  return { x: grid.origin.x + c.i * grid.step, y: grid.origin.y + c.j * grid.step };
}

function nearestFreeCell(grid, p) {
  const { cols, rows, blocked } = grid;
  const start = worldToCell(grid, p);
  if (!blocked[start.j * cols + start.i]) return start;
  const maxR = Math.max(cols, rows);
  for (let r = 1; r < maxR; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = start.i + di, j = start.j + dj;
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
        if (!blocked[j * cols + i]) return { i, j };
      }
    }
  }
  return start;
}

// 8 lattice directions: E W S N SE NE SW NW (y grows downward).
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const DIR_ANG = DIRS.map(([dx, dy]) => Math.atan2(dy, dx));

function bendCost(prev, next) {
  if (prev === next) return 0;
  let a = Math.abs(DIR_ANG[prev] - DIR_ANG[next]);
  if (a > Math.PI) a = 2 * Math.PI - a;
  const deg = (a * 180) / Math.PI;
  if (deg < 1) return 0;
  if (deg <= 46) return BEND_45;
  if (deg <= 91) return BEND_90;
  if (deg <= 136) return BEND_135;
  return BEND_135 * 1.5;
}

function orientOf(di, dj) {
  if (dj === 0) return 'H';
  if (di === 0) return 'V';
  return di * dj > 0 ? 'D1' : 'D2';
}
function edgeKey(ci, cj, ni, nj) {
  return ci < ni || (ci === ni && cj < nj)
    ? `${ci},${cj}|${ni},${nj}`
    : `${ni},${nj}|${ci},${cj}`;
}

function occCost(grid, ci, cj, ni, nj) {
  let cost = 0;
  if (grid.occ.has(edgeKey(ci, cj, ni, nj))) cost += OVERLAP_PENALTY;
  const set = grid.cellOrient.get(nj * grid.cols + ni);
  if (set) {
    const o = orientOf(Math.sign(ni - ci), Math.sign(nj - cj));
    if (!set.has(o)) cost += CROSS_PENALTY; // perpendicular crossing → a hop
  }
  return cost;
}

// Record a routed lattice path so later wires avoid overlapping it.
function markCells(grid, cells) {
  if (!grid || !cells) return;
  for (let k = 0; k < cells.length - 1; k++) {
    const a = cells[k], b = cells[k + 1];
    grid.occ.set(edgeKey(a.i, a.j, b.i, b.j), true);
    const o = orientOf(Math.sign(b.i - a.i), Math.sign(b.j - a.j));
    for (const c of [a, b]) {
      const ci = c.j * grid.cols + c.i;
      let s = grid.cellOrient.get(ci);
      if (!s) { s = new Set(); grid.cellOrient.set(ci, s); }
      s.add(o);
    }
  }
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

// Octilinear A* over the lattice from start cell to goal cell.
// Returns an array of lattice cells, or null when no path exists.
function aStarGrid(grid, start, goal) {
  const { cols, rows, blocked, step } = grid;
  const N = cols * rows;
  const idx = (i, j) => j * cols + i;
  const sId = idx(start.i, start.j), gId = idx(goal.i, goal.j);

  const g = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const inDir = new Int8Array(N).fill(-1);
  const closed = new Uint8Array(N);
  g[sId] = 0;

  const h = (i, j) => {
    const dx = Math.abs(i - goal.i), dy = Math.abs(j - goal.j);
    const dm = Math.min(dx, dy);
    return (dm * DIAG + (Math.max(dx, dy) - dm)) * step;
  };

  const heap = makeHeap();
  heap.push({ id: sId, f: h(start.i, start.j) });

  while (heap.length) {
    const { id: cur } = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === gId) break;

    const ci = cur % cols, cj = (cur - ci) / cols;
    const pdir = inDir[cur];
    for (let d = 0; d < 8; d++) {
      const di = DIRS[d][0], dj = DIRS[d][1];
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nid = idx(ni, nj);
      if (blocked[nid] || closed[nid]) continue;
      if (d >= 4) {
        // no diagonal corner-cutting past a blocked cell
        if (blocked[idx(ci + di, cj)] || blocked[idx(ci, cj + dj)]) continue;
      }
      let cost = d >= 4 ? DIAG * step : step;
      if (pdir >= 0) cost += bendCost(pdir, d);
      cost += occCost(grid, ci, cj, ni, nj);

      const tentative = g[cur] + cost;
      if (tentative < g[nid]) {
        g[nid] = tentative;
        came[nid] = cur;
        inDir[nid] = d;
        heap.push({ id: nid, f: tentative + h(ni, nj) });
      }
    }
  }

  if (g[gId] === Infinity) return null;
  const cells = [];
  let k = gId;
  while (k !== -1) {
    const i = k % cols, j = (k - i) / cols;
    cells.unshift({ i, j });
    if (k === sId) break;
    k = came[k];
  }
  return cells;
}

// A clear 2-segment octilinear connector (45° diagonal + axis run), or null.
function octilinearDirect(a, b, obstacles) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx < 0.5 && ady < 0.5) return [a, b];
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const diag = Math.min(adx, ady);
  const m1 = { x: a.x + sx * diag, y: a.y + sy * diag }; // diagonal first
  const m2 = { x: b.x - sx * diag, y: b.y - sy * diag }; // axis first
  for (const m of [m1, m2]) {
    if (segClear(a, m, obstacles) && segClear(m, b, obstacles)) return [a, m, b];
  }
  return null;
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

// Chamfer each interior corner into a short diagonal segment when space allows.
export function chamferCorners(points, amount = 8) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const lenAB = Math.hypot(b.x - a.x, b.y - a.y);
    const lenBC = Math.hypot(c.x - b.x, c.y - b.y);
    const d = Math.min(amount, lenAB / 2, lenBC / 2);
    if (d < 1) { out.push(b); continue; }
    const uxAB = (b.x - a.x) / lenAB, uyAB = (b.y - a.y) / lenAB;
    const uxBC = (c.x - b.x) / lenBC, uyBC = (c.y - b.y) / lenBC;
    out.push({ x: b.x - uxAB * d, y: b.y - uyAB * d });
    out.push({ x: b.x + uxBC * d, y: b.y + uyBC * d });
  }
  out.push(points[points.length - 1]);
  return out;
}

// Compute a full polyline for one edge (port → stub → octilinear route → stub →
// port). When `grid` is supplied it is shared across wires: occupancy is read
// for lane spacing and updated with this wire's path.
export function computeRoute({ source, target, obstacles, gridSize = 16, grid = null }) {
  const sStub = stubTip(source);
  const tStub = stubTip(target);

  // Standalone (no shared grid): try a clean direct octilinear connector first.
  if (!grid) {
    const direct = octilinearDirect(sStub, tStub, obstacles);
    if (direct) {
      return {
        points: simplifyCollinear([{ x: source.x, y: source.y }, ...direct, { x: target.x, y: target.y }]),
        fallback: false,
      };
    }
  }

  const lattice = grid || buildRoutingGrid(obstacles, [sStub, tStub]);
  const start = nearestFreeCell(lattice, sStub);
  const goal = nearestFreeCell(lattice, tStub);
  const cells = aStarGrid(lattice, start, goal);

  if (!cells) {
    return { points: [{ x: source.x, y: source.y }, { x: target.x, y: target.y }], fallback: true };
  }
  if (grid) markCells(grid, cells);

  const world = cells.map((c) => cellToWorld(lattice, c));
  return {
    points: simplifyCollinear([
      { x: source.x, y: source.y },
      sStub,
      ...world,
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
// Build an SVG path string with rounded corners (quadratic fillets) for smooth
// transitions, inserting semicircular hops at the given crossings.
export function buildSvgPath(points, hops = [], cornerR = CORNER_R) {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${round(points[0].x)} ${round(points[0].y)}`;
  const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);

  // How far to trim each interior corner so the fillet fits its shorter leg.
  const trim = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    trim[i] = Math.min(cornerR, dist(points[i - 1], points[i]) * 0.45, dist(points[i], points[i + 1]) * 0.45);
  }

  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = dist(a, b) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const startT = trim[i];
    const endT = trim[i + 1];
    const ex = b.x - ux * endT;
    const ey = b.y - uy * endT;

    const segHops = hops
      .filter((h) => h.seg === i)
      .map((h) => ({ ...h, dist: Math.hypot(h.x - a.x, h.y - a.y) }))
      .sort((p, q) => p.dist - q.dist);
    for (const h of segHops) {
      // keep the hop clear of trimmed corners and segment ends
      if (h.dist < startT + HOP_R || h.dist > len - endT - HOP_R) continue;
      const entry = { x: h.x - ux * HOP_R, y: h.y - uy * HOP_R };
      const exit = { x: h.x + ux * HOP_R, y: h.y + uy * HOP_R };
      d += ` L ${round(entry.x)} ${round(entry.y)}`;
      d += ` A ${HOP_R} ${HOP_R} 0 0 1 ${round(exit.x)} ${round(exit.y)}`;
    }
    d += ` L ${round(ex)} ${round(ey)}`;

    // round the corner at b with a quadratic through the real vertex
    if (i < n - 2) {
      const c = points[i + 2];
      const len2 = dist(b, c) || 1;
      const qx = b.x + ((c.x - b.x) / len2) * trim[i + 1];
      const qy = b.y + ((c.y - b.y) / len2) * trim[i + 1];
      d += ` Q ${round(b.x)} ${round(b.y)} ${round(qx)} ${round(qy)}`;
    }
  }
  return d;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// Midpoint of a polyline (for label placement).
export function polylineMidpoint(points) {
  return labelAnchor(points);
}

// Midpoint of a polyline plus the unit perpendicular to the wire there — used to
// place / nudge labels clear of the wire and of each other.
export function labelAnchor(points) {
  if (points.length === 0) return { x: 0, y: 0, nx: 0, ny: -1 };
  if (points.length === 1) return { x: points[0].x, y: points[0].y, nx: 0, ny: -1 };
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segs.push(len);
    total += len;
  }
  let half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i] || i === segs.length - 1) {
      const f = segs[i] === 0 ? 0 : half / segs[i];
      const x = points[i].x + (points[i + 1].x - points[i].x) * f;
      const y = points[i].y + (points[i + 1].y - points[i].y) * f;
      const len = segs[i] || 1;
      const dx = (points[i + 1].x - points[i].x) / len;
      const dy = (points[i + 1].y - points[i].y) / len;
      return { x, y, nx: -dy, ny: dx };
    }
    half -= segs[i];
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, nx: 0, ny: -1 };
}
