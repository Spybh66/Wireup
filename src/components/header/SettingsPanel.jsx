// §12 Settings drawer — exactly five settings (§2.7). No label template here.
import { useEffect } from 'react';
import { X } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between py-2 text-sm text-silver">
      <span>{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-silver' : 'bg-surface-2'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface-0 transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

export default function SettingsPanel({ onClose }) {
  const settings = useDiagramStore((s) => s.settings);
  const updateSettings = useDiagramStore((s) => s.updateSettings);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <aside
        role="dialog"
        aria-label="Settings"
        className="absolute right-0 top-0 flex h-full w-72 flex-col border-l border-edge bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge p-4">
          <h2 className="font-heading text-lg font-semibold text-silver">Settings</h2>
          <button onClick={onClose} aria-label="Close settings" className="text-neutral-400 hover:text-silver">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <label className="block py-2 text-sm">
            <span className="mb-1 block text-silver">Grid size (px)</span>
            <input
              type="number"
              min={4}
              max={100}
              value={settings.gridSize}
              onChange={(e) => {
                const v = Math.max(4, Math.min(100, Number(e.target.value) || 4));
                updateSettings({ gridSize: v });
              }}
              className="w-full rounded border border-edge bg-surface-0 px-2 py-1.5 text-silver outline-none focus:border-silver"
            />
          </label>

          <Toggle
            label="Snap to grid"
            checked={settings.snapToGrid}
            onChange={(v) => updateSettings({ snapToGrid: v })}
          />
          <Toggle
            label="Grid visible"
            checked={settings.gridVisible}
            onChange={(v) => updateSettings({ gridVisible: v })}
          />
          <Toggle
            label="Show port labels"
            checked={settings.showPortLabels}
            onChange={(v) => updateSettings({ showPortLabels: v })}
          />
          <Toggle
            label="Show wire labels"
            checked={settings.showWireLabels}
            onChange={(v) => updateSettings({ showWireLabels: v })}
          />
        </div>
      </aside>
    </div>
  );
}
