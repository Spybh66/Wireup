// §9 Wire config panel — floating top-right; edits the selected edge.
import { X, ArrowLeftRight } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';
import {
  GAUGE_OPTIONS,
  FITTING_OPTIONS,
  typeHasGaugeFitting,
  typeColor,
  typeColor2,
} from '../../data/wireTypes';

export default function WireConfigPanel({ edgeId, onClose }) {
  const edge = useDiagramStore((s) => s.edges.find((e) => e.id === edgeId));
  const layers = useDiagramStore((s) => s.layers);
  const nodes = useDiagramStore((s) => s.nodes);
  const updateEdgeData = useDiagramStore((s) => s.updateEdgeData);
  const flipEdge = useDiagramStore((s) => s.flipEdge);
  const clearEdgeWaypoints = useDiagramStore((s) => s.clearEdgeWaypoints);
  if (!edge) return null;

  const d = edge.data;
  const showGF = typeHasGaugeFitting(d.type);
  const hasStripe = typeColor2(d.type) != null;
  const fromNode = nodes.find((n) => n.id === edge.source);
  const toNode = nodes.find((n) => n.id === edge.target);

  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-10 w-64 rounded-lg border border-edge bg-surface-1 shadow-xl">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-300">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{
              background: hasStripe
                ? `repeating-linear-gradient(45deg, ${d.color ?? typeColor(d.type)} 0 2px, ${d.color2 ?? typeColor2(d.type)} 2px 4px)`
                : (d.color ?? typeColor(d.type)),
            }}
          />
          Wire
        </span>
        <button onClick={onClose} aria-label="Close wire panel" className="text-neutral-400 hover:text-silver">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3 p-3 text-sm">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="min-w-0 flex-1 truncate">
            {fromNode?.data.label} → {toNode?.data.label}
          </span>
          <button
            onClick={() => flipEdge(edgeId)}
            title="Flip direction (swap From / To)"
            aria-label="Flip wire direction"
            className="flex shrink-0 items-center gap-1 rounded border border-edge bg-surface-2 px-2 py-1 text-neutral-300 hover:bg-surface-0 hover:text-silver"
          >
            <ArrowLeftRight size={13} /> Flip
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 rounded bg-surface-2 px-2 py-1.5 text-xs">
          <span className="text-neutral-300">
            Routing:{' '}
            <span className="font-semibold text-silver">{d.manual ? 'Manual' : 'Auto'}</span>
            {d.manual && d.waypoints?.length
              ? ` · ${d.waypoints.length} pt${d.waypoints.length > 1 ? 's' : ''}`
              : ''}
          </span>
          {d.manual ? (
            <button
              onClick={() => clearEdgeWaypoints(edgeId)}
              className="shrink-0 rounded border border-edge bg-surface-0 px-2 py-0.5 text-neutral-300 hover:text-silver"
            >
              Reset to auto
            </button>
          ) : (
            <span className="shrink-0 text-neutral-500">drag wire to edit</span>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-neutral-400">Label</span>
          <input
            value={d.label}
            onChange={(e) => updateEdgeData(edgeId, { label: e.target.value, labelEdited: true })}
            className="w-full rounded border border-edge bg-surface-0 px-2 py-1 text-silver outline-none focus:border-silver"
          />
        </label>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded bg-surface-2 px-2 py-1 text-xs text-neutral-300" title="Wire type (read-only)">
              {d.type}
            </span>
            <label className="ml-auto flex items-center gap-1 text-neutral-400">
              {hasStripe ? 'color 1' : 'color'}
              <input
                type="color"
                value={d.color ?? typeColor(d.type)}
                onChange={(e) => updateEdgeData(edgeId, { color: e.target.value })}
                aria-label="Wire color"
                className="h-7 w-9 cursor-pointer rounded border border-edge bg-surface-0"
              />
            </label>
            {d.color && (
              <button
                onClick={() => updateEdgeData(edgeId, { color: null })}
                className="text-xs text-neutral-400 hover:text-silver"
              >
                reset
              </button>
            )}
          </div>
          {hasStripe && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500" title="Striped wire — second color">
                stripe
              </span>
              <label className="ml-auto flex items-center gap-1 text-neutral-400">
                color 2
                <input
                  type="color"
                  value={d.color2 ?? typeColor2(d.type)}
                  onChange={(e) => updateEdgeData(edgeId, { color2: e.target.value })}
                  aria-label="Wire stripe color"
                  className="h-7 w-9 cursor-pointer rounded border border-edge bg-surface-0"
                />
              </label>
              {d.color2 && (
                <button
                  onClick={() => updateEdgeData(edgeId, { color2: null })}
                  className="text-xs text-neutral-400 hover:text-silver"
                >
                  reset
                </button>
              )}
            </div>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-neutral-400">Layer</span>
          <select
            value={d.layerId}
            onChange={(e) => updateEdgeData(edgeId, { layerId: e.target.value })}
            className="w-full rounded border border-edge bg-surface-0 px-2 py-1 text-silver"
          >
            {layers.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>

        {showGF && (
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-neutral-400">Gauge</span>
              <select
                value={d.wireGauge ?? ''}
                onChange={(e) => updateEdgeData(edgeId, { wireGauge: e.target.value || null })}
                className="w-full rounded border border-edge bg-surface-0 px-1 py-1 text-silver"
              >
                <option value="">—</option>
                {GAUGE_OPTIONS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-neutral-400" title={`Fitting at ${fromNode?.data.label ?? 'from'}`}>
                  Fitting (from)
                </span>
                <select
                  value={d.wireFittingFrom ?? d.wireFitting ?? ''}
                  onChange={(e) => updateEdgeData(edgeId, { wireFittingFrom: e.target.value || null })}
                  className="w-full rounded border border-edge bg-surface-0 px-1 py-1 text-silver"
                >
                  <option value="">—</option>
                  {FITTING_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-neutral-400" title={`Fitting at ${toNode?.data.label ?? 'to'}`}>
                  Fitting (to)
                </span>
                <select
                  value={d.wireFittingTo ?? d.wireFitting ?? ''}
                  onChange={(e) => updateEdgeData(edgeId, { wireFittingTo: e.target.value || null })}
                  className="w-full rounded border border-edge bg-surface-0 px-1 py-1 text-silver"
                >
                  <option value="">—</option>
                  {FITTING_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-neutral-400">Length (in)</span>
          <input
            type="number"
            min={0}
            value={d.length ?? ''}
            onChange={(e) =>
              updateEdgeData(edgeId, { length: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })
            }
            className="w-full rounded border border-edge bg-surface-0 px-2 py-1 text-silver outline-none focus:border-silver"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-400">Notes</span>
          <textarea
            value={d.notes}
            onChange={(e) => updateEdgeData(edgeId, { notes: e.target.value })}
            rows={2}
            className="w-full rounded border border-edge bg-surface-0 px-2 py-1 text-silver outline-none focus:border-silver"
          />
        </label>
      </div>
    </div>
  );
}
