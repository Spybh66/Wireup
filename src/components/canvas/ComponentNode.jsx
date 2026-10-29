// §4.1 Node renderer — header (icon + label + lock), body, port handles.
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Lock, CircleAlert, TriangleAlert, Info } from 'lucide-react';
import { getDefinition } from '../../data/componentLibrary';
import { getIcon } from '../../assets/icons';
import { typeColor, typeHasGaugeFitting } from '../../data/wireTypes';
import { portSnappedFraction, sidePitch, nodeRotation, nodeSize, orientedPorts } from '../../utils/geometry';
import useDiagramStore from '../../store/diagramStore';
import { useDrcMarks } from './DrcContext';
import { useConnectType } from './ConnectContext';

const BREAKER_COLOR = { 10: '#ef4444', 20: '#eab308', 30: '#22c55e', 40: '#f97316' };

const DRC_BADGE = {
  error: { Icon: CircleAlert, color: '#f87171' },
  warning: { Icon: TriangleAlert, color: '#fbbf24' },
  info: { Icon: Info, color: '#38bdf8' },
};

const SIDE_POSITION = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

const FUSE_RING = '#67e8f9'; // cyan — marks a miniature blade-fuse slot

function handleStyle(port, f) {
  const pct = `${f * 100}%`;
  const color = typeColor(port.type);
  // Miniature fuse slots (PDH ch20–23, MPM) render as a square cyan-ringed dot
  // so they read distinctly from the round full-size breaker/signal ports.
  const isFuse = port.slot === 'fuse';
  const base = {
    width: isFuse ? 9 : 8,
    height: isFuse ? 9 : 8,
    background: color,
    border: isFuse ? `1px solid ${FUSE_RING}` : '1px solid #111113',
    borderRadius: isFuse ? 2 : '50%',
  };
  if (port.side === 'left') return { ...base, left: -4, top: pct };
  if (port.side === 'right') return { ...base, right: -4, top: pct };
  if (port.side === 'top') return { ...base, top: -4, left: pct };
  return { ...base, bottom: -4, left: pct };
}

const CHAR_W = 5.6; // approx glyph width at the 10px label font
const LABEL_CHARS = 9; // longer port labels are ellipsized
const ampsText = (p) => (p.type === 'PWR' && p.breaker != null ? `${p.breaker}A` : '');

// Per-side font scale so neighbouring port labels never overlap. Left/right
// labels stack vertically, so only the pitch vs line height matters; top/bottom
// labels sit side by side, so the widest label (or its amp readout, stacked
// under it) must fit within one pitch.
function sideLabelScale(ports, def) {
  const bySide = { top: [], right: [], bottom: [], left: [] };
  for (const p of ports) bySide[p.side].push(p);
  const scaleFor = (side) => {
    const list = bySide[side];
    if (list.length <= 1) return 1;
    const vertical = side === 'left' || side === 'right';
    const spacing = sidePitch(ports, side, vertical ? def.height : def.width);
    if (vertical) return Math.max(0.55, Math.min(1, spacing / 11));
    const chars = Math.max(...list.map((p) => Math.max(Math.min(p.label.length, LABEL_CHARS), ampsText(p).length)));
    return Math.max(0.55, Math.min(1, (spacing - 4) / (chars * CHAR_W)));
  };
  return { top: scaleFor('top'), right: scaleFor('right'), bottom: scaleFor('bottom'), left: scaleFor('left') };
}

// Vertical room the labels on a top/bottom side take (one line, or two when a
// channel shows its amp rating under its name).
function sideLabelDepth(ports, side, scale) {
  const list = ports.filter((p) => p.side === side);
  if (!list.length) return 4;
  const lines = list.some((p) => ampsText(p)) ? 2 : 1;
  return Math.ceil(lines * 11 * scale) + 6;
}

// Horizontal room the port labels on a left/right side take up, so the centred
// name can be padded clear of them instead of running into "CAN OUT".
function sideLabelWidth(ports, side, scale) {
  let chars = 0;
  for (const p of ports) {
    if (p.side !== side) continue;
    const amps = ampsText(p) ? ampsText(p).length + 1 : 0;
    chars = Math.max(chars, Math.min(p.label.length, LABEL_CHARS) + amps);
  }
  return chars ? Math.ceil(chars * CHAR_W * scale) + 10 : 8;
}

// Port label container anchored just inside the body. The port label is the
// outermost child (toward the node edge); an optional breaker readout follows
// it toward the node centre — beside it on left/right sides (row, reversed on
// the right so the label still hugs the edge), and under/over it on top/bottom
// sides, where neighbours are too close for a row.
function labelStyle(port, f, scale = 1) {
  const pct = `${f * 100}%`;
  const fs = 10 * scale;
  const common = {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    gap: 3 * scale,
    fontSize: fs,
    lineHeight: `${fs}px`,
    color: '#c5c5cd',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    maxWidth: 120 * scale,
    textShadow: '0 0 3px #1b1b1f, 0 0 3px #1b1b1f',
    zIndex: 3,
  };
  if (port.side === 'left')
    return { ...common, left: 6, top: pct, transform: 'translateY(-50%)', flexDirection: 'row' };
  if (port.side === 'right')
    return { ...common, right: 6, top: pct, transform: 'translateY(-50%)', flexDirection: 'row-reverse' };
  if (port.side === 'top')
    return { ...common, top: 4, left: pct, transform: 'translateX(-50%)', flexDirection: 'column', gap: 1 };
  return { ...common, bottom: 4, left: pct, transform: 'translateX(-50%)', flexDirection: 'column-reverse', gap: 1 };
}

