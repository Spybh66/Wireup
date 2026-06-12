// Builds the full edgeId → { d, midpoint, labelPos, fallback, color, type } map
// for the canvas. Combines per-edge octilinear grid routing (§6.1) over a shared
// occupancy lattice with crossing hops (§6.3) and label collision layout.
import { getDefinition } from '../data/componentLibrary';
import { portPosition, nodeRect } from './geometry';
import { typeColor } from '../data/wireTypes';
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

// Greedy label placement: anchor at each wire's midpoint, then nudge along the
// wire's perpendicular to avoid overlapping other labels or component bodies.
function layoutLabels(labelItems, nodeRects) {
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

  for (const item of labelItems) {
    const { id, anchor, text } = item;
    const w = Math.max(14, text.length * LABEL_CHAR_W + 8);
    const h = LABEL_H;
    // perpendicular nudge axis (fall back to vertical for purely diagonal runs)
    let nx = anchor.nx, ny = anchor.ny;
    const nlen = Math.hypot(nx, ny) || 1;
    nx /= nlen; ny /= nlen;

    let best = null;
    for (let k = 0; k <= 6 && !best; k++) {
      for (const sign of k === 0 ? [0] : [1, -1]) {
        const off = sign * k * (h + 3);
        const box = { x: anchor.x + nx * off, y: anchor.y + ny * off, w, h };
        if (overNode(box)) continue;
        if (placed.some((p) => overlaps(box, p))) continue;
        best = box;
        break;
      }
    }
    if (!best) best = { x: anchor.x + nx * (h + 3) * 4, y: anchor.y + ny * (h + 3) * 4, w, h };
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

  // Pass 0: resolve each visible edge's endpoints so the routing lattice can be
  // sized to cover every wire stub (not just the component rects).
  const jobs = [];
  const endpoints = [];
  for (const e of edges) {
    if (!visibleLayers.has(e.data.layerId)) continue;
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
    jobs.push({ edge: e, source, target });
  }

  // One shared occupancy lattice for the whole diagram. Routing edges in a
  // deterministic order lets wires sharing a corridor lane-shift off one
  // another (spaced bundles) while distant wires stay untouched (local cluster).
  const grid = dragging.size ? null : buildRoutingGrid(obstacles, endpoints);

  const ordered = [];
  const meta = new Map();
  const fallbacks = [];
  for (const { edge: e, source, target } of jobs) {
    let points;
    let fallback = false;
    if (dragging.has(e.source) || dragging.has(e.target)) {
      points = cheapRoute(source, target);
    } else {
      const r = computeRoute({ source, target, obstacles, gridSize, grid });
      points = r.points;
      fallback = r.fallback;
      if (fallback) fallbacks.push({ id: e.id, label: e.data.label });
    }
    ordered.push({ id: e.id, points });
    meta.set(e.id, {
      points,
      fallback,
      color: e.data.color ?? typeColor(e.data.type),
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
  const labelPos = layoutLabels(labelItems, nodeRects);

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
      type: m.type,
    });
  }
  return { routes: result, fallbacks };
}
