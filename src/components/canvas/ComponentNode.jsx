// §4.1 Node renderer — header (icon + label + lock), body, port handles.
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Lock } from 'lucide-react';
import { getDefinition } from '../../data/componentLibrary';
import { getIcon } from '../../assets/icons';
import { typeColor, typeHasGaugeFitting } from '../../data/wireTypes';
import { portFraction } from '../../utils/geometry';
import useDiagramStore from '../../store/diagramStore';

const SIDE_POSITION = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

function handleStyle(node, port) {
  const f = portFraction(node.data.ports, port);
  const pct = `${f * 100}%`;
  const color = typeColor(port.type);
  const base = {
    width: 8,
    height: 8,
    background: color,
    border: '1px solid #111113',
    borderRadius: '50%',
  };
  if (port.side === 'left') return { ...base, left: -4, top: pct };
  if (port.side === 'right') return { ...base, right: -4, top: pct };
  if (port.side === 'top') return { ...base, top: -4, left: pct };
  return { ...base, bottom: -4, left: pct };
}

// Port label offset so it sits just inside the body, away from the dot.
function labelStyle(port, f) {
  const pct = `${f * 100}%`;
  const common = {
    position: 'absolute',
    fontSize: 10,
    lineHeight: '10px',
    color: '#c5c5cd',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    maxWidth: 56,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textShadow: '0 0 3px #1b1b1f, 0 0 3px #1b1b1f',
    zIndex: 3,
  };
  if (port.side === 'left') return { ...common, left: 6, top: pct, transform: 'translateY(-50%)' };
  if (port.side === 'right')
    return { ...common, right: 6, top: pct, transform: 'translateY(-50%)', textAlign: 'right' };
  if (port.side === 'top') return { ...common, top: 4, left: pct, transform: 'translateX(-50%)' };
  return { ...common, bottom: 4, left: pct, transform: 'translateX(-50%)' };
}

function ComponentNode({ id, data, selected }) {
  const customDefinitions = useDiagramStore((s) => s.customDefinitions);
  const showPortLabels = useDiagramStore((s) => s.settings.showPortLabels);
  const def = getDefinition(data.definitionId, customDefinitions);
  if (!def) return null;
  const Icon = getIcon(def.icon);
  const border = data.color ?? '#d4d4d8';

  // node object shape needed by geometry helpers
  const node = { id, data };

  // Keep the centered icon/name clear of the port labels that sit just inside
  // each side that carries ports (only matters when port labels are visible).
  const sides = new Set(data.ports.map((p) => p.side));
  const namePad = showPortLabels
    ? {
        paddingLeft: sides.has('left') ? 30 : 8,
        paddingRight: sides.has('right') ? 30 : 8,
        paddingTop: sides.has('top') ? 14 : 4,
        paddingBottom: sides.has('bottom') ? 14 : 4,
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
        <span className="w-full truncate text-center font-heading text-[11px] font-semibold tracking-wide text-silver">
          {data.label}
        </span>
      </div>

      {/* lock indicator — top-right corner */}
      {data.locked && (
        <div className="pointer-events-none absolute right-1 top-1">
          <Lock size={10} className="text-neutral-400" />
        </div>
      )}

      {/* port labels */}
      {showPortLabels &&
        data.ports.map((p) => (
          <span key={`l-${p.id}`} style={labelStyle(p, portFraction(data.ports, p))}>
            {p.label}
          </span>
        ))}

      {/* handles — every port is both source & target. React Flow needs a
          target-type handle to render an incoming edge, so we render both a
          source and a target handle (same id/position) per port. */}
      {data.ports.map((p) => {
        const style = handleStyle(node, p);
        const title = `${p.label} (${p.type})${typeHasGaugeFitting(p.type) && p.gauge ? ` · ${p.gauge}` : ''}`;
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
              style={{ ...style, zIndex: 1 }}
              title={title}
            />
          </div>
        );
      })}
    </div>
  );
}

export default memo(ComponentNode);
