// §10 Table 2 — Wires (sortable, filterable, inline-editable) + §4.2 template editor.
import { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';
import { buildWireRows } from '../../utils/sheetData';

const COLUMNS = [
  { key: 'label', label: 'Wire Label' },
  { key: 'group', label: 'Type' },
  { key: 'from', label: 'From' },
  { key: 'to', label: 'To' },
  { key: 'gauge', label: 'Gauge' },
  { key: 'fitting', label: 'Fitting' },
  { key: 'color', label: 'Color' },
  { key: 'length', label: 'Length (in)' },
  { key: 'notes', label: 'Notes' },
  { key: 'layer', label: 'Layer' },
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

function EditableCell({ value, onCommit, type = 'text' }) {
  const [draft, setDraft] = useState(value ?? '');
  const commit = () => onCommit(draft);
  return (
    <input
      type={type}
      min={type === 'number' ? 0 : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-silver hover:border-edge focus:border-silver focus:bg-surface-0 focus:outline-none"
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
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-neutral-300">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">
                  <button onClick={() => toggleSort(c.key)} className="flex items-center gap-1 hover:text-silver">
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
              <tr key={r.id} className="border-t border-edge text-silver">
                <td className="whitespace-nowrap px-3 py-1.5 font-heading">{r.label}</td>
                <td className="px-3 py-1.5">{r.group}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.from}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.to}</td>
                <td className="px-3 py-1.5">{r.gauge}</td>
                <td className="px-3 py-1.5">{r.fitting}</td>
                <td className="px-3 py-1.5">
                  <span className="inline-block h-4 w-4 rounded border border-edge align-middle" style={{ background: r.color }} />
                </td>
                <td className="px-3 py-1 w-24">
                  <EditableCell
                    type="number"
                    value={r.length ?? ''}
                    onCommit={(v) =>
                      updateEdgeData(r.id, { length: v === '' ? null : Math.max(0, Number(v)) })
                    }
                  />
                </td>
                <td className="px-3 py-1 min-w-[10rem]">
                  <EditableCell value={r.notes} onCommit={(v) => updateEdgeData(r.id, { notes: v })} />
                </td>
                <td className="px-3 py-1.5 text-neutral-400">{r.layer}</td>
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
