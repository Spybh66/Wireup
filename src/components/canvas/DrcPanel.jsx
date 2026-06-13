// Design Rule Check panel — floating bottom-left on the Diagram tab. Lists live
// violations (click to select + focus the offending element) and lets the user
// enable/disable individual rules.
import { useState } from 'react';
import {
  ShieldCheck,
  CircleAlert,
  TriangleAlert,
  Info,
  X,
  SlidersHorizontal,
  ChevronLeft,
} from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';
import { useDrc } from '../../store/useDrc';
import { DRC_RULES } from '../../utils/drc/rules';
import { canvasBridge } from './canvasBridge';

const SEV = {
  error: { Icon: CircleAlert, cls: 'text-red-400' },
  warning: { Icon: TriangleAlert, cls: 'text-amber-400' },
  info: { Icon: Info, cls: 'text-sky-400' },
};

function SevIcon({ severity, size = 14 }) {
  const { Icon, cls } = SEV[severity] ?? SEV.info;
  return <Icon size={size} className={cls} />;
}

export default function DrcPanel({ onClose }) {
  const { violations, counts } = useDrc();
  const setSelection = useDiagramStore((s) => s.setSelection);
  const toggleDrcRule = useDiagramStore((s) => s.toggleDrcRule);
  const disabledRules = useDiagramStore((s) => s.settings.drc?.disabledRules) ?? [];
  const [showRules, setShowRules] = useState(false);

  const focus = (v) => {
    setSelection({ nodes: v.nodes ?? [], edges: v.edges ?? [] });
    canvasBridge.focusElements?.(v.nodes ?? []);
  };

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 flex max-h-[60vh] w-72 flex-col rounded-lg border border-edge bg-surface-1 shadow-xl">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <ShieldCheck size={15} className="text-neutral-300" />
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
          {showRules ? 'Check rules' : 'Checks'}
        </span>
        {!showRules && (
          <span className="ml-1 flex items-center gap-2 text-xs text-neutral-500">
            {counts.error > 0 && (
              <span className="flex items-center gap-0.5 text-red-400">
                <CircleAlert size={12} /> {counts.error}
              </span>
            )}
            {counts.warning > 0 && (
              <span className="flex items-center gap-0.5 text-amber-400">
                <TriangleAlert size={12} /> {counts.warning}
              </span>
            )}
            {counts.info > 0 && (
              <span className="flex items-center gap-0.5 text-sky-400">
                <Info size={12} /> {counts.info}
              </span>
            )}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setShowRules((v) => !v)}
            aria-label={showRules ? 'Back to issues' : 'Configure rules'}
            title={showRules ? 'Back to issues' : 'Configure rules'}
            className="rounded p-1 text-neutral-400 hover:bg-surface-2 hover:text-silver"
          >
            {showRules ? <ChevronLeft size={15} /> : <SlidersHorizontal size={14} />}
          </button>
          <button
            onClick={onClose}
            aria-label="Close checks panel"
            className="rounded p-1 text-neutral-400 hover:bg-surface-2 hover:text-silver"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showRules ? (
          <ul className="divide-y divide-edge/60">
            {DRC_RULES.map((rule) => {
              const enabled = !disabledRules.includes(rule.id);
              return (
                <li key={rule.id} className="flex items-start gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleDrcRule(rule.id)}
                    aria-label={`Toggle ${rule.label}`}
                    className="mt-0.5 cursor-pointer accent-silver"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <SevIcon severity={rule.severity} size={12} />
                      <span className={`text-xs font-semibold ${enabled ? 'text-silver' : 'text-neutral-500'}`}>
                        {rule.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">{rule.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : violations.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
            <ShieldCheck size={28} className="text-emerald-400" />
            <p className="text-sm text-neutral-400">No issues found</p>
          </div>
        ) : (
          <ul className="divide-y divide-edge/60">
            {violations.map((v, i) => (
              <li key={`${v.ruleId}-${i}`}>
                <button
                  onClick={() => focus(v)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-2"
                >
                  <span className="mt-0.5 shrink-0">
                    <SevIcon severity={v.severity} />
                  </span>
                  <span className="min-w-0 flex-1 text-xs text-silver">{v.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
