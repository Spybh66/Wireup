// §6 Create Custom Component modal — name, category, size, port builder.
import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';
import {
  PORT_TYPES,
  defaultGaugeForType,
  defaultFittingForType,
} from '../../data/wireTypes';

const SIDES = ['top', 'right', 'bottom', 'left'];
const uuid = () => crypto.randomUUID();

export default function CreateComponentModal({ onClose }) {
  const addCustomDefinition = useDiagramStore((s) => s.addCustomDefinition);
  const addToast = useDiagramStore((s) => s.addToast);
  const firstRef = useRef(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('Custom');
  const [width, setWidth] = useState(120);
  const [height, setHeight] = useState(70);
  const [ports, setPorts] = useState([
    { key: uuid(), type: 'PWR+', label: 'V+', side: 'left' },
    { key: uuid(), type: 'PWR-', label: 'V-', side: 'left' },
  ]);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addPort = () =>
    setPorts((p) => [...p, { key: uuid(), type: 'DATA', label: 'Data', side: 'top' }]);
  const updatePort = (key, patch) =>
    setPorts((p) => p.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const removePort = (key) => setPorts((p) => p.filter((row) => row.key !== key));

  const clampSize = (v) => Math.max(60, Math.min(400, Number(v) || 60));

  const save = () => {
    if (!name.trim()) {
      addToast('Component name is required');
      firstRef.current?.focus();
      return;
    }
    const orderBySide = {};
    const defaultPorts = ports.map((row, i) => {
      const order = (orderBySide[row.side] = (orderBySide[row.side] ?? -1) + 1);
      return {
        id: `p${i}-${uuid().slice(0, 8)}`,
        type: row.type,
        label: row.label || row.type,
        side: row.side,
        order,
        gauge: defaultGaugeForType(row.type),
        fitting: defaultFittingForType(row.type),
      };
    });
    addCustomDefinition({
      id: uuid(),
      name: name.trim(),
      category: category.trim() || 'Custom',
      width: clampSize(width),
      height: clampSize(height),
      icon: 'generic',
      defaultPorts,
      trackedFields: [],
    });
    addToast(`Created "${name.trim()}"`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create custom component"
        className="flex max-h-[85vh] w-[34rem] max-w-[92vw] flex-col rounded-lg border border-edge bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge p-4">
          <h2 className="font-heading text-lg font-semibold text-silver">New Custom Component</h2>
          <button onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-silver">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 block text-sm">
              <span className="mb-1 block text-neutral-400">Name *</span>
              <input
                ref={firstRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-edge bg-surface-0 px-2 py-1.5 text-silver outline-none focus:border-silver"
              />
            </label>
            <label className="col-span-2 block text-sm">
              <span className="mb-1 block text-neutral-400">Category</span>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded border border-edge bg-surface-0 px-2 py-1.5 text-silver outline-none focus:border-silver"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-neutral-400">Width (px)</span>
              <input
                type="number"
                min={60}
                max={400}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="w-full rounded border border-edge bg-surface-0 px-2 py-1.5 text-silver outline-none focus:border-silver"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-neutral-400">Height (px)</span>
              <input
                type="number"
                min={60}
                max={400}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="w-full rounded border border-edge bg-surface-0 px-2 py-1.5 text-silver outline-none focus:border-silver"
              />
            </label>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-silver">Ports</span>
              <button
                onClick={addPort}
                className="flex items-center gap-1 rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-silver hover:bg-surface-0"
              >
                <Plus size={14} /> Add port
              </button>
            </div>
            <div className="space-y-2">
              {ports.map((row) => (
                <div key={row.key} className="flex items-center gap-2">
                  <select
                    value={row.type}
                    onChange={(e) => updatePort(row.key, { type: e.target.value })}
                    aria-label="Port type"
                    className="w-24 rounded border border-edge bg-surface-0 px-1.5 py-1 text-sm text-silver"
                  >
                    {PORT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    value={row.label}
                    onChange={(e) => updatePort(row.key, { label: e.target.value })}
                    placeholder="Label"
                    aria-label="Port label"
                    className="flex-1 rounded border border-edge bg-surface-0 px-2 py-1 text-sm text-silver"
                  />
                  <select
                    value={row.side}
                    onChange={(e) => updatePort(row.key, { side: e.target.value })}
                    aria-label="Port side"
                    className="w-24 rounded border border-edge bg-surface-0 px-1.5 py-1 text-sm text-silver"
                  >
                    {SIDES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => removePort(row.key)}
                    aria-label="Remove port"
                    className="rounded p-1 text-neutral-400 hover:bg-surface-2 hover:text-red-400"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {ports.length === 0 && (
                <p className="text-sm text-neutral-500">No ports yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-edge p-4">
          <button
            onClick={onClose}
            className="rounded border border-edge bg-surface-2 px-3 py-1.5 text-sm text-silver hover:bg-surface-0"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded bg-silver px-3 py-1.5 text-sm font-semibold text-surface-0 hover:bg-white"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
