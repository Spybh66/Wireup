// §6 Wire routing engine — orthogonal grid router.
// Wires run in horizontal/vertical segments with rounded corners. A shared
// occupancy lattice lets later wires lane-shift beside earlier ones (spaced
// bundles), cross only at right angles (rendered as a jump-over hop), and stay
// out of the space directly in front of other components' ports.
// Pure functions; no React/DOM. Unit-tested in routingUtils.test.js.

export const STUB = 16;         // perpendicular exit stub length (px)
export const PAD  = 12;         // obstacle inflation (px)
export const STEP = 8;          // routing lattice resolution (px) — wire lane spacing

const HOP_R    = 6;             // crossing hop radius (px)
const HOP_GAP  = 3;             // hops closer than this merge into one bridge
const CORNER_R = 7;             // rounded-corner fillet radius (px)

// Route costs, in px of wire length. Tuned so the router prefers a crossing
// over a long detour, but never runs on top of another wire or bends where a
// wire already is (a bend touching another wire reads as a junction).
const BEND       = STEP * 4;    // each 90° corner
const CROSS      = STEP * 20;   // crossing a perpendicular wire (drawn as a hop)
const CROSS_NEXT = STEP * 3;    // ...each further wire of the same bundle crossed
const BUNDLE_GAP = 4;           // wires ≤ this many cells apart count as one bundle
const JUNCTION   = STEP * 60;   // bending on, or ending at, another wire's cell
const OVERLAP    = STEP * 400;  // running along another wire's lattice edge
const PORT_FRONT = STEP * 80;   // passing directly in front of another port
const PORT_NEAR  = STEP * 1.5;  // ...or one lane further out
const KEEP_OUT   = STEP * 40;   // each cell of a soft keep-out box (zone titles)
const MAX_CELLS = 240000;       // grid-size guard (coarsen step if exceeded)
const SEARCH_MARGIN = 16;       // cells a route may stray outside its endpoints' box

// ---------- geometry helpers ----------
export function inflate(rect, pad) {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad };
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

// 4 lattice directions: E W S N (y grows downward). d ^ 1 is the reverse.
const DI = [1, -1, 0, 0];
const DJ = [0, 0, 1, -1];
const SIDE_DIR = { right: 0, left: 1, bottom: 2, top: 3 };
const isH = (d) => d < 2;

// ---------- routing lattice ----------
// Build a shared lattice covering all obstacles. Per-cell occupancy counters
// accumulate as wires are marked so later wires can price crossings/overlaps.
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
  // exactly on cells.
  let s = step;
  let originX, originY, cols, rows;
  for (;;) {
    originX = Math.floor(minX / s) * s;
    originY = Math.floor(minY / s) * s;
    cols = Math.ceil((maxX - originX) / s) + 1;
    rows = Math.ceil((maxY - originY) / s) + 1;
    if (cols * rows <= MAX_CELLS) break;
    s *= 2;
  }

  const N = cols * rows;
  const blocked = new Uint8Array(N);
  for (const r of obstacles) {
    const i0 = Math.max(0, Math.ceil((r.x - originX) / s));
    const i1 = Math.min(cols - 1, Math.floor((r.x + r.w - originX) / s));
    const j0 = Math.max(0, Math.ceil((r.y - originY) / s));
    const j1 = Math.min(rows - 1, Math.floor((r.y + r.h - originY) / s));
    for (let j = j0; j <= j1; j++) blocked.fill(1, j * cols + i0, j * cols + i1 + 1);
  }
  return {
    origin: { x: originX, y: originY },
    step: s,
    cols,
    rows,
    blocked,
    straightH: new Uint16Array(N), // wires passing straight through, horizontally
    straightV: new Uint16Array(N), // ...vertically
    turn: new Uint16Array(N),      // wires bending or terminating here
    edgeH: new Uint16Array(N),     // wires on the lattice edge cell → cell+1
    edgeV: new Uint16Array(N),     // wires on the lattice edge cell → cell+cols
    front: new Float32Array(N),    // port-front reservation cost
  };
}

