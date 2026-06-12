// §10 Table 2 — Wires (sortable, filterable, inline-editable) + §4.2 template editor.
import { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';
import { buildWireRows } from '../../utils/sheetData';

const COLUMNS = [
  { key: 'label', label: 'Wire Label', width: '11%' },
  { key: 'group', label: 'Type', width: '7%' },
  { key: 'from', label: 'From', width: '12%' },
  { key: 'to', label: 'To', width: '12%' },
  { key: 'gauge', label: 'Gauge', width: '7%' },
  { key: 'fittingFrom', label: 'Fitting (From)', width: '11%' },
  { key: 'fittingTo', label: 'Fitting (To)', width: '11%' },
  { key: 'color', label: 'Color', width: '5%' },
  { key: 'length', label: 'Length (in)', width: '8%' },
  { key: 'notes', label: 'Notes', width: '11%' },
  { key: 'layer', label: 'Layer', width: '5%' },
];

function TemplateEditor() {
  const template = useDiagramStore((s) => s.wireLabelTemplate);
  const setTemplate = useDiagramStore((s) => s.setWireLabelTemplate);
  const edges = useDiagramStore((s) => s.edges);
  const regenerate = useDiagramStore((s) => s.regenerateAllLabels);
  const requestConfirm = useDiagramStore((s) => s.requestConfirm);
  const [draft, setDraft] = useState(template);

  const run = async () => {
    setTemplate(draft);
    const editedCount = edges.filter((e) => e.data.labelEdited).length;
    if (editedCount > 0) {
      const ok = await requestConfirm(
        `${editedCount} manually edited label${editedCount === 1 ? '' : 's'} will be overwritten. Continue?`
      );
      if (!ok) return;
    }
    regenerate();
  };

  return (
    <div className="mb-3 rounded-lg border border-edge bg-surface-1 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-neutral-400">Label template</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          aria-label="Wire label template"
          className="flex-1 rounded border border-edge bg-surface-0 px-2 py-1 font-mono text-sm text-silver outline-none focus:border-silver"
        />
        <button
          onClick={run}
          className="rounded bg-silver px-3 py-1 text-sm font-semibold text-surface-0 hover:bg-white"
        >
          Regenerate
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-neutral-500">
        {['{type}', '{index}', '{from}', '{to}'].map((tok) => (
          <code key={tok} className="rounded bg-surface-2 px-1.5 py-0.5 text-neutral-300">{tok}</code>
        ))}
      </div>
    </div>
  );
}

function EditableCell({ value, onCommit, type = 'text', multiline = false }) {
  const [draft, setDraft] = useState(value ?? '');
  const commit = () => onCommit(draft);
  const cls =
    'block w-full min-w-0 box-border rounded border border-transparent bg-transparent px-1 py-0.5 text-silver hover:border-edge focus:border-silver focus:bg-surface-0 focus:outline-none';
  if (multiline) {
    return (
      <textarea
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={`${cls} resize-none whitespace-pre-wrap break-words`}
      />
    );
  }
  return (
    <input
      type={type}
      min={type === 'number' ? 0 : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={cls}
    />
  );
}

export default function WireTable() {
  const edges = useDiagramStore((s) => s.edges);
  const nodes = useDiagramStore((s) => s.nodes);
  const layers = useDiagramStore((s) => s.layers);
  const customDefinitions = useDiagramStore((s) => s.customDefinitions);
  const updateEdgeData = useDiagramStore((s) => s.updateEdgeData);
  const [sort, setSort] = useState({ key: 'group', dir: 'asc' });
  const [filter, setFilter] = useState('');

  const rows = useMemo(
    () => buildWireRows({ nodes, edges, layers, customDefinitions }),
    [nodes, edges, layers, customDefinitions]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let r = rows;
    if (q) {
      r = r.filter(
        (row) =>
          row.label.toLowerCase().includes(q) ||
          row.from.toLowerCase().includes(q) ||
          row.to.toLowerCase().includes(q)
      );
    }
    const sorted = [...r].sort((a, b) => {
      // secondary sort by label keeps grouped wires tidy
      const av = a[sort.key] ?? '';
      const bv = b[sort.key] ?? '';
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      const primary = sort.dir === 'asc' ? cmp : -cmp;
      return primary || a.label.localeCompare(b.label);
    });
    return sorted;
  }, [rows, filter, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <div>
      <TemplateEditor />
      <div className="mb-2 flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by label / from / to"
          aria-label="Filter wires"
          className="w-72 rounded border border-edge bg-surface-0 px-2 py-1 text-sm text-silver outline-none focus:border-silver"
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-edge">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead className="bg-surface-2 text-left text-neutral-300">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2 font-semibold">
                  <button onClick={() => toggleSort(c.key)} className="flex items-center gap-1 text-left hover:text-silver">
                    {c.label}
                    {sort.key === c.key &&
                      (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-edge align-top text-silver">
                <td className="px-3 py-1.5 font-heading break-words">{r.label}</td>
                <td className="px-3 py-1.5">{r.group}</td>
                <td className="px-3 py-1.5 break-words">{r.from}</td>
                <td className="px-3 py-1.5 break-words">{r.to}</td>
                <td className="px-3 py-1.5">{r.gauge}</td>
                <td className="px-3 py-1.5 break-words">{r.fittingFrom}</td>
                <td className="px-3 py-1.5 break-words">{r.fittingTo}</td>
                <td className="px-3 py-1.5">
                  <span className="inline-block h-4 w-4 rounded border border-edge align-middle" style={{ background: r.color }} />
                </td>
                <td className="px-3 py-1">
                  <EditableCell
                    type="number"
                    value={r.length ?? ''}
                    onCommit={(v) =>
                      updateEdgeData(r.id, { length: v === '' ? null : Math.max(0, Number(v)) })
                    }
                  />
                </td>
                <td className="px-3 py-1">
                  <EditableCell value={r.notes} multiline onCommit={(v) => updateEdgeData(r.id, { notes: v })} />
                </td>
                <td className="px-3 py-1.5 text-neutral-400 break-words">{r.layer}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-neutral-500">
                  No wires.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
