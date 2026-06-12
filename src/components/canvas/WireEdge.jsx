// §6.4 Edge renderer — routed path + hops, selection glow, optional label.
import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer } from '@xyflow/react';
import { useRouting } from './RoutingContext';
import useDiagramStore from '../../store/diagramStore';

function WireEdge({ id, selected }) {
  const routing = useRouting();
  const showWireLabels = useDiagramStore((s) => s.settings.showWireLabels);
  const edge = useDiagramStore((s) => s.edges.find((e) => e.id === id));
  const route = routing.get(id);
  if (!route || !edge) return null; // hidden layer or missing route

  const color = route.color;
  const showLabel = showWireLabels || selected;
  const labelPos = route.labelPos ?? route.midpoint;

  return (
    <>
      {/* glow underlay when selected */}
      {selected && (
        <BaseEdge
          path={route.d}
          style={{ stroke: '#ffffff40', strokeWidth: 6, fill: 'none' }}
        />
      )}
      <BaseEdge
        path={route.d}
        style={{
          stroke: color,
          strokeWidth: selected ? 3 : 2,
          fill: 'none',
          strokeDasharray: route.fallback ? '6 4' : undefined,
        }}
      />
      {/* fat invisible hit area for easy selection */}
      <path
        d={route.d}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        className="react-flow__edge-interaction"
      />
      {showLabel && edge.data.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute font-heading"
            style={{
              transform: `translate(-50%, -50%) translate(${labelPos.x}px, ${labelPos.y}px)`,
              fontSize: 10,
              lineHeight: '13px',
              color,
              background: '#111113e6',
              padding: '1px 4px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
              border: `1px solid ${color}55`,
            }}
          >
            {edge.data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(WireEdge);
