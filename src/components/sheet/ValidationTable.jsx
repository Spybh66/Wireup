// §10 Validation table — Design Rule Check results in the Sheet view.
import { CircleAlert, TriangleAlert, Info, ShieldCheck } from 'lucide-react';
import { useDrc } from '../../store/useDrc';
import useDiagramStore from '../../store/diagramStore';
import { DRC_RULES } from '../../utils/drc/rules';

const RULE_LABEL = new Map(DRC_RULES.map((r) => [r.id, r.label]));
const SEV = {
  error: { Icon: CircleAlert, cls: 'text-red-400' },
  warning: { Icon: TriangleAlert, cls: 'text-amber-400' },
  info: { Icon: Info, cls: 'text-sky-400' },
};

export default function ValidationTable() {
  const { violations } = useDrc();
  const nodes = useDiagramStore((s) => s.nodes);
  const labelOf = (id) => nodes.find((n) => n.id === id)?.data.label ?? id;

  if (!violations.length) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface-1 px-4 py-3 text-sm text-neutral-400">
        <ShieldCheck size={16} className="text-emerald-400" /> No design-rule issues found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-edge">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="bg-surface-2 text-xs uppercase text-neutral-400">
          <tr>
            <th className="w-20 px-3 py-2">Severity</th>
            <th className="w-40 px-3 py-2">Rule</th>
            <th className="px-3 py-2">Issue</th>
            <th className="w-48 px-3 py-2">Components</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {violations.map((v, i) => {
            const { Icon, cls } = SEV[v.severity] ?? SEV.info;
            return (
              <tr key={`${v.ruleId}-${i}`} className="text-neutral-300">
                <td className="px-3 py-2">
                  <span className={`flex items-center gap-1 ${cls}`}>
                    <Icon size={13} /> {v.severity}
                  </span>
                </td>
                <td className="px-3 py-2 text-neutral-400">{RULE_LABEL.get(v.ruleId) ?? v.ruleId}</td>
                <td className="px-3 py-2 text-silver">{v.message}</td>
                <td className="break-words px-3 py-2 text-neutral-400">
                  {(v.nodes ?? []).map(labelOf).join(', ')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
