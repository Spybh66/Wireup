// Builds the full edgeId → { d, midpoint, labelPos, fallback, color, type } map
// for the canvas. Combines per-edge octilinear grid routing (§6.1) over a shared
// occupancy lattice with crossing hops (§6.3) and label collision layout.
import { getDefinition } from '../data/componentLibrary';
import { portPosition, nodeRect } from './geometry';
import { typeColor, typeColor2 } from '../data/wireTypes';
import {
  computeRoute,
  detectHops,
  buildSvgPath,
  labelAnchor,
  buildRoutingGrid,
  inflate,
  stubTip,
  PAD,
} from './routingUtils';

// Cheap live-drag route: stub → straight → stub (no routing).
function cheapRoute(source, target) {
  return [
    { x: source.x, y: source.y },
    stubTip(source),
    stubTip(target),
    { x: target.x, y: target.y },
  ];
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

export function computeAllRoutes({
  nodes,
  edges,
  layers,
  gridSize = 16,
  draggingIds = [],
  customDefinitions = [],
}) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visibleLayers = new Set(layers.filter((l) => l.visible).map((l) => l.id));
  const dragging = new Set(draggingIds);

  const nodeRects = nodes.map((n) => {
    const def = getDefinition(n.data.definitionId, customDefinitions);
    return nodeRect(n, def ?? { width: 120, height: 70 });
  });
  const obstacles = nodeRects.map((r) => inflate(r, PAD));

  // Pass 0: resolve EVERY edge's endpoints (not just visible ones). Routing all
  // wires — regardless of layer visibility — keeps the occupancy lattice (and
  // therefore the visible routes) stable when a layer is toggled off/on, so
  // hiding a layer never reroutes the wires that stay on screen.
  const jobs = [];
  const endpoints = [];
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
    endpoints.push(stubTip(source), stubTip(target));
    jobs.push({ edge: e, source, target, visible: visibleLayers.has(e.data.layerId) });
  }

  // One shared occupancy lattice for the whole diagram. Routing edges in a
  // deterministic order lets wires sharing a corridor lane-shift off one
  // another (spaced bundles) while distant wires stay untouched (local cluster).
  const grid = dragging.size ? null : buildRoutingGrid(obstacles, endpoints);

  const ordered = [];      // visible edges only — used for hops/labels/render
  const meta = new Map();
  const fallbacks = [];
  for (const { edge: e, source, target, visible } of jobs) {
    let points;
    let fallback = false;
    if (dragging.has(e.source) || dragging.has(e.target)) {
      points = cheapRoute(source, target);
    } else {
      const r = computeRoute({ source, target, obstacles, gridSize, grid });
      points = r.points;
      fallback = r.fallback;
      if (fallback && visible) fallbacks.push({ id: e.id, label: e.data.label });
    }
    if (!visible) continue; // routed into the grid for stability, but not drawn
    ordered.push({ id: e.id, points });
    meta.set(e.id, {
      points,
      fallback,
      color: e.data.color ?? typeColor(e.data.type),
      color2: e.data.color2 ?? typeColor2(e.data.type),
      type: e.data.type,
      label: e.data.label,
    });
  }

  // Hops (skip when dragging — cheap routes shouldn't hop).
  const hopMap = dragging.size ? new Map() : detectHops(ordered);

  // Label collision layout across all visible labelled wires.
  const labelItems = ordered
    .filter((o) => meta.get(o.id).label)
    .map((o) => ({ id: o.id, anchor: labelAnchor(o.points), text: meta.get(o.id).label }));
  const labelPos = layoutLabels(labelItems, nodeRects, ordered.map((o) => o.points));

  const result = new Map();
  for (const o of ordered) {
    const m = meta.get(o.id);
    const hops = (hopMap.get(o.id) || []).map((h) => ({ x: h.x, y: h.y, seg: h.seg }));
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
    });
  }
  return { routes: result, fallbacks };
}