function worldToCell(grid, p) {
  return {
    i: clamp(Math.round((p.x - grid.origin.x) / grid.step), 0, grid.cols - 1),
    j: clamp(Math.round((p.y - grid.origin.y) / grid.step), 0, grid.rows - 1),
  };
}
function cellToWorld(grid, id) {
  const i = id % grid.cols;
  return { x: grid.origin.x + i * grid.step, y: grid.origin.y + ((id - i) / grid.cols) * grid.step };
}

function nearestFreeCell(grid, p) {
  const { cols, rows, blocked } = grid;
  const start = worldToCell(grid, p);
  if (!blocked[start.j * cols + start.i]) return start.j * cols + start.i;
  const maxR = Math.max(cols, rows);
  for (let r = 1; r < maxR; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = start.i + di, j = start.j + dj;
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
        if (!blocked[j * cols + i]) return j * cols + i;
      }
    }
  }
  return start.j * cols + start.i;
}

// Reserve the lattice cells straight out from each port (its stub tip and the
// lane beyond) so unrelated wires don't skim past a port and look connected.
// `sign` = -1 lifts a reservation (used for a wire's own endpoints).
export function reservePortFronts(grid, ports, sign = 1) {
  if (!grid) return;
  for (const p of ports) {
    const d = SIDE_DIR[p.side] ?? 0;
    const tip = worldToCell(grid, stubTip(p));
    const costs = [PORT_FRONT, PORT_NEAR];
    for (let k = 0; k < costs.length; k++) {
      const i = tip.i + DI[d] * k, j = tip.j + DJ[d] * k;
      if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) break;
      grid.front[j * grid.cols + i] += sign * costs[k];
    }
  }
}

// Price every lattice cell inside each box (e.g. a zone's title strip) so wires
// detour around it — soft, so a wire with no way round can still cross.
export function reserveKeepOuts(grid, boxes) {
  if (!grid) return;
  for (const r of boxes) {
    const i0 = Math.max(0, Math.floor((r.x - grid.origin.x) / grid.step));
    const i1 = Math.min(grid.cols - 1, Math.ceil((r.x + r.w - grid.origin.x) / grid.step));
    const j0 = Math.max(0, Math.floor((r.y - grid.origin.y) / grid.step));
    const j1 = Math.min(grid.rows - 1, Math.ceil((r.y + r.h - grid.origin.y) / grid.step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid.front[j * grid.cols + i] += KEEP_OUT;
  }
}

// Record (sign=1) or erase (sign=-1) a routed lattice path's occupancy —
// optionally just cells [from, to] of it (edges between them included).
export function markPath(grid, path, sign = 1, from = 0, to = Infinity) {
  if (!grid || !path) return;
  const { cells, dirs } = path;
  const n = cells.length;
  for (let k = Math.max(0, from); k <= Math.min(n - 1, to); k++) {
    const c = cells[k];
    const din = dirs[k], dout = dirs[k + 1];
    if (k === 0 || k === n - 1 || din !== dout) grid.turn[c] += sign;
    else if (isH(din)) grid.straightH[c] += sign;
    else grid.straightV[c] += sign;
    if (k < Math.min(n - 1, to)) {
      const nx = cells[k + 1];
      if (nx - c === 1) grid.edgeH[c] += sign;
      else if (c - nx === 1) grid.edgeH[nx] += sign;
      else if (nx > c) grid.edgeV[c] += sign;
      else grid.edgeV[nx] += sign;
    }
  }
}

// Reusable A* scratch buffers, keyed to a grid (lattice size never changes).
function scratch(grid) {
  const S = grid.cols * grid.rows * 4;
  if (!grid._s) {
    grid._s = {
      g: new Float64Array(S),
      came: new Int32Array(S),
      stamp: new Uint32Array(S),
      closed: new Uint32Array(S),
      gen: 0,
    };
  }
  grid._s.gen += 1;
  return grid._s;
}

// Binary min-heap over parallel arrays (no per-entry allocation).
function makeHeap() {
  const key = [];
  const val = [];
  const swap = (a, b) => {
    const k = key[a]; key[a] = key[b]; key[b] = k;
    const v = val[a]; val[a] = val[b]; val[b] = v;
  };
  return {
    push(k, v) {
      key.push(k); val.push(v);
      let i = key.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (key[i] < key[p]) { swap(i, p); i = p; } else break;
      }
    },
    pop() {
      const top = val[0];
      const lk = key.pop(), lv = val.pop();
      if (key.length) {
        key[0] = lk; val[0] = lv;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < key.length && key[l] < key[m]) m = l;
          if (r < key.length && key[r] < key[m]) m = r;
          if (m === i) break;
          swap(i, m); i = m;
        }
      }
      return top;
    },
    peekKey() { return key[0]; },
    get length() { return key.length; },
  };
}

