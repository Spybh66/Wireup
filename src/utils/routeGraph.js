// Builds the full edgeId → { d, midpoint, labelPos, fallback, color, type } map
// for the canvas. Combines orthogonal grid routing (§6.1) over a shared
// occupancy lattice with rip-up-and-reroute passes, crossing hops (§6.3) and
// label collision layout.
import { getDefinition } from '../data/componentLibrary';
import { portPosition, nodeRect } from './geometry';
import { typeColor, typeColor2 } from '../data/wireTypes';
import {
  detectHops,
  buildSvgPath,
  labelAnchor,
  buildRoutingGrid,
  reservePortFronts,
  routeOnGrid,
  markPath,
  pathToPoints,
  elbowRoute,
  inflate,
  stubTip,
  simplifyCollinear,
  PAD,
} from './routingUtils';

// Rip-up-and-reroute passes after the first routing pass. Each pass re-routes
// the wires that paid more than a single crossing's worth of penalty (several
// crossings, a junction, an overlap) against all the others, so early wires
// aren't stuck with choices made before later wires existed. A wire with one
// plain crossing rarely improves, so it isn't worth the search. Stops early
// once a pass changes nothing.
const REROUTE_PASSES = 2;
const SHARED_CELLS = 3;
const REROUTE_MIN_PENALTY = 161; // > one CROSS (160) — see REROUTE_PASSES // lattice cells two wires on one port may share past its stub

// Route every auto wire on one shared lattice, filling job.points/fallback.
function routeJobs(jobs, obstacles, allPorts) {
  const auto = jobs.filter((j) => !j.edge.data.manual);
  if (!auto.length) return;

  const grid = buildRoutingGrid(obstacles, auto.flatMap((j) => [stubTip(j.source), stubTip(j.target)]));
  reservePortFronts(grid, allPorts);

  // Wires sharing a port (a daisy-chained CAN device, a split power tap) share
  // its stub and may merge for a few cells beside it before they must split
  // into their own lanes — so the merged stretch of each sibling is lifted
  // from the lattice while routing the other.
  const byEnd = new Map();
  for (const j of auto) for (const k of j.ends) byEnd.set(k, [...(byEnd.get(k) ?? []), j]);
  // → [{ path, from, to }], one cell range per sibling (merged if a short
  // sibling shares both ends, so no cell is lifted twice).
  const shared = (j) => {
    const bySib = new Map();
    for (const k of j.ends) {
      for (const o of byEnd.get(k)) {
        if (o === j || !o.path) continue;
        const n = o.path.cells.length;
        const r = o.ends[0] === k ? [0, SHARED_CELLS] : [n - 1 - SHARED_CELLS, n - 1];
        const prev = bySib.get(o);
        bySib.set(o, prev ? [Math.min(prev[0], r[0]), Math.max(prev[1], r[1])] : r);
      }
    }
    return [...bySib].map(([o, [from, to]]) => ({ path: o.path, from, to }));
  };
  const toggleShared = (list, sign) => {
    for (const { path, from, to } of list) markPath(grid, path, sign, from, to);
  };

  const route = (j) => {
    const sib = shared(j);
    toggleShared(sib, -1);
    reservePortFronts(grid, [j.source, j.target], -1);
    const path = routeOnGrid(grid, j.source, j.target);
    reservePortFronts(grid, [j.source, j.target], 1);
    toggleShared(sib, 1);
    return path;
  };

  // Short wires first: they have the fewest reasonable paths, and long wires
  // can route around them more cheaply than the other way round.
  const span = (j) => Math.abs(j.source.x - j.target.x) + Math.abs(j.source.y - j.target.y);
  const order = auto
    .map((j, k) => ({ j, k }))
    .sort((a, b) => span(a.j) - span(b.j) || a.k - b.k)
    .map((o) => o.j);
  for (const j of order) {
    j.path = route(j);
    markPath(grid, j.path, 1);
  }

  for (let pass = 0; pass < REROUTE_PASSES; pass++) {
    let improved = false;
    const worst = order
      .filter((j) => j.path?.penalty > REROUTE_MIN_PENALTY)
      .sort((a, b) => b.path.penalty - a.path.penalty);
    for (const j of worst) {
      markPath(grid, j.path, -1);
      // A* is optimal against the current neighbours, so the new path is never
      // worse than the old one re-priced against them.
      const next = route(j);
      if (next && next.cells.join() !== j.path.cells.join()) {
        j.path = next;
        improved = true;
      }
      markPath(grid, j.path, 1);
    }
    if (!improved) break;
  }

  for (const j of auto) {
    if (j.path) j.points = pathToPoints(grid, j.source, j.target, j.path);
    else {
      j.points = elbowRoute(j.source, j.target);
      j.fallback = true;
    }
  }
}

