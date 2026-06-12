// §10 Table 1 — Components (sortable, inline-editable for CAN ID / IP / notes).
import { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';
import { buildComponentRows } from '../../utils/sheetData';

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'category', label: 'Category' },
  { key: 'canId', label: 'CAN ID' },
  { key: 'ipAddress', label: 'IP Address' },
  { key: 'notes', label: 'Notes' },
];

// Inline editable cell for a single field
function EditableCell({ value, nodeId, field, placeholder }) {
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const commit = () => {
    const trimmed = draft.trim();
    updateNodeData(nodeId, { [field]: trimmed === '' ? null : trimmed });
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
        }}
        placeholder={placeholder}
        className="w-full rounded border border-edge bg-surface-0 px-1 py-0.5 text-sm text-silver outline-none focus:border-silver"
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(value ?? ''); setEditing(true); }}
      title="Click to edit"
      className="block w-full cursor-text rounded px-1 py-0.5 hover:bg-surface-2"
    >
      {value ?? <span className="text-neutral-600">{placeholder}</span>}
    </span>
  );
}

export default function ComponentTable() {
  const nodes = useDiagramStore((s) => s.nodes);
  const customDefinitions = useDiagramStore((s) => s.customDefinitions);
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });

  const rows = useMemo(
    () => buildComponentRows({ nodes, customDefinitions }),
    [nodes, customDefinitions]
  );

  const sorted = useMemo(() => {
    const r = [...rows];
    r.sort((a, b) => {
      const av = a[sort.key] ?? '';
      const bv = b[sort.key] ?? '';
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return r;
  }, [rows, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <div className="overflow-x-auto rounded-lg border border-edge">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-neutral-300">
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} className="px-3 py-2 font-semibold">
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
          {sorted.map((r) => (
            <tr key={r.id} className="border-t border-edge text-silver">
              <td className="px-3 py-1.5 font-heading">{r.name}</td>
              <td className="px-3 py-1.5">{r.type}</td>
              <td className="px-3 py-1.5 text-neutral-400">{r.category}</td>
              <td className="px-3 py-1.5">
                <EditableCell value={r.canId} nodeId={r.id} field="canId" placeholder="—" />
              </td>
              <td className="px-3 py-1.5">
                <EditableCell value={r.ipAddress} nodeId={r.id} field="ipAddress" placeholder="—" />
              </td>
              <td className="px-3 py-1.5 text-neutral-400">
                <EditableCell value={r.notes || null} nodeId={r.id} field="notes" placeholder="Add note…" />
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-neutral-500">
                No components yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
