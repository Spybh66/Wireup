// §6 Component sidebar — searchable accordion library, draggable items.
import { useMemo, useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Plus, Search, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { COMPONENT_LIBRARY, CATEGORY_ORDER } from '../../data/componentLibrary';
import { getIcon } from '../../assets/icons';
import useDiagramStore from '../../store/diagramStore';
import CreateComponentModal from './CreateComponentModal';

function DraggableItem({ def }) {
  const Icon = getIcon(def.icon);
  const onDragStart = (e) => {
    e.dataTransfer.setData('application/wireup-definition', def.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-sm text-silver hover:bg-surface-2 active:cursor-grabbing"
      title={`Drag ${def.name} onto the canvas`}
    >
      <Icon size={24} />
      <span className="truncate">{def.name}</span>
    </div>
  );
}

export default function ComponentSidebar() {
  const sidebarOpen = useDiagramStore((s) => s.sidebarOpen);
  const toggleSidebar = useDiagramStore((s) => s.toggleSidebar);
  const customDefinitions = useDiagramStore((s) => s.customDefinitions);

  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const [createOpen, setCreateOpen] = useState(false);

  // debounce search 150ms (§13.5)
  useEffect(() => {
    const t = setTimeout(() => setSearch(rawSearch), 150);
    return () => clearTimeout(t);
  }, [rawSearch]);

  const grouped = useMemo(() => {
    const all = [...COMPONENT_LIBRARY, ...customDefinitions];
    const q = search.trim().toLowerCase();
    const map = {};
    for (const def of all) {
      if (q && !def.name.toLowerCase().includes(q)) continue;
      const cat = def.category || 'Custom';
      (map[cat] ||= []).push(def);
    }
    return map;
  }, [search, customDefinitions]);

  const categories = useMemo(() => {
    const known = CATEGORY_ORDER.filter((c) => grouped[c]?.length);
    const extra = Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c));
    return [...known, ...extra];
  }, [grouped]);

  if (!sidebarOpen) {
    return (
      <button
        onClick={toggleSidebar}
        aria-label="Open component library"
        className="flex h-full w-9 items-center justify-center border-r border-edge bg-surface-1 text-silver hover:bg-surface-2"
      >
        <PanelLeftOpen size={18} />
      </button>
    );
  }

  return (
    <aside className="flex h-full w-[260px] flex-col border-r border-edge bg-surface-1 transition-all duration-200">
      <div className="flex items-center gap-2 border-b border-edge p-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder="Search components"
            aria-label="Search components"
            className="w-full rounded border border-edge bg-surface-0 py-1.5 pl-7 pr-2 text-sm text-silver outline-none focus:border-silver"
          />
        </div>
        <button
          onClick={toggleSidebar}
          aria-label="Collapse component library"
          className="rounded p-1 text-neutral-400 hover:bg-surface-2 hover:text-silver"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {categories.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-neutral-500">No matches.</p>
        )}
        {categories.map((cat) => {
          const isCollapsed = collapsed[cat];
          return (
            <div key={cat} className="mb-1">
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
                className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-silver"
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                {cat}
                <span className="ml-auto text-neutral-600">{grouped[cat].length}</span>
              </button>
              {!isCollapsed && (
                <div className="ml-1">
                  {grouped[cat].map((def) => (
                    <DraggableItem key={def.id} def={def} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-edge p-2">
        <button
          onClick={() => setCreateOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-edge bg-surface-2 py-2 text-sm text-silver hover:bg-surface-0"
        >
          <Plus size={16} /> New Custom Component
        </button>
      </div>

      {createOpen && <CreateComponentModal onClose={() => setCreateOpen(false)} />}
    </aside>
  );
}
