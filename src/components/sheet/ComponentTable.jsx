// §10 Table 1 — Components (sortable, inline-editable for CAN ID / IP / notes).
import { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';
import { buildComponentRows } from '../../utils/sheetData';

const COLUMNS = [
  { key: 'name', label: 'Name', width: '18%' },
  { key: 'type', label: 'Type', width: '13%' },
  { key: 'category', label: 'Category', width: '13%' },
  { key: 'canId', label: 'CAN ID', width: '13%' },
  { key: 'ipAddress', label: 'IP Address', width: '15%' },
  { key: 'notes', label: 'Notes', width: '28%' },
];

// Inline editable cell for a single field. `multiline` uses a wrapping textarea.
function EditableCell({ value, nodeId, field, placeholder, multiline = false }) {
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const commit = () => {
    const trimmed = draft.trim();
    updateNodeData(nodeId, { [field]: trimmed === '' ? null : trimmed });
    setEditing(false);
  };

  if (editing) {
    const common = {
      autoFocus: true,
      value: draft,
      onChange: (e) => setDraft(e.target.value),
      onBlur: commit,
      placeholder,
      className:
        'block w-full min-w-0 box-border rounded border border-edge bg-surface-0 px-1 py-0.5 text-sm text-silver outline-none focus:border-silver',
    };
    if (multiline) {
      return (
        <textarea
          {...common}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
          }}
          className={`${common.className} resize-none whitespace-pre-wrap break-words`}
        />
      );
    }
    return (
      <input
        {...common}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
        }}
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(value ?? ''); setEditing(true); }}
      title="Click to edit"
      className="block w-full cursor-text whitespace-pre-wrap break-words rounded px-1 py-0.5 hover:bg-surface-2"
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
            <tr key={r.id} className="border-t border-edge align-top text-silver">
              <td className="px-3 py-1.5 font-heading break-words">{r.name}</td>
              <td className="px-3 py-1.5 break-words">{r.type}</td>
              <td className="px-3 py-1.5 text-neutral-400 break-words">{r.category}</td>
              <td className="px-3 py-1.5">
                <EditableCell value={r.canId} nodeId={r.id} field="canId" placeholder="—" />
              </td>
              <td className="px-3 py-1.5">
                <EditableCell value={r.ipAddress} nodeId={r.id} field="ipAddress" placeholder="—" />
              </td>
              <td className="px-3 py-1.5 text-neutral-400">
                <EditableCell value={r.notes || null} nodeId={r.id} field="notes" placeholder="Add note…" multiline />
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
