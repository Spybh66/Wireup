// §7 Layer panel — floating bottom-left, visible only on the Diagram tab.
import { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2, Layers } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';

function LayerRow({ layer }) {
  const toggleLayer = useDiagramStore((s) => s.toggleLayer);
  const renameLayer = useDiagramStore((s) => s.renameLayer);
  const removeLayer = useDiagramStore((s) => s.removeLayer);
  const requestConfirm = useDiagramStore((s) => s.requestConfirm);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);

  const commit = () => {
    if (draft.trim()) renameLayer(layer.id, draft.trim());
    else setDraft(layer.name);
    setEditing(false);
  };

  const onDelete = async () => {
    const ok = await requestConfirm(
      `Delete layer "${layer.name}"? Its wires will be moved to the Power layer.`
    );
    if (ok) removeLayer(layer.id);
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <button
        onClick={() => toggleLayer(layer.id)}
        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        className="text-neutral-300 hover:text-silver"
      >
        {layer.visible ? <Eye size={15} /> : <EyeOff size={15} className="text-neutral-600" />}
      </button>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="flex-1 rounded border border-edge bg-surface-0 px-1 py-0.5 text-sm text-silver"
        />
      ) : (
        <span
          onDoubleClick={() => !layer.builtIn && (setDraft(layer.name), setEditing(true))}
          className={`flex-1 truncate text-sm ${layer.visible ? 'text-silver' : 'text-neutral-500'}`}
          title={layer.builtIn ? layer.name : `${layer.name} (double-click to rename)`}
        >
          {layer.name}
        </span>
      )}
      {!layer.builtIn && (
        <button
          onClick={onDelete}
          aria-label={`Delete ${layer.name}`}
          className="text-neutral-400 hover:text-red-400"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

export default function LayerPanel() {
  const layers = useDiagramStore((s) => s.layers);
  const addLayer = useDiagramStore((s) => s.addLayer);
  const [open, setOpen] = useState(true);

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 w-56 rounded-lg border border-edge bg-surface-1/95 shadow-xl backdrop-blur">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-t-lg border-b border-edge px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-300"
      >
        <Layers size={14} /> Layers
        <span className="ml-auto text-neutral-600">{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div className="p-2">
          {layers.map((l) => (
            <LayerRow key={l.id} layer={l} />
          ))}
          <button
            onClick={addLayer}
            className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-edge bg-surface-2 py-1 text-xs text-silver hover:bg-surface-0"
          >
            <Plus size={13} /> Add layer
          </button>
        </div>
      )}
    </div>
  );
}
