// §8 Header — wordmark, project name, tabs, undo/redo, file ops, export, settings.
import { useRef, useState, useEffect } from 'react';
import {
  Undo2,
  Redo2,
  FilePlus2,
  FolderOpen,
  Save,
  Share2,
  ChevronDown,
  Settings as SettingsIcon,
  Zap,
  Spline,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';
import { useCanUndo, useCanRedo } from '../../store/useTemporal';
import { useDrc } from '../../store/useDrc';
import {
  serializeProject,
  downloadJSON,
  sanitizeFilename,
  encodeProjectToHash,
} from '../../utils/saveLoadUtils';
import { canvasBridge } from '../canvas/canvasBridge';
import {
  exportCanvasPNG,
  exportCanvasJPEG,
  exportCanvasSVG,
  exportCanvasPDF,
  exportSheetCSV,
  exportSheetExcel,
  exportSheetPDF,
} from '../../utils/exportUtils';

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-sm font-semibold ${
        active ? 'bg-surface-2 text-silver' : 'text-neutral-400 hover:text-silver'
      }`}
    >
      {children}
    </button>
  );
}

function IconBtn({ onClick, disabled, label, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-1.5 text-neutral-300 hover:bg-surface-2 hover:text-silver disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

export default function Header({ onOpenSettings, drcOpen, onToggleDrc }) {
  const projectName = useDiagramStore((s) => s.projectName);
  const setProjectName = useDiagramStore((s) => s.setProjectName);
  const activeTab = useDiagramStore((s) => s.activeTab);
  const setActiveTab = useDiagramStore((s) => s.setActiveTab);
  const undo = useDiagramStore((s) => s.undo);
  const redo = useDiagramStore((s) => s.redo);
  const routingMode = useDiagramStore((s) => s.settings.routingMode);
  const updateSettings = useDiagramStore((s) => s.updateSettings);
  const newProject = useDiagramStore((s) => s.newProject);
  const loadProject = useDiagramStore((s) => s.loadProject);
  const markSaved = useDiagramStore((s) => s.markSaved);
  const requestConfirm = useDiagramStore((s) => s.requestConfirm);
  const addToast = useDiagramStore((s) => s.addToast);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const { counts: drcCounts } = useDrc();
  const drcIssues = drcCounts.error + drcCounts.warning;

  const fileInputRef = useRef(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const onNew = async () => {
    if (useDiagramStore.getState().dirty) {
      const ok = await requestConfirm('Unsaved changes will be lost. Start a new project?');
      if (!ok) return;
    }
    newProject();
  };

  const onSave = () => {
    const state = useDiagramStore.getState();
    downloadJSON(serializeProject(state), `${sanitizeFilename(state.projectName)}.wireup.json`);
    markSaved();
  };

  const onShare = async () => {
    try {
      const payload = await encodeProjectToHash(serializeProject(useDiagramStore.getState()));
      const url = `${window.location.origin}${window.location.pathname}#p=${payload}`;
      window.history.replaceState(null, '', `#p=${payload}`);
      await navigator.clipboard.writeText(url);
      addToast('Share link copied to clipboard');
    } catch {
      addToast('Could not create share link');
    }
  };

  const onOpenFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadProject(JSON.parse(reader.result));
      } catch {
        addToast('Invalid or corrupted project file.');
      }
    };
    reader.readAsText(file);
  };

  const runCanvasExport = async (fn) => {
    setExportOpen(false);
    const switching = useDiagramStore.getState().activeTab !== 'diagram';
    if (switching) setActiveTab('diagram');
    await new Promise((r) => setTimeout(r, switching ? 300 : 0));
    canvasBridge.fitView?.({ padding: 0.1 });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await fn(useDiagramStore.getState().projectName);
    } catch {
      addToast('Export failed.');
    }
  };

  const runSheetExport = (fn) => {
    setExportOpen(false);
    if (useDiagramStore.getState().activeTab !== 'sheet') setActiveTab('sheet');
    fn(useDiagramStore.getState(), useDiagramStore.getState().projectName);
  };

  const menuItem =
    'block w-full px-3 py-1.5 text-left text-sm text-silver hover:bg-surface-2';

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-edge bg-surface-1 px-3">
      <span className="font-heading text-xl font-semibold tracking-wide text-silver">Wireup</span>

      <input
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        aria-label="Project name"
        className="ml-2 w-48 rounded border border-transparent bg-transparent px-2 py-1 text-sm text-silver hover:border-edge focus:border-silver focus:bg-surface-0 focus:outline-none"
      />

      <div className="ml-2 flex overflow-hidden rounded border border-edge">
        <TabButton active={activeTab === 'diagram'} onClick={() => setActiveTab('diagram')}>
          Diagram
        </TabButton>
        <TabButton active={activeTab === 'sheet'} onClick={() => setActiveTab('sheet')}>
          Sheet
        </TabButton>
        <TabButton active={activeTab === 'about'} onClick={() => setActiveTab('about')}>
          About
        </TabButton>
      </div>

      {activeTab === 'diagram' && (
        <div
          className="ml-2 flex overflow-hidden rounded border border-edge"
          title="New wires: Auto routes around components; Manual draws a straight line you shape with waypoints"
        >
          <button
            onClick={() => updateSettings({ routingMode: 'auto' })}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold ${
              routingMode === 'auto' ? 'bg-surface-2 text-silver' : 'text-neutral-400 hover:text-silver'
            }`}
          >
            <Zap size={13} /> Auto
          </button>
          <button
            onClick={() => updateSettings({ routingMode: 'manual' })}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold ${
              routingMode === 'manual' ? 'bg-surface-2 text-silver' : 'text-neutral-400 hover:text-silver'
            }`}
          >
            <Spline size={13} /> Manual
          </button>
        </div>
      )}

      <div className="flex-1" />

      <IconBtn onClick={undo} disabled={!canUndo} label="Undo">
        <Undo2 size={18} />
      </IconBtn>
      <IconBtn onClick={redo} disabled={!canRedo} label="Redo">
        <Redo2 size={18} />
      </IconBtn>

      <div className="mx-1 h-6 w-px bg-edge" />

      <IconBtn onClick={onNew} label="New project">
        <FilePlus2 size={18} />
      </IconBtn>
      <IconBtn onClick={() => fileInputRef.current?.click()} label="Open project">
        <FolderOpen size={18} />
      </IconBtn>
      <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={onOpenFile} />
      <IconBtn onClick={onSave} label="Save project">
        <Save size={18} />
      </IconBtn>
      <IconBtn onClick={onShare} label="Copy share link">
        <Share2 size={18} />
      </IconBtn>

      <div className="relative" ref={exportRef}>
        <button
          onClick={() => setExportOpen((o) => !o)}
          className="flex items-center gap-1 rounded border border-edge bg-surface-2 px-2 py-1 text-sm text-silver hover:bg-surface-0"
        >
          Export <ChevronDown size={14} />
        </button>
        {exportOpen && (
          <div className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-edge bg-surface-1 py-1 shadow-xl">
            <div className="px-3 py-1 text-xs font-semibold uppercase text-neutral-500">Canvas</div>
            <button className={menuItem} onClick={() => runCanvasExport(exportCanvasPNG)}>PNG</button>
            <button className={menuItem} onClick={() => runCanvasExport(exportCanvasJPEG)}>JPEG</button>
            <button className={menuItem} onClick={() => runCanvasExport(exportCanvasSVG)}>SVG</button>
            <button className={menuItem} onClick={() => runCanvasExport(exportCanvasPDF)}>PDF</button>
            <div className="my-1 border-t border-edge" />
            <div className="px-3 py-1 text-xs font-semibold uppercase text-neutral-500">Sheet</div>
            <button className={menuItem} onClick={() => runSheetExport(exportSheetCSV)}>CSV</button>
            <button className={menuItem} onClick={() => runSheetExport(exportSheetExcel)}>Excel</button>
            <button className={menuItem} onClick={() => runSheetExport(exportSheetPDF)}>PDF</button>
          </div>
        )}
      </div>

      {activeTab === 'diagram' && (
        <button
          onClick={onToggleDrc}
          aria-label="Design checks"
          title="Design checks"
          className={`relative flex items-center gap-1 rounded px-2 py-1.5 text-sm hover:bg-surface-2 ${
            drcOpen ? 'bg-surface-2 text-silver' : 'text-neutral-300 hover:text-silver'
          }`}
        >
          {drcIssues > 0 ? (
            <ShieldAlert size={18} className={drcCounts.error > 0 ? 'text-red-400' : 'text-amber-400'} />
          ) : (
            <ShieldCheck size={18} />
          )}
          {drcIssues > 0 && <span className="text-xs font-semibold">{drcIssues}</span>}
        </button>
      )}

      <IconBtn onClick={onOpenSettings} label="Settings">
        <SettingsIcon size={18} />
      </IconBtn>
    </header>
  );
}
