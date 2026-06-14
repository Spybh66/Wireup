// First-run welcome modal + empty-canvas hint. Shown only on the Diagram tab.
import { useState } from 'react';
import { Cable, Wand2, X } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';

const SEEN_KEY = 'wireup_onboarded';

export default function Onboarding() {
  const nodeCount = useDiagramStore((s) => s.nodes.length);
  const loadSample = useDiagramStore((s) => s.loadSample);
  const [welcome, setWelcome] = useState(() => {
    try {
      return !localStorage.getItem(SEEN_KEY);
    } catch {
      return false;
    }
  });

  const seen = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch { /* ignore */ }
    setWelcome(false);
  };

  if (welcome) {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
        <div className="w-[28rem] max-w-[92vw] rounded-lg border border-edge bg-surface-1 p-5 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-heading text-xl font-semibold text-silver">Welcome to Wireup</h2>
            <button onClick={seen} aria-label="Close" className="text-neutral-400 hover:text-silver">
              <X size={18} />
            </button>
          </div>
          <p className="text-sm text-neutral-300">
            Lay out your FRC robot’s electronics, wire them up, and get a build-ready sheet.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-neutral-400">
            <li>• Drag components from the left library onto the canvas.</li>
            <li>• Drag port-to-port to wire them; wires auto-route.</li>
            <li>• The <strong className="text-neutral-200">Checks</strong> panel validates against the FRC rules.</li>
            <li>• The <strong className="text-neutral-200">Sheet</strong> tab has the wire list + bill of materials.</li>
          </ul>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={seen}
              className="rounded border border-edge bg-surface-2 px-3 py-1.5 text-sm text-silver hover:bg-surface-0"
            >
              Start blank
            </button>
            <button
              onClick={() => { loadSample(); seen(); }}
              className="flex items-center gap-1.5 rounded bg-silver px-3 py-1.5 text-sm font-semibold text-surface-0 hover:bg-white"
            >
              <Wand2 size={15} /> Load a sample robot
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (nodeCount === 0) {
    return (
      <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <Cable size={40} className="text-neutral-700" />
          <p className="text-sm text-neutral-500">
            Drag a component from the library to begin
          </p>
          <button
            onClick={loadSample}
            className="pointer-events-auto flex items-center gap-1.5 rounded border border-edge bg-surface-1 px-3 py-1.5 text-sm text-silver hover:bg-surface-2"
          >
            <Wand2 size={15} /> Load a sample robot
          </button>
        </div>
      </div>
    );
  }
  return null;
}