// Orthogonal A* over (cell, heading) states from the source stub tip to the
// target stub tip. Leaves heading out of the source port and must arrive
// heading into the target port; every 90° turn and every interaction with
// already-marked wires is priced (see the cost table at the top).
// Returns { cells, dirs, cost, penalty } — dirs[k] is the heading INTO cells[k]
// (dirs[0] is the exit heading, dirs[n] the arrival heading) — or null.
export function routeOnGrid(grid, source, target) {
  const { cols, rows, blocked, straightH, straightV, turn, edgeH, edgeV, front, step } = grid;
  const startCell = nearestFreeCell(grid, stubTip(source));
  const goalCell = nearestFreeCell(grid, stubTip(target));
  const startDir = SIDE_DIR[source.side] ?? 0;
  const goalDir = (SIDE_DIR[target.side] ?? 0) ^ 1; // heading into the port
  const gi = goalCell % cols, gj = (goalCell - gi) / cols;
  const si = startCell % cols, sj = (startCell - si) / cols;
  // Search window: the endpoints' box plus a margin. Keeps A* from flooding
  // the whole lattice when penalties make the direct region expensive — and
  // a route that needs a detour bigger than this reads badly anyway.
  const i0 = Math.max(0, Math.min(si, gi) - SEARCH_MARGIN), i1 = Math.min(cols - 1, Math.max(si, gi) + SEARCH_MARGIN);
  const j0 = Math.max(0, Math.min(sj, gj) - SEARCH_MARGIN), j1 = Math.min(rows - 1, Math.max(sj, gj) + SEARCH_MARGIN);

  const sc = scratch(grid);
  const { g, came, stamp, closed, gen } = sc;
  const h = (c) => {
    const i = c % cols, j = (c - i) / cols;
    const di = Math.abs(i - gi), dj = Math.abs(j - gj);
    return (di + dj) * step + (di && dj ? BEND : 0);
  };
  const occupied = (c) => straightH[c] || straightV[c] || turn[c];

  const heap = makeHeap();
  const s0 = startCell * 4 + startDir;
  g[s0] = 0; stamp[s0] = gen; came[s0] = -1;
  heap.push(h(startCell), s0);

  let best = Infinity, bestState = -1;
  while (heap.length) {
    if (heap.peekKey() >= best) break;
    const st = heap.pop();
    if (closed[st] === gen) continue;
    closed[st] = gen;
    const cur = st >> 2, pd = st & 3;
    const gc = g[st];

    if (cur === goalCell) {
      // arrival: turning into the port costs a bend (a U-turn, two)
      const arrive = pd === goalDir ? 0 : pd === (goalDir ^ 1) ? 2 * BEND : BEND;
      if (gc + arrive < best) { best = gc + arrive; bestState = st; }
      continue;
    }

    const ci = cur % cols, cj = (cur - ci) / cols;
    for (let d = 0; d < 4; d++) {
      if (d === (pd ^ 1)) continue; // no reversing on the spot
      const ni = ci + DI[d], nj = cj + DJ[d];
      if (ni < i0 || nj < j0 || ni > i1 || nj > j1) continue;
      const nc = nj * cols + ni;
      if (blocked[nc]) continue;
      const ns = nc * 4 + d;
      if (closed[ns] === gen) continue;

      let cost = step;
      if (d !== pd) {
        cost += BEND;
        if (occupied(cur)) cost += JUNCTION;
      }
      const e = isH(d) ? edgeH[d === 0 ? cur : nc] : edgeV[d === 2 ? cur : nc];
      if (e) cost += OVERLAP * e;
      const perp = isH(d) ? straightV[nc] : straightH[nc];
      if (perp) {
        // Crossing a bundle of parallel wires reads as one row of hops, so
        // only the first wire of a bundle pays full price — otherwise a wire
        // detours far around a fan-out rather than cutting across it.
        const across = isH(d) ? straightV : straightH;
        const back = isH(d) ? -DI[d] : -DJ[d] * cols;
        let bundled = false;
        if (d === pd) {
          for (let k = 1, c = nc + back; k <= BUNDLE_GAP; k++, c += back) {
            if (c < 0 || c >= across.length) break;
            if (across[c]) { bundled = true; break; }
          }
        }
        cost += (bundled ? CROSS_NEXT : CROSS) * perp;
      }
      if (turn[nc]) cost += JUNCTION * turn[nc];
      cost += front[nc];

      const tentative = gc + cost;
      if (stamp[ns] !== gen || tentative < g[ns]) {
        g[ns] = tentative; stamp[ns] = gen; came[ns] = st;
        heap.push(tentative + h(nc), ns);
      }
    }
  }
  if (bestState < 0) return null;

  const cells = [], dirs = [goalDir];
  for (let st = bestState; st !== -1; st = came[st]) {
    cells.push(st >> 2);
    dirs.push(st & 3);
  }
  cells.reverse();
  dirs.reverse(); // [exit heading, heading into cells[1], ..., arrival heading]
  const bends = countBends(dirs);
  const length = (cells.length - 1) * step;
  return { cells, dirs, cost: best, penalty: Math.max(0, best - length - bends * BEND) };
}

