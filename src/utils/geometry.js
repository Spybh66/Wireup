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

// Absolute position of a port in flow coordinates, plus its side.
export function portPosition(node, port, def) {
  const w = def.width;
  const h = def.height;
  const f = portFraction(node.data.ports, port);
  const x0 = node.position.x;
  const y0 = node.position.y;
  switch (port.side) {
    case 'left':
      return { x: x0, y: y0 + h * f, side: 'left' };
    case 'right':
      return { x: x0 + w, y: y0 + h * f, side: 'right' };
    case 'top':
      return { x: x0 + w * f, y: y0, side: 'top' };
    case 'bottom':
    default:
      return { x: x0 + w * f, y: y0 + h, side: 'bottom' };
  }
}

// Node rectangle in flow coordinates.
export function nodeRect(node, def) {
  return { x: node.position.x, y: node.position.y, w: def.width, h: def.height };
}
