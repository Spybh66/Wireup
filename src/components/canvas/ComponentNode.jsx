// §4.1 Node renderer — header (icon + label + lock), body, port handles.
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Lock, CircleAlert, TriangleAlert, Info } from 'lucide-react';
import { getDefinition } from '../../data/componentLibrary';
import { getIcon } from '../../assets/icons';
import { typeColor, typeHasGaugeFitting } from '../../data/wireTypes';
import { portSnappedFraction, nodeRotation, nodeSize, orientedPorts } from '../../utils/geometry';
import { nameLayout, PORT_FONT, LABEL_INSET, LABEL_MAX_W } from '../../utils/nodeLabels';
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

// Port label container anchored just inside the body. The port label is the
// outermost child (toward the node edge); an optional breaker readout follows
// it toward the node centre — beside it on left/right sides (row, reversed on
// the right so the label still hugs the edge), and under/over it on top/bottom
// sides, where neighbours are too close for a row.
function labelStyle(port, f, scale = 1) {
  const pct = `${f * 100}%`;
  const fs = PORT_FONT * scale;
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
    return { ...common, left: LABEL_INSET, top: pct, transform: 'translateY(-50%)', flexDirection: 'row' };
  if (port.side === 'right')
    return { ...common, right: LABEL_INSET, top: pct, transform: 'translateY(-50%)', flexDirection: 'row-reverse' };
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

  // Name placement (clear of the port labels on every side, moved above/below
  // the side labels when they leave the middle too narrow) — see nodeLabels.
  const name = nameLayout(ports, def, { name: data.label, sub: partType, showPortLabels });
  const labelScale = name.scale;

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
      {/* icon + name, wrapped between words (never mid-word) */}
      <div
        className="pointer-events-none absolute flex flex-col items-center justify-center gap-0.5"
        style={{ left: name.box.x, top: name.box.y, width: name.box.w, height: name.box.h }}
      >
        {name.showIcon && <Icon size={20} />}
        <span
          className="w-full text-center font-heading font-semibold leading-tight tracking-wide text-silver"
          style={{ fontSize: name.fontSize }}
        >
          {name.lines.map((line, i) => (
            <span key={i} className="block whitespace-nowrap">
              {line}
            </span>
          ))}
        </span>
        {name.showSub && (
          <span className="w-full text-center text-[9px] leading-tight text-neutral-400" title={partType}>
            {name.subLines.map((line, i) => (
              <span key={i} className="block whitespace-nowrap">
                {line}
              </span>
            ))}
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
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: LABEL_MAX_W * labelScale[p.side] }}>
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
