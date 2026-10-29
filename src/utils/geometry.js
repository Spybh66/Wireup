// Shared geometry for port placement — used by ComponentNode (handle CSS %)
// and routingUtils (absolute flow coordinates). Both MUST agree.

// Ports sit on this grid, measured from the node's top-left corner. It matches
// the default canvas grid, so with snap-to-grid on every port lands on a canvas
// grid line and two ports that look level are level — no routing jog.
export const PORT_GRID = 16;

// Component sides are a multiple of 2·PORT_GRID so a side's centre is itself a
// grid line, letting a single port (or an odd count) sit dead-centre.
export const snapDim = (v) => Math.max(PORT_GRID * 4, Math.round(v / (PORT_GRID * 2)) * PORT_GRID * 2);

// ---- rotation ----
// A node's `data.rotation` (0/90/180/270, clockwise) never touches its stored
// ports: geometry and rendering work on an *oriented view* — ports with their
// side rotated (and their order flipped where a quarter-turn reverses the
// direction a side is read in), on a box with width/height swapped as needed.
const SIDES = ['top', 'right', 'bottom', 'left'];

export function nodeRotation(node) {
  const r = Math.round((node?.data?.rotation ?? 0) / 90) * 90;
  return ((r % 360) + 360) % 360;
}

// Box size of a node after rotation.
export function nodeSize(node, def) {
  const r = nodeRotation(node);
  return r === 90 || r === 270 ? { width: def.height, height: def.width } : { width: def.width, height: def.height };
}

const orientCache = new WeakMap(); // ports array → Map(rotation → oriented ports)
export function orientedPorts(ports, rotation) {
  if (!rotation || !ports) return ports ?? [];
  let byRot = orientCache.get(ports);
  if (!byRot) orientCache.set(ports, (byRot = new Map()));
  if (byRot.has(rotation)) return byRot.get(rotation);
  const out = ports.map((p) => {
    let side = p.side;
    let order = p.order ?? 0;
    for (let k = 0; k < rotation / 90; k++) {
      // a clockwise quarter-turn maps top→right, right→bottom, bottom→left,
      // left→top; the vertical sides come out reading in the opposite direction
      if (side === 'left' || side === 'right') order = -order;
      side = SIDES[(SIDES.indexOf(side) + 1) % 4];
    }
    return { ...p, side, order };
  });
  byRot.set(rotation, out);
  return out;
}

export function portsOnSide(ports, side) {
  return ports.filter((p) => p.side === side).sort((a, b) => a.order - b.order);
}

// Uniform layout for `n` ports along a side of length `len`: { start, pitch } in
// px, both on PORT_GRID. Picks the pitch closest to an even spread while keeping
// the group as centred as the grid allows. Returns null when the side is too
// short to fit n ports on the grid (caller falls back to an even spread).
const layoutCache = new Map();
export function sideLayout(n, len) {
  const key = `${n}:${len}`;
  if (layoutCache.has(key)) return layoutCache.get(key);
  const G = PORT_GRID;
  const ideal = len / (n + 1);
  let best = null;
  for (let pitch = G; n === 1 ? pitch === G : (n - 1) * pitch <= len - 2 * G; pitch += G) {
    const exact = (len - (n - 1) * pitch) / 2;
    const start = Math.max(G, Math.round(exact / G) * G);
    if (start + (n - 1) * pitch > len - G) continue;
    // off-centre is far more visible than a slightly tighter pitch
    const score = Math.abs(pitch - ideal) + 3 * Math.abs(start - exact);
    if (!best || score < best.score) best = { start, pitch, score };
  }
  const out = best && { start: best.start, pitch: best.pitch };
  layoutCache.set(key, out);
  return out;
}

// Offset in px from the side's start for a port.
export function portOffsetPx(ports, port, edgeLen) {
  const sideList = portsOnSide(ports, port.side);
  const idx = sideList.findIndex((p) => p.id === port.id);
  const n = sideList.length;
  const lay = sideLayout(n, edgeLen);
  if (lay) return lay.start + idx * lay.pitch;
  return Math.min(edgeLen - 1, Math.max(1, Math.round((edgeLen * (idx + 1)) / (n + 1))));
}

// Distance between neighbouring ports on a side (for label sizing).
export function sidePitch(ports, side, edgeLen) {
  const n = portsOnSide(ports, side).length;
  return sideLayout(n, edgeLen)?.pitch ?? edgeLen / (n + 1);
}

// Fraction (0..1) used for the visual handle/label so the dot sits exactly
// where the wire connects.
export function portSnappedFraction(ports, port, edgeLen) {
  return portOffsetPx(ports, port, edgeLen) / edgeLen;
}

// Absolute position of a port in flow coordinates, plus its side.
// Absolute position of a port in flow coordinates, plus its (rotated) side.
export function portPosition(node, port, def) {
  const rot = nodeRotation(node);
  const ports = orientedPorts(node.data.ports, rot);
  const p = rot ? ports.find((q) => q.id === port.id) ?? port : port;
  const { width: w, height: h } = nodeSize(node, def);
  const x0 = node.position.x;
  const y0 = node.position.y;
  switch (p.side) {
    case 'left':
      return { x: x0, y: y0 + portOffsetPx(ports, p, h), side: 'left' };
    case 'right':
      return { x: x0 + w, y: y0 + portOffsetPx(ports, p, h), side: 'right' };
    case 'top':
      return { x: x0 + portOffsetPx(ports, p, w), y: y0, side: 'top' };
    case 'bottom':
    default:
      return { x: x0 + portOffsetPx(ports, p, w), y: y0 + h, side: 'bottom' };
  }
}

// Node rectangle in flow coordinates.
export function nodeRect(node, def) {
  const { width, height } = nodeSize(node, def);
  return { x: node.position.x, y: node.position.y, w: width, h: height };
}
