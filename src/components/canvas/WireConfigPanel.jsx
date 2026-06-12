// §9 Wire config panel — floating top-right; edits the selected edge.
import { X } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';
import {
  GAUGE_OPTIONS,
  FITTING_OPTIONS,
  typeHasGaugeFitting,
  typeColor,
} from '../../data/wireTypes';

export default function WireConfigPanel({ edgeId, onClose }) {
  const edge = useDiagramStore((s) => s.edges.find((e) => e.id === edgeId));
  const layers = useDiagramStore((s) => s.layers);
  const nodes = useDiagramStore((s) => s.nodes);
  const updateEdgeData = useDiagramStore((s) => s.updateEdgeData);
  if (!edge) return null;

  const d = edge.data;
  const showGF = typeHasGaugeFitting(d.type);
  const fromNode = nodes.find((n) => n.id === edge.source);
  const toNode = nodes.find((n) => n.id === edge.target);

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-10 w-64 rounded-lg border border-edge bg-surface-1/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-300">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: d.color ?? typeColor(d.type) }} />
          Wire
        </span>
        <button onClick={onClose} aria-label="Close wire panel" className="text-neutral-400 hover:text-silver">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3 p-3 text-sm">
        <div className="text-xs text-neutral-500">
          {fromNode?.data.label} → {toNode?.data.label}
        </div>

        <label className="block">
          <span className="mb-1 block text-neutral-400">Label</span>
          <input
            value={d.label}
            onChange={(e) => updateEdgeData(edgeId, { label: e.target.value, labelEdited: true })}
            className="w-full rounded border border-edge bg-surface-0 px-2 py-1 text-silver outline-none focus:border-silver"
          />
        </label>

        <div className="flex items-center gap-2">
          <span className="rounded bg-surface-2 px-2 py-1 text-xs text-neutral-300" title="Wire type (read-only)">
            {d.type}
          </span>
          <label className="ml-auto flex items-center gap-1 text-neutral-400">
            color
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
          <div className="grid grid-cols-2 gap-2">
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
            <label className="block">
              <span className="mb-1 block text-neutral-400">Fitting</span>
              <select
                value={d.wireFitting ?? ''}
                onChange={(e) => updateEdgeData(edgeId, { wireFitting: e.target.value || null })}
                className="w-full rounded border border-edge bg-surface-0 px-1 py-1 text-silver"
              >
                <option value="">—</option>
                {FITTING_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
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