function ComponentNode({ id, data, selected }) {
  const customDefinitions = useDiagramStore((s) => s.customDefinitions);
  const showPortLabels = useDiagramStore((s) => s.settings.showPortLabels);
  const drcMarks = useDrcMarks();
  const drcSeverity = drcMarks.nodes.get(id);
  const connectType = useConnectType();
  const definition = getDefinition(data.definitionId, customDefinitions);
  if (!definition) return null;
  // Rotated view: box size and port sides after the node's rotation.
  const rotation = nodeRotation({ data });
  const def = { ...definition, ...nodeSize({ data }, definition) };
  const ports = orientedPorts(data.ports, rotation);
  // Show the part type under the name whenever the user has renamed it.
  const partType = data.label && data.label !== definition.name ? definition.name : null;
  const Icon = getIcon(def.icon);
  const border = data.color ?? '#d4d4d8';

  // Snapped fraction (0..1) along a port's side — matches where the wire
  // actually connects, so dots/labels line up with the routed wire.
  const snapFrac = (port) =>
    portSnappedFraction(
      ports,
      port,
      port.side === 'left' || port.side === 'right' ? def.height : def.width
    );

  // Keep the centered icon/name clear of the port labels that sit just inside
  // each side that carries ports (only matters when port labels are visible).
  const labelScale = sideLabelScale(ports, def);
  const namePad = showPortLabels
    ? {
        paddingLeft: sideLabelWidth(ports, 'left', labelScale.left),
        paddingRight: sideLabelWidth(ports, 'right', labelScale.right),
        paddingTop: sideLabelDepth(ports, 'top', labelScale.top),
        paddingBottom: sideLabelDepth(ports, 'bottom', labelScale.bottom),
      }
    : { padding: 8 };

  return (
    <div
      className="relative rounded-md bg-surface-2 font-body"
      style={{
        width: def.width,
        height: def.height,
        border: `1.5px solid ${border}`,
        boxShadow: selected ? '0 0 0 2px #ffffff55' : 'none',
      }}
    >
      {/* centered icon + label */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5"
        style={namePad}
      >
        <Icon size={20} />
        <span className="line-clamp-2 w-full break-words text-center font-heading text-[11px] font-semibold leading-tight tracking-wide text-silver">
          {data.label}
        </span>
        {partType && (
          <span className="w-full truncate text-center text-[9px] leading-tight text-neutral-400" title={partType}>
            {partType}
          </span>
        )}
      </div>

      {/* lock indicator — top-right corner */}
      {data.locked && (
        <div className="pointer-events-none absolute right-1 top-1">
          <Lock size={10} className="text-neutral-400" />
        </div>
      )}

      {/* DRC badge — top-left corner */}
      {drcSeverity && (() => {
        const { Icon, color } = DRC_BADGE[drcSeverity] ?? DRC_BADGE.info;
        return (
          <div
            className="pointer-events-none absolute -left-1.5 -top-1.5 rounded-full bg-surface-0 p-0.5"
            title={`Design check: ${drcSeverity}`}
          >
            <Icon size={13} style={{ color }} />
          </div>
        );
      })()}

      {/* port labels (+ fuse/breaker readout for power ports). Label hugs the
          outer edge; the colour-coded amp readout sits just inboard of it. */}
      {showPortLabels &&
        ports.map((p) => (
          <div key={`l-${p.id}`} style={labelStyle(p, snapFrac(p), labelScale[p.side])}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 56 * labelScale[p.side] }}>
              {p.label}
            </span>
            {p.type === 'PWR' && p.breaker != null &&
              (p.slot === 'fuse' ? (
                <span
                  style={{
                    color: FUSE_RING,
                    fontWeight: 600,
                    fontSize: '0.85em',
                    border: `1px solid ${FUSE_RING}55`,
                    borderRadius: 3,
                    padding: '0 2px',
                  }}
                  title="Miniature blade fuse"
                >
                  {p.breaker}A
                </span>
              ) : (
                <span style={{ color: BREAKER_COLOR[p.breaker] ?? '#fbbf24', fontWeight: 600 }}>
                  {p.breaker}A
                </span>
              ))}
          </div>
        ))}

      {/* handles — every port is both source & target. React Flow needs a
          target-type handle to render an incoming edge, so we render both a
          source and a target handle (same id/position) per port. */}
      {ports.map((p) => {
        const style = handleStyle(p, snapFrac(p));
        const fit = typeHasGaugeFitting(p.type) && p.fitting ? ` · ${p.fitting}` : '';
        const gauge = typeHasGaugeFitting(p.type) && p.gauge ? ` · ${p.gauge}` : '';
        const title = `${p.label} (${p.type})${gauge}${fit}`;
        // Connection affordance: while dragging a wire, ring compatible ports
        // (same type) and dim incompatible ones.
        let aff = null;
        if (connectType) aff = p.type === connectType ? 'match' : 'dim';
        const affStyle =
          aff === 'match'
            ? { boxShadow: `0 0 0 3px ${typeColor(p.type)}66`, transform: 'scale(1.35)' }
            : aff === 'dim'
              ? { opacity: 0.2 }
              : null;
        return (
          <div key={p.id}>
            <Handle
              id={p.id}
              type="target"
              position={SIDE_POSITION[p.side]}
              isConnectableStart
              isConnectableEnd
              style={{ ...style, background: 'transparent', border: 'none', zIndex: 2 }}
            />
            <Handle
              id={p.id}
              type="source"
              position={SIDE_POSITION[p.side]}
              isConnectableStart
              isConnectableEnd
              style={{ ...style, zIndex: 1, ...affStyle }}
              title={title}
            />
          </div>
        );
      })}
    </div>
  );
}

export default memo(ComponentNode);
