// Design Rule Check panel — floating bottom-left on the Diagram tab. Lists live
// violations (click to select + focus the offending element, or step through
// them) and lets the user set each rule's severity (or turn it off).
import { useState } from 'react';
import {
  ShieldCheck,
  CircleAlert,
  TriangleAlert,
  Info,
  X,
  SlidersHorizontal,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
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
const SEVERITY_OPTIONS = ['error', 'warning', 'info', 'off'];
const FIX_LABEL = { autoAssignCanId: 'Auto-number', autoAssignIp: 'Auto-assign' };

function SevIcon({ severity, size = 14 }) {
  const { Icon, cls } = SEV[severity] ?? SEV.info;
  return <Icon size={size} className={cls} />;
}

export default function DrcPanel({ onClose }) {
  const { violations, counts } = useDrc();
  const setSelection = useDiagramStore((s) => s.setSelection);
  const setDrcRuleSeverity = useDiagramStore((s) => s.setDrcRuleSeverity);
  const autoAssignCanIds = useDiagramStore((s) => s.autoAssignCanIds);
  const autoAssignIps = useDiagramStore((s) => s.autoAssignIps);
  const overrides = useDiagramStore((s) => s.settings.drc?.severityOverrides) ?? {};
  const disabledRules = useDiagramStore((s) => s.settings.drc?.disabledRules) ?? [];
  const [showRules, setShowRules] = useState(false);
  const [cursor, setCursor] = useState(0);

  const focus = (v) => {
    setSelection({ nodes: v.nodes ?? [], edges: v.edges ?? [] });
    canvasBridge.focusElements?.(v.nodes ?? []);
  };

  const step = (dir) => {
    if (!violations.length) return;
    const next = ((cursor + dir) % violations.length + violations.length) % violations.length;
    setCursor(next);
    focus(violations[next]);
  };

  const runFix = (kind) => {
    if (kind === 'autoAssignCanId') autoAssignCanIds();
    else if (kind === 'autoAssignIp') autoAssignIps();
  };

  const ruleValue = (rule) =>
    overrides[rule.id] ?? (disabledRules.includes(rule.id) ? 'off' : rule.severity);

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-10 flex max-h-[70vh] w-72 flex-col rounded-lg border border-edge bg-surface-1 shadow-xl">
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
          {!showRules && violations.length > 1 && (
            <>
              <button
                onClick={() => step(-1)}
                aria-label="Previous issue"
                title="Previous issue"
                className="rounded p-1 text-neutral-400 hover:bg-surface-2 hover:text-silver"
              >
                <ChevronUp size={15} />
              </button>
              <button
                onClick={() => step(1)}
                aria-label="Next issue"
                title="Next issue"
                className="rounded p-1 text-neutral-400 hover:bg-surface-2 hover:text-silver"
              >
                <ChevronDown size={15} />
              </button>
            </>
          )}
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
            {DRC_RULES.map((rule) => (
              <li key={rule.id} className="flex items-start gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <SevIcon severity={ruleValue(rule) === 'off' ? rule.severity : ruleValue(rule)} size={12} />
                    <span
                      className={`text-xs font-semibold ${
                        ruleValue(rule) === 'off' ? 'text-neutral-500' : 'text-silver'
                      }`}
                    >
                      {rule.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">{rule.description}</p>
                </div>
                <select
                  value={ruleValue(rule)}
                  onChange={(e) => setDrcRuleSeverity(rule.id, e.target.value, rule.severity)}
                  aria-label={`Severity for ${rule.label}`}
                  className="mt-0.5 shrink-0 rounded border border-edge bg-surface-0 px-1 py-0.5 text-[11px] text-silver"
                >
                  {SEVERITY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o[0].toUpperCase() + o.slice(1)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        ) : violations.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
            <ShieldCheck size={28} className="text-emerald-400" />
            <p className="text-sm text-neutral-400">No issues found</p>
          </div>
        ) : (
          <ul className="divide-y divide-edge/60">
            {violations.map((v, i) => (
              <li
                key={`${v.ruleId}-${i}`}
                className={`flex items-start ${i === cursor ? 'bg-surface-2/60' : 'hover:bg-surface-2'}`}
              >
                <button
                  onClick={() => {
                    setCursor(i);
                    focus(v);
                  }}
                  className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left"
                >
                  <span className="mt-0.5 shrink-0">
                    <SevIcon severity={v.severity} />
                  </span>
                  <span className="min-w-0 flex-1 text-xs text-silver">{v.message}</span>
                </button>
                {v.fix && FIX_LABEL[v.fix.kind] && (
                  <button
                    onClick={() => runFix(v.fix.kind)}
                    title="Apply automatic fix"
                    className="my-1 mr-2 shrink-0 self-center rounded border border-edge bg-surface-0 px-2 py-0.5 text-[11px] text-neutral-300 hover:text-silver"
                  >
                    {FIX_LABEL[v.fix.kind]}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