const LABEL_H = 15;       // approx label box height (px)
const LABEL_CHAR_W = 6;   // approx per-character width at fontSize 10 (px)

// Does segment a→b pass through the box (centred cx,cy with half-extents hw,hh)?
function segHitsBox(ax, ay, bx, by, cx, cy, hw, hh) {
  const minX = cx - hw, maxX = cx + hw, minY = cy - hh, maxY = cy + hh;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (clip(-dx, ax - minX) && clip(dx, maxX - ax) && clip(-dy, ay - minY) && clip(dy, maxY - ay)) {
    return t0 <= t1;
  }
  return false;
}

// Greedy label placement: anchor at each wire's midpoint, then nudge along the
// wire's perpendicular to find a spot clear of component bodies, other labels,
// AND wire bundles (so labels don't sit on top of the wires).
function layoutLabels(labelItems, nodeRects, wirePolys) {
  const placed = [];
  const result = new Map();

  const overlaps = (a, b) =>
    Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
  const overNode = (box) =>
    nodeRects.some(
      (r) =>
        box.x + box.w / 2 > r.x &&
        box.x - box.w / 2 < r.x + r.w &&
        box.y + box.h / 2 > r.y &&
        box.y - box.h / 2 < r.y + r.h
    );
  const overWire = (box) => {
    const hw = box.w / 2 + 2, hh = box.h / 2 + 2;
    for (const poly of wirePolys) {
      for (let i = 0; i < poly.length - 1; i++) {
        if (segHitsBox(poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y, box.x, box.y, hw, hh)) return true;
      }
    }
    return false;
  };

  for (const item of labelItems) {
    const { id, anchor, text } = item;
    const w = Math.max(14, text.length * LABEL_CHAR_W + 8);
    const h = LABEL_H;
    // perpendicular nudge axis (fall back to vertical for purely diagonal runs)
    let nx = anchor.nx, ny = anchor.ny;
    const nlen = Math.hypot(nx, ny) || 1;
    nx /= nlen; ny /= nlen;

    const step = h - 2;
    let best = null;
    let fallback = null; // best spot clear of nodes+labels even if over a wire
    for (let k = 1; k <= 14 && !best; k++) {
      for (const sign of [1, -1]) {
        const off = sign * k * step;
        const box = { x: anchor.x + nx * off, y: anchor.y + ny * off, w, h };
        if (overNode(box)) continue;
        if (placed.some((p) => overlaps(box, p))) continue;
        if (!fallback) fallback = box;
        if (overWire(box)) continue;
        best = box;
        break;
      }
    }
    best = best || fallback || { x: anchor.x + nx * step, y: anchor.y + ny * step, w, h };
    placed.push(best);
    result.set(id, { x: best.x, y: best.y });
  }
  return result;
}