function countBends(dirs) {
  let n = 0;
  for (let k = 1; k < dirs.length; k++) if (dirs[k] !== dirs[k - 1]) n += dirs[k] === (dirs[k - 1] ^ 1) ? 2 : 1;
  return n;
}

// Port → stub → lattice path → stub → port, as a simplified corner polyline.
export function pathToPoints(grid, source, target, path) {
  return simplifyCollinear([
    { x: source.x, y: source.y },
    stubTip(source),
    ...path.cells.map((c) => cellToWorld(grid, c)),
    stubTip(target),
    { x: target.x, y: target.y },
  ]);
}

// Remove middle point of any 3 collinear consecutive points (and duplicates).
export function simplifyCollinear(points) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) continue;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const back = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0;
    if (Math.abs(cross) > 1e-6 || back) out.push(b);
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

// Orthogonal stub → elbow → stub sketch with no obstacle avoidance. Used for
// live drag previews and as the fallback when no lattice path exists.
export function elbowRoute(source, target) {
  const s = stubTip(source);
  const t = stubTip(target);
  const sH = source.side === 'left' || source.side === 'right';
  const tH = target.side === 'left' || target.side === 'right';
  let mid;
  if (sH && tH) {
    const mx = (s.x + t.x) / 2;
    mid = [{ x: mx, y: s.y }, { x: mx, y: t.y }];
  } else if (!sH && !tH) {
    const my = (s.y + t.y) / 2;
    mid = [{ x: s.x, y: my }, { x: t.x, y: my }];
  } else if (sH) {
    mid = [{ x: t.x, y: s.y }];
  } else {
    mid = [{ x: s.x, y: t.y }];
  }
  return simplifyCollinear([{ x: source.x, y: source.y }, s, ...mid, t, { x: target.x, y: target.y }]);
}

// Compute a full polyline for one edge. When `grid` is supplied it is shared
// across wires: occupancy is read for lane spacing and updated with this path.
export function computeRoute({ source, target, obstacles, grid = null }) {
  const lattice = grid || buildRoutingGrid(obstacles, [stubTip(source), stubTip(target)]);
  const path = routeOnGrid(lattice, source, target);
  if (!path) return { points: elbowRoute(source, target), fallback: true };
  if (grid) markPath(grid, path);
  return { points: pathToPoints(lattice, source, target, path), fallback: false };
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

// Corner fillet trim at each vertex — shared by hop placement and rendering.
function cornerTrims(points, cornerR = CORNER_R) {
  const n = points.length;
  const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
  const trim = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    trim[i] = Math.min(cornerR, dist(points[i - 1], points[i]) * 0.45, dist(points[i], points[i + 1]) * 0.45);
  }
  return trim;
}

