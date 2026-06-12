// Builds the full edgeId → { d, midpoint, fallback, color, type } map for the
// canvas. Combines per-edge A* routing (§6.1) with crossing hops (§6.3).
import { getDefinition } from '../data/componentLibrary';
import { portPosition, nodeRect } from './geometry';
import { typeColor } from '../data/wireTypes';
import {
  computeRoute,
  detectHops,
  buildSvgPath,
  polylineMidpoint,
  inflate,
  stubTip,
  PAD,
  markWirePath,
} from './routingUtils';

// Cheap live-drag route: stub → straight → stub (no A*).
function cheapRoute(source, target) {
  return [
    { x: source.x, y: source.y },
    stubTip(source),
    stubTip(target),
    { x: target.x, y: target.y },
  ];
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

  const obstacles = nodes.map((n) => {
    const def = getDefinition(n.data.definitionId, customDefinitions);
    return inflate(nodeRect(n, def ?? { width: 120, height: 70 }), PAD);
  });

  // First pass: compute polylines for every visible edge in array order.
  // Each routed wire is added to wireOccupied so subsequent wires avoid
  // running parallel over the same path (perpendicular crossings are fine).
  const ordered = [];
  const meta = new Map();
  const fallbacks = [];
  const wireOccupied = []; // polyline array for wire proximity avoidance
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

    let points;
    let fallback = false;
    if (dragging.has(e.source) || dragging.has(e.target)) {
      points = cheapRoute(source, target);
    } else {
      const r = computeRoute({ source, target, obstacles, gridSize, wireOccupied });
      points = r.points;
      fallback = r.fallback;
      if (fallback) fallbacks.push({ id: e.id, label: e.data.label });
      if (!fallback) markWirePath(points, 0, wireOccupied);
    }
    ordered.push({ id: e.id, points });
    meta.set(e.id, {
      points,
      fallback,
      color: e.data.color ?? typeColor(e.data.type),
      type: e.data.type,
    });
  }

  // Second pass: hops (skip when dragging — cheap routes shouldn't hop).
  const hopMap = dragging.size ? new Map() : detectHops(ordered);

  const result = new Map();
  for (const o of ordered) {
    const m = meta.get(o.id);
    const hops = (hopMap.get(o.id) || []).map((h) => ({ x: h.x, y: h.y, seg: h.seg }));
    result.set(o.id, {
      d: buildSvgPath(o.points, hops),
      midpoint: polylineMidpoint(o.points),
      fallback: m.fallback,
      color: m.color,
      type: m.type,
    });
  }
  return { routes: result, fallbacks };
}