// `previous` (the last settled result's routes) lets a live drag keep every
// wire that isn't attached to a moving node exactly where it was.
export function computeAllRoutes({
  nodes,
  edges,
  layers,
  draggingIds = [],
  customDefinitions = [],
  previous = null,
}) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visibleLayers = new Set(layers.filter((l) => l.visible).map((l) => l.id));
  const dragging = new Set(draggingIds);

  // Only real components are obstacles / get rectangles; annotation nodes
  // (notes, zones) carry no definition and must not deflect wires.
  const nodeRects = [];
  const allPorts = []; // every port, so wires keep clear of ones they don't use
  for (const n of nodes) {
    const def = getDefinition(n.data.definitionId, customDefinitions);
    if (!def) continue;
    nodeRects.push(nodeRect(n, def));
    for (const p of n.data.ports ?? []) allPorts.push(portPosition(n, p, def));
  }
  const obstacles = nodeRects.map((r) => inflate(r, PAD));

  // Resolve EVERY edge's endpoints (not just visible ones). Routing all wires —
  // regardless of layer visibility — keeps the occupancy lattice (and therefore
  // the visible routes) stable when a layer is toggled off/on, so hiding a
  // layer never reroutes the wires that stay on screen.
  const jobs = [];
  for (const e of edges) {
    const sNode = nodeMap.get(e.source);
    const tNode = nodeMap.get(e.target);
    if (!sNode || !tNode) continue;
    const sDef = getDefinition(sNode.data.definitionId, customDefinitions);
    const tDef = getDefinition(tNode.data.definitionId, customDefinitions);
    const sPort = sNode.data.ports.find((p) => p.id === e.sourceHandle);
    const tPort = tNode.data.ports.find((p) => p.id === e.targetHandle);
    if (!sDef || !tDef || !sPort || !tPort) continue;
    const source = portPosition(sNode, sPort, sDef);
    const target = portPosition(tNode, tPort, tDef);
    jobs.push({
      edge: e,
      source,
      target,
      ends: [`${e.source}:${e.sourceHandle}`, `${e.target}:${e.targetHandle}`],
      visible: visibleLayers.has(e.data.layerId),
      // Manual wire: straight segments through the user's waypoints. No
      // routing, no obstacle avoidance — the user owns the path.
      points: e.data.manual ? simplifyCollinear([source, ...(e.data.waypoints ?? []), target]) : null,
      fallback: false,
    });
  }

  if (dragging.size) {
    // Live drag: sketch only the wires attached to moving nodes; everything
    // else stays put. Full routing runs again on drop.
    for (const j of jobs) {
      if (j.points) continue;
      const prev = previous?.get(j.edge.id);
      const moving = dragging.has(j.edge.source) || dragging.has(j.edge.target);
      j.points = moving || !prev ? elbowRoute(j.source, j.target) : prev.points;
    }
  } else {
    routeJobs(jobs, obstacles, allPorts);
  }

  const ordered = []; // visible edges only — used for hops/labels/render
  const meta = new Map();
  const fallbacks = [];
  for (const { edge: e, points, fallback, visible } of jobs) {
    if (!visible) continue; // routed into the grid for stability, but not drawn
    if (fallback) fallbacks.push({ id: e.id, label: e.data.label });
    ordered.push({ id: e.id, points });
    meta.set(e.id, {
      fallback,
      color: e.data.color ?? typeColor(e.data.type),
      color2: e.data.color2 ?? typeColor2(e.data.type),
      type: e.data.type,
      label: e.data.label,
    });
  }

  const hopMap = detectHops(ordered);

  // Label collision layout across all visible labelled wires.
  const labelItems = ordered
    .filter((o) => meta.get(o.id).label)
    .map((o) => ({ id: o.id, anchor: labelAnchor(o.points), text: meta.get(o.id).label }));
  const labelPos = layoutLabels(labelItems, nodeRects, ordered.map((o) => o.points));

  const result = new Map();
  for (const o of ordered) {
    const m = meta.get(o.id);
    const hops = hopMap.get(o.id) || [];
    const anchor = labelAnchor(o.points);
    result.set(o.id, {
      d: buildSvgPath(o.points, hops),
      midpoint: { x: anchor.x, y: anchor.y },
      labelPos: labelPos.get(o.id) ?? { x: anchor.x, y: anchor.y },
      fallback: m.fallback,
      color: m.color,
      color2: m.color2,
      type: m.type,
      hopCount: hops.length,
      points: o.points, // corner polyline — used to seed/edit manual waypoints
    });
  }
  return { routes: result, fallbacks };
}
