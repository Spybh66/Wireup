// §6.4 Edge renderer — routed path + hops, selection glow, optional label, and
// manual waypoint editing (drag corners, insert on segments, double-click to
// delete). Editing any wire converts it to a manual route through its waypoints.
import { memo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BaseEdge, EdgeLabelRenderer, useReactFlow } from '@xyflow/react';
import { useRouting } from './RoutingContext';
import { useDrcMarks } from './DrcContext';
import useDiagramStore from '../../store/diagramStore';
import { buildSvgPath, STEP } from '../../utils/routingUtils';

const MIN_SEG = 26; // only show an insert dot on segments at least this long (px)
const DRC_HALO = { error: '#f87171', warning: '#fbbf24', info: '#38bdf8' };
const ALIGN_TOL = 6; // flow-px tolerance for snapping a waypoint to another point's axis
const GUIDE_LEN = 5000; // half-length of an alignment guide line (px)

// Distance from point p to segment a–b.
function distToSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function WireEdge({ id, selected }) {
  const routing = useRouting();
  const drcSeverity = useDrcMarks().edges.get(id);
  const showWireLabels = useDiagramStore((s) => s.settings.showWireLabels);
  const snapToGrid = useDiagramStore((s) => s.settings.snapToGrid);
  const edge = useDiagramStore((s) => s.edges.find((e) => e.id === id));
  const setEdgeWaypoints = useDiagramStore((s) => s.setEdgeWaypoints);
  const clearEdgeWaypoints = useDiagramStore((s) => s.clearEdgeWaypoints);
  const { screenToFlowPosition } = useReactFlow();
  const [draft, setDraft] = useState(null); // full control polyline during a drag
  const [guides, setGuides] = useState(null); // alignment guide lines during a drag
  const [menu, setMenu] = useState(null); // right-click context menu {x,y} in flow coords
  const dragRef = useRef(null);

  const route = routing.get(id);
  if (!route || !edge) return null; // hidden layer or missing route

  const color = route.color;
  const color2 = route.color2;
  const showLabel = showWireLabels || selected;
  const labelPos = route.labelPos ?? route.midpoint;
  const strokeW = selected ? 3 : 2;

  // Control polyline = endpoints + interior points. For a manual wire the
  // interior points are its waypoints; for an auto wire we use the routed
  // corners, so the first edit converts it to manual without changing shape.
  const routePts = route.points ?? [];
  const src = routePts[0];
  const tgt = routePts[routePts.length - 1];
  const interior = edge.data.manual ? (edge.data.waypoints ?? []) : routePts.slice(1, -1);
  const controlPts = draft ?? (src && tgt ? [src, ...interior, tgt] : []);

  // Path: from the live draft while dragging, otherwise the computed route.
  const dPath = draft ? buildSvgPath(controlPts, []) : route.d;

  // Snap waypoints to the wire grid (STEP) — a sub-grid of the component grid —
  // so they align with ports (also on the wire grid) for clean straight runs.
  const snap = (p) =>
    snapToGrid
      ? { x: Math.round(p.x / STEP) * STEP, y: Math.round(p.y / STEP) * STEP }
      : { x: p.x, y: p.y };

  // Begin dragging control-point `idx` of polyline `base`.
  const beginDrag = (base, idx, ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    dragRef.current = { idx, pts: base };
    setDraft(base);
    const others = base.filter((_, k) => k !== idx);
    const onMove = (e) => {
      const fp = snap(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      // Snap to another control point's axis (clean straight runs) + show guides.
      const g = [];
      let bestX = null;
      let bestY = null;
      for (const o of others) {
        if (Math.abs(fp.x - o.x) <= ALIGN_TOL && (bestX == null || Math.abs(fp.x - o.x) < Math.abs(fp.x - bestX)))
          bestX = o.x;
        if (Math.abs(fp.y - o.y) <= ALIGN_TOL && (bestY == null || Math.abs(fp.y - o.y) < Math.abs(fp.y - bestY)))
          bestY = o.y;
      }
      if (bestX != null) { fp.x = bestX; g.push({ axis: 'x', at: bestX }); }
      if (bestY != null) { fp.y = bestY; g.push({ axis: 'y', at: bestY }); }
      const pts = dragRef.current.pts.slice();
      pts[dragRef.current.idx] = fp;
      dragRef.current.pts = pts;
      setDraft(pts);
      setGuides(g.length ? { lines: g, at: fp } : null);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const pts = dragRef.current.pts;
      dragRef.current = null;
      setDraft(null);
      setGuides(null);
      setEdgeWaypoints(id, pts.slice(1, -1)); // strip endpoints → waypoints
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onWaypointDown = (i, ev) => beginDrag([src, ...interior, tgt], i, ev);

  const onInsertDown = (segIdx, ev) => {
    const base = [src, ...interior, tgt];
    const a = base[segIdx];
    const b = base[segIdx + 1];
    const mid = snap({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const pts = [...base.slice(0, segIdx + 1), mid, ...base.slice(segIdx + 1)];
    beginDrag(pts, segIdx + 1, ev);
  };

  const onWaypointDelete = (i, ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    const wps = [src, ...interior, tgt].slice(1, -1); // current interior points
    wps.splice(i - 1, 1); // remove the one at this control index
    setEdgeWaypoints(id, wps);
  };

  const openMenu = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    setMenu({ x: ev.clientX, y: ev.clientY, fp: screenToFlowPosition({ x: ev.clientX, y: ev.clientY }) });
  };

  const addPointAt = (fp) => {
    const base = [src, ...interior, tgt];
    let bestSeg = 0;
    let best = Infinity;
    for (let k = 0; k < base.length - 1; k++) {
      const d = distToSeg(fp, base[k], base[k + 1]);
      if (d < best) { best = d; bestSeg = k; }
    }
    const p = snap(fp);
    const pts = [...base.slice(0, bestSeg + 1), p, ...base.slice(bestSeg + 1)];
    setEdgeWaypoints(id, pts.slice(1, -1));
  };

  const menuItems = [
    { label: 'Add point here', run: () => addPointAt(menu.fp) },
    { label: 'Make straight', run: () => setEdgeWaypoints(id, []) },
    { label: 'Auto-route', run: () => clearEdgeWaypoints(id) },
  ];

  return (
    <>
      {/* DRC severity halo under the wire when flagged */}
      {drcSeverity && (
        <BaseEdge
          path={dPath}
          style={{ stroke: `${DRC_HALO[drcSeverity] ?? DRC_HALO.info}66`, strokeWidth: strokeW + 5, fill: 'none' }}
        />
      )}
      {/* glow underlay when selected */}
      {selected && (
        <BaseEdge path={dPath} style={{ stroke: '#ffffff40', strokeWidth: 6, fill: 'none' }} />
      )}
      <BaseEdge
        path={dPath}
        style={{
          stroke: color,
          strokeWidth: strokeW,
          fill: 'none',
          strokeDasharray: route.fallback ? '6 4' : undefined,
        }}
      />
      {/* striped overlay — second color dashed on top of the solid base, giving
          a candy-stripe (PWR red/gray, CAN yellow/green). Skipped for solid
          wires (color2 == null) and for fallback dashed routes. */}
      {color2 && !route.fallback && (
        <BaseEdge
          path={dPath}
          style={{ stroke: color2, strokeWidth: strokeW, fill: 'none', strokeDasharray: '7 7' }}
        />
      )}
      {/* fat invisible hit area for easy selection + right-click menu */}
      <path
        d={dPath}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        className="react-flow__edge-interaction"
        onContextMenu={openMenu}
      />

      {/* alignment guides while dragging a waypoint */}
      {guides &&
        guides.lines.map((g, k) =>
          g.axis === 'x' ? (
            <line
              key={`gx-${k}`}
              x1={g.at}
              y1={guides.at.y - GUIDE_LEN}
              x2={g.at}
              y2={guides.at.y + GUIDE_LEN}
              stroke="#67e8f9"
              strokeWidth={0.75}
              strokeDasharray="4 4"
            />
          ) : (
            <line
              key={`gy-${k}`}
              x1={guides.at.x - GUIDE_LEN}
              y1={g.at}
              x2={guides.at.x + GUIDE_LEN}
              y2={g.at}
              stroke="#67e8f9"
              strokeWidth={0.75}
              strokeDasharray="4 4"
            />
          )
        )}

      {/* right-click context menu (screen-fixed via a body portal) */}
      {menu &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onPointerDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
            <div
              className="fixed z-50 w-40 overflow-hidden rounded-md border border-edge bg-surface-1 py-1 shadow-xl"
              style={{ left: menu.x, top: menu.y }}
            >
              {menuItems.map((it) => (
                <button
                  key={it.label}
                  onClick={() => { it.run(); setMenu(null); }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-silver hover:bg-surface-2"
                >
                  {it.label}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}

      {/* waypoint editing handles (only when selected) */}
      {selected && controlPts.length >= 2 && (
        <EdgeLabelRenderer>
          {/* insert dots at segment midpoints */}
          {controlPts.slice(0, -1).map((a, k) => {
            const b = controlPts[k + 1];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len < MIN_SEG) return null;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return (
              <div
                key={`ins-${k}`}
                className="nodrag nopan"
                onPointerDown={(ev) => onInsertDown(k, ev)}
                title="Drag to add a bend"
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)`,
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: '#1a1a1c',
                  border: `1.5px solid ${color}`,
                  opacity: 0.7,
                  cursor: 'copy',
                  pointerEvents: 'all',
                }}
              />
            );
          })}
          {/* draggable waypoint dots (interior control points) */}
          {controlPts.slice(1, -1).map((p, j) => {
            const i = j + 1;
            return (
              <div
                key={`wp-${j}`}
                className="nodrag nopan"
                onPointerDown={(ev) => onWaypointDown(i, ev)}
                onDoubleClick={(ev) => onWaypointDelete(i, ev)}
                title="Drag to move · double-click to remove"
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`,
                  width: 11,
                  height: 11,
                  borderRadius: '50%',
                  background: color,
                  border: '2px solid #1a1a1c',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.35)',
                  cursor: 'grab',
                  pointerEvents: 'all',
                }}
              />
            );
          })}
        </EdgeLabelRenderer>
      )}

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
