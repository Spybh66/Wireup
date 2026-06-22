// Shared geometry for port placement — used by ComponentNode (handle CSS %)
// and routingUtils (absolute flow coordinates). Both MUST agree.

export function portsOnSide(ports, side) {
  return ports.filter((p) => p.side === side).sort((a, b) => a.order - b.order);
}

// Fraction (0..1) along a port's side, evenly distributed in order sequence.
export function portFraction(ports, port) {
  const sideList = portsOnSide(ports, port.side);
  const idx = sideList.findIndex((p) => p.id === port.id);
  const n = sideList.length;
  return (idx + 1) / (n + 1);
}

// Offset in px from the edge's start for a port. Uses the exact fractional
// position (rounded to nearest pixel) so ports are always evenly spaced
// regardless of the routing grid step. The routing engine handles sub-grid
// alignment via the exit stub, so no grid-snap is needed here.
export function portOffsetPx(ports, port, edgeLen) {
  const raw = edgeLen * portFraction(ports, port);
  return Math.min(edgeLen - 1, Math.max(1, Math.round(raw)));
}

// Snapped fraction (0..1) used for the visual handle/label so the dot sits
// exactly where the wire connects.
export function portSnappedFraction(ports, port, edgeLen) {
  return portOffsetPx(ports, port, edgeLen) / edgeLen;
}

// Absolute position of a port in flow coordinates, plus its side.
export function portPosition(node, port, def) {
  const w = def.width;
  const h = def.height;
  const x0 = node.position.x;
  const y0 = node.position.y;
  switch (port.side) {
    case 'left':
      return { x: x0, y: y0 + portOffsetPx(node.data.ports, port, h), side: 'left' };
    case 'right':
      return { x: x0 + w, y: y0 + portOffsetPx(node.data.ports, port, h), side: 'right' };
    case 'top':
      return { x: x0 + portOffsetPx(node.data.ports, port, w), y: y0, side: 'top' };
    case 'bottom':
    default:
      return { x: x0 + portOffsetPx(node.data.ports, port, w), y: y0 + h, side: 'bottom' };
  }
}

// Node rectangle in flow coordinates.
export function nodeRect(node, def) {
  return { x: node.position.x, y: node.position.y, w: def.width, h: def.height };
}