// Can segment `seg` of `points` carry a hop at `pt` clear of its rounded ends?
function hopFits(points, trims, seg, pt) {
  const a = points[seg], b = points[seg + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const t = Math.hypot(pt.x - a.x, pt.y - a.y);
  return t >= trims[seg] + HOP_R && t <= len - trims[seg + 1] - HOP_R;
}

const isHorizontal = (a, b) => Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) > 1e-6;

// orderedPolys: [{ id, points }]. Returns Map<id, Array<{x,y,seg}>> of crossing
// points each wire must hop over. The horizontal wire always hops; for any
// other pairing (manual diagonal waypoints) the later wire hops. If the chosen
// wire has no room (crossing right at a corner) the other one hops instead.
export function detectHops(orderedPolys) {
  const hops = new Map();
  const trims = orderedPolys.map((p) => cornerTrims(p.points));
  const add = (k, hop) => {
    const id = orderedPolys[k].id;
    if (!hops.has(id)) hops.set(id, []);
    hops.get(id).push(hop);
  };
  for (let j = 0; j < orderedPolys.length; j++) {
    const P = orderedPolys[j].points;
    for (let i = 0; i < j; i++) {
      const Q = orderedPolys[i].points;
      for (let a = 0; a < P.length - 1; a++) {
        for (let b = 0; b < Q.length - 1; b++) {
          const hit = segIntersect(P[a], P[a + 1], Q[b], Q[b + 1]);
          if (!hit) continue;
          if (nearEndpoint(hit, P) || nearEndpoint(hit, Q)) continue;
          const pt = { x: hit.x, y: hit.y };
          const qH = isHorizontal(Q[b], Q[b + 1]) && !isHorizontal(P[a], P[a + 1]);
          const order = qH ? [[i, b], [j, a]] : [[j, a], [i, b]];
          for (const [k, seg] of order) {
            if (hopFits(orderedPolys[k].points, trims[k], seg, pt)) {
              add(k, { ...pt, seg });
              break;
            }
          }
        }
      }
    }
  }
  return hops;
}

// ---------- SVG path building ----------
// Build an SVG path string with rounded corners (quadratic fillets), inserting
// arc hops at the given crossings. Hops close together on one segment (a wire
// crossing a bundle) merge into a single bridge.
export function buildSvgPath(points, hops = [], cornerR = CORNER_R) {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${round(points[0].x)} ${round(points[0].y)}`;
  const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
  const trim = cornerTrims(points, cornerR);

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

    const ts = hops
      .filter((h) => h.seg === i)
      .map((h) => Math.hypot(h.x - a.x, h.y - a.y))
      .filter((t) => t >= startT + HOP_R && t <= len - endT - HOP_R)
      .sort((p, q) => p - q);
    // cluster into bridges
    const bridges = [];
    for (const t of ts) {
      const last = bridges[bridges.length - 1];
      if (last && t - last.t1 < 2 * HOP_R + HOP_GAP) last.t1 = t;
      else bridges.push({ t0: t, t1: t });
    }
    // bulge "up" on screen for horizontal runs (left for vertical ones)
    const sweep = ux > 1e-6 || (Math.abs(ux) <= 1e-6 && uy < 0) ? 1 : 0;
    for (const br of bridges) {
      const s0 = Math.max(startT, br.t0 - HOP_R);
      const s1 = Math.min(len - endT, br.t1 + HOP_R);
      const rx = (s1 - s0) / 2;
      d += ` L ${round(a.x + ux * s0)} ${round(a.y + uy * s0)}`;
      d += ` A ${round(rx)} ${HOP_R} 0 0 ${sweep} ${round(a.x + ux * s1)} ${round(a.y + uy * s1)}`;
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
