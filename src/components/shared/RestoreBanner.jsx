// §2.8 Restore-from-autosave banner (non-blocking). Dismiss keeps the autosave.
import useDiagramStore from '../../store/diagramStore';

export default function RestoreBanner() {
  const restoreData = useDiagramStore((s) => s.restoreData);
  const loadProject = useDiagramStore((s) => s.loadProject);
  const dismissRestore = useDiagramStore((s) => s.dismissRestore);
  if (!restoreData) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-edge bg-surface-2 px-4 py-2 text-sm text-silver shadow-xl">
      <span>Restore your last session?</span>
      <button
        onClick={() => loadProject(restoreData)}
        className="rounded bg-silver px-2.5 py-1 text-xs font-semibold text-surface-0 hover:bg-white"
      >
        Restore
      </button>
      <button
        onClick={dismissRestore}
        className="rounded border border-edge px-2.5 py-1 text-xs text-silver hover:bg-surface-0"
      >
        Dismiss
      </button>
    </div>
  );
}
