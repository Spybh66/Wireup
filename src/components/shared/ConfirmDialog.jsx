// Shared confirm dialog driven by store.confirmState (promise-based).
import { useEffect, useRef } from 'react';
import useDiagramStore from '../../store/diagramStore';

export default function ConfirmDialog() {
  const confirmState = useDiagramStore((s) => s.confirmState);
  const resolveConfirm = useDiagramStore((s) => s.resolveConfirm);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (confirmState) confirmRef.current?.focus();
  }, [confirmState]);

  useEffect(() => {
    if (!confirmState) return;
    const onKey = (e) => {
      if (e.key === 'Escape') resolveConfirm(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmState, resolveConfirm]);

  if (!confirmState) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={() => resolveConfirm(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-[28rem] max-w-[90vw] rounded-lg border border-edge bg-surface-1 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-5 text-sm text-silver">{confirmState.message}</p>
        <div className="flex justify-end gap-2">
          <button
            className="rounded border border-edge bg-surface-2 px-3 py-1.5 text-sm text-silver hover:bg-surface-0"
            onClick={() => resolveConfirm(false)}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            className="rounded bg-silver px-3 py-1.5 text-sm font-semibold text-surface-0 hover:bg-white"
            onClick={() => resolveConfirm(true)}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
