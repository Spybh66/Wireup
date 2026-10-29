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
  reserveKeepOuts,
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
function routeJobs(jobs, obstacles, allPorts, keepOuts) {
  const auto = jobs.filter((j) => !j.edge.data.manual);
  if (!auto.length) return;

  const grid = buildRoutingGrid(obstacles, auto.flatMap((j) => [stubTip(j.source), stubTip(j.target)]));
  reservePortFronts(grid, allPorts);
  reserveKeepOuts(grid, keepOuts);

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

// Zone title strip (ZoneNode: uppercase text-xs, tracking-wide, inset 4px) —
// wires keep off it so the zone's name stays readable.
const ZONE_TITLE_H = 24;
const ZONE_TITLE_CHAR_W = 8;
export function zoneTitleBox(zone) {
  const text = zone.data?.text ?? '';
  if (!text.trim()) return null;
  const width = zone.data.width ?? 240;
  return {
    x: zone.position.x,
    y: zone.position.y,
    w: Math.min(width, 16 + text.length * ZONE_TITLE_CHAR_W),
    h: ZONE_TITLE_H,
  };
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

// Candidate label anchors along a wire: points every few px over its middle
// stretch (clear of the ends, where labels would crowd the ports), each with
// the wire's unit normal there and its distance from the midpoint.
const ANCHOR_STEP = 12;
function anchorsAlong(points) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0) segs.push({ a, b, len, at: total });
    total += len;
  }
  if (!segs.length) return [{ x: points[0]?.x ?? 0, y: points[0]?.y ?? 0, nx: 0, ny: -1, d: 0 }];
  const out = [];
  const lo = Math.min(total / 2, 24), hi = Math.max(total / 2, total - 24);
  for (let t = lo; t <= hi + 1e-6; t += ANCHOR_STEP) {
    const s = segs.find((g) => t <= g.at + g.len) ?? segs[segs.length - 1];
    const f = Math.min(1, (t - s.at) / s.len);
    const ux = (s.b.x - s.a.x) / s.len, uy = (s.b.y - s.a.y) / s.len;
    out.push({ x: s.a.x + (s.b.x - s.a.x) * f, y: s.a.y + (s.b.y - s.a.y) * f, nx: -uy, ny: ux, d: Math.abs(t - total / 2) });
  }
  return out;
}

// Distance from a point to a polyline.
function distToPoly(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
  }
  return best;
}

// Greedy label placement. Each label tries spots beside its own wire — at
// points all along the wire's middle stretch, a step or a few off to either
// side — and takes the nearest one clear of component bodies (and zone
// titles), other labels and other wires, so a crowded midpoint slides the
// label along its wire rather than far away from it. A spot must also be
// plainly closer to its own wire than to any other, so a label between two
// parallel wires can't be misread; where no spot beside the wire qualifies,
// the label sits on the wire itself. Failing all that, the nearest spot that
// only overlaps a wire; failing that, the midpoint.
const MAX_STEPS = 4; // perpendicular steps tried each side of the wire
const OWN_MARGIN = 10; // px a label must be nearer its own wire than any other
const ON_WIRE_COST = 60; // sitting on the wire is the last resort
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
  const overWire = (box, skip) => {
    const hw = box.w / 2 + 2, hh = box.h / 2 + 2;
    for (const poly of wirePolys) {
      if (poly === skip) continue;
      for (let i = 0; i < poly.length - 1; i++) {
        if (segHitsBox(poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y, box.x, box.y, hw, hh)) return true;
      }
    }
    return false;
  };

  for (const item of labelItems) {
    const { id, points, text } = item;
    const w = Math.max(14, text.length * LABEL_CHAR_W + 8);
    const h = LABEL_H;
    // Cheapest first: distance off the wire, then distance along it.
    const candidates = [];
    for (const a of anchorsAlong(points)) {
      candidates.push({ x: a.x, y: a.y, w, h, cost: ON_WIRE_COST + a.d * 0.5, onWire: true });
      for (let k = 1; k <= MAX_STEPS; k++) {
        for (const sign of [1, -1]) {
          // just clear of the wire: half the box's extent across it, plus a gap
          const reach = Math.abs(a.nx) * (w / 2) + Math.abs(a.ny) * (h / 2) + 3 + (k - 1) * (h - 2);
          candidates.push({ x: a.x + a.nx * reach * sign, y: a.y + a.ny * reach * sign, w, h, cost: reach + a.d * 0.5 });
        }
      }
    }
    candidates.sort((p, q) => p.cost - q.cost);
    const others = wirePolys.filter((p) => p !== points);
    const unambiguous = (box) => {
      const own = distToPoly(box.x, box.y, points);
      return others.every((p) => distToPoly(box.x, box.y, p) >= own + OWN_MARGIN);
    };
    let best = null;
    let fallback = null; // nearest spot clear of nodes+labels even if over a wire
    for (const box of candidates) {
      if (overNode(box) || placed.some((p) => overlaps(box, p))) continue;
      if (!fallback && !box.onWire) fallback = box;
      if (overWire(box, box.onWire ? points : null) || !unambiguous(box)) continue;
      best = box;
      break;
    }
    const mid = labelAnchor(points);
    best = best || fallback || { x: mid.x + mid.nx * (h - 2), y: mid.y + mid.ny * (h - 2), w, h };
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
  // (notes, zones) carry no definition and must not deflect wires — only a
  // zone's title strip is kept clear (a soft cost, see zoneTitleBox).
  const nodeRects = [];
  const allPorts = []; // every port, so wires keep clear of ones they don't use
  for (const n of nodes) {
    const def = getDefinition(n.data.definitionId, customDefinitions);
    if (!def) continue;
    nodeRects.push(nodeRect(n, def));
    for (const p of n.data.ports ?? []) allPorts.push(portPosition(n, p, def));
  }
  const obstacles = nodeRects.map((r) => inflate(r, PAD));
  const keepOuts = nodes.filter((n) => n.type === 'zone').map(zoneTitleBox).filter(Boolean);

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
    routeJobs(jobs, obstacles, allPorts, keepOuts);
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
    .map((o) => ({ id: o.id, points: o.points, text: meta.get(o.id).label }));
  const labelPos = layoutLabels(labelItems, [...nodeRects, ...keepOuts], ordered.map((o) => o.points));

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
