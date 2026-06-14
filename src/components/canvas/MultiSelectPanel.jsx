// Multi-selection editor — bulk-edit several selected wires and/or components.
import { X, Lock, Unlock, Trash2 } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';
import { GAUGE_OPTIONS } from '../../data/wireTypes';

export default function MultiSelectPanel({ onClose }) {
  const selection = useDiagramStore((s) => s.selection);
  const updateEdgesData = useDiagramStore((s) => s.updateEdgesData);
  const updateNodesData = useDiagramStore((s) => s.updateNodesData);
  const deleteSelection = useDiagramStore((s) => s.deleteSelection);
  const layers = useDiagramStore((s) => s.layers);

  const nIds = selection.nodes;
  const eIds = selection.edges;
  const nCount = nIds.length;
  const eCount = eIds.length;

  const Field = ({ label, children }) => (
    <label className="block">
      <span className="mb-1 block text-neutral-400">{label}</span>
      {children}
    </label>
  );

  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-10 w-64 rounded-lg border border-edge bg-surface-1 shadow-xl">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
          {nCount + eCount} selected
          <span className="ml-1 text-neutral-500">
            ({nCount} comp · {eCount} wire)
          </span>
        </span>
        <button onClick={onClose} aria-label="Clear selection" className="text-neutral-400 hover:text-silver">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3 p-3 text-sm">
        {eCount > 0 && (
          <>
            <Field label={`Layer — ${eCount} wire${eCount > 1 ? 's' : ''}`}>
              <select
                defaultValue=""
                onChange={(e) => e.target.value && updateEdgesData(eIds, { layerId: e.target.value })}
                className="w-full rounded border border-edge bg-surface-0 px-2 py-1 text-silver"
              >
                <option value="">Set layer…</option>
                {layers.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Gauge">
              <select
                defaultValue=""
                onChange={(e) => updateEdgesData(eIds, { wireGauge: e.target.value || null })}
                className="w-full rounded border border-edge bg-surface-0 px-2 py-1 text-silver"
              >
                <option value="">Set gauge…</option>
                {GAUGE_OPTIONS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </Field>
            <div className="flex items-center gap-2">
              <span className="text-neutral-400">Wire color</span>
              <input
                type="color"
                onChange={(e) => updateEdgesData(eIds, { color: e.target.value })}
                aria-label="Set wire color"
                className="ml-auto h-7 w-9 cursor-pointer rounded border border-edge bg-surface-0"
              />
              <button
                onClick={() => updateEdgesData(eIds, { color: null, color2: null })}
                className="text-xs text-neutral-400 hover:text-silver"
              >
                reset
              </button>
            </div>
          </>
        )}

        {nCount > 0 && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-neutral-400">Component color</span>
              <input
                type="color"
                onChange={(e) => updateNodesData(nIds, { color: e.target.value })}
                aria-label="Set component color"
                className="ml-auto h-7 w-9 cursor-pointer rounded border border-edge bg-surface-0"
              />
              <button
                onClick={() => updateNodesData(nIds, { color: null })}
                className="text-xs text-neutral-400 hover:text-silver"
              >
                reset
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => updateNodesData(nIds, { locked: true })}
                className="flex flex-1 items-center justify-center gap-1 rounded border border-edge bg-surface-2 py-1 text-xs text-silver hover:bg-surface-0"
              >
                <Lock size={13} /> Lock
              </button>
              <button
                onClick={() => updateNodesData(nIds, { locked: false })}
                className="flex flex-1 items-center justify-center gap-1 rounded border border-edge bg-surface-2 py-1 text-xs text-silver hover:bg-surface-0"
              >
                <Unlock size={13} /> Unlock
              </button>
            </div>
          </>
        )}

        <button
          onClick={deleteSelection}
          className="flex w-full items-center justify-center gap-1 rounded border border-red-900 bg-red-950/40 py-1.5 text-xs text-red-300 hover:bg-red-900/40"
        >
          <Trash2 size={13} /> Delete selection
        </button>
      </div>
    </div>
  );
}
