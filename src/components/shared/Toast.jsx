// §9 Shared toast system — bottom-center, auto-dismiss 3.5s, max 3 stacked.
import { useEffect } from 'react';
import useDiagramStore from '../../store/diagramStore';

function ToastItem({ toast }) {
  const removeToast = useDiagramStore((s) => s.removeToast);
  useEffect(() => {
    const t = setTimeout(() => removeToast(toast.id), 3500);
    return () => clearTimeout(t);
  }, [toast.id, removeToast]);
  return (
    <div
      role="status"
      className="pointer-events-auto rounded-md border border-edge bg-surface-2 px-4 py-2 text-sm text-silver shadow-lg"
    >
      {toast.message}
    </div>
  );
}

export default function Toaster() {
  const toasts = useDiagramStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
