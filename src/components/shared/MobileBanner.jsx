// §13 Dismissible "best on desktop" banner below 768px.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export default function MobileBanner() {
  const [narrow, setNarrow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (!narrow || dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-2 border-b border-amber-900/50 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200">
      <span>Wireup is best used on desktop.</span>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-amber-300 hover:text-amber-100">
        <X size={14} />
      </button>
    </div>
  );
}
