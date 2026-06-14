import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/header/Header';
import SettingsPanel from './components/header/SettingsPanel';
import ComponentSidebar from './components/sidebar/ComponentSidebar';
import DiagramCanvas from './components/canvas/DiagramCanvas';
import LayerPanel from './components/canvas/LayerPanel';
import WireConfigPanel from './components/canvas/WireConfigPanel';
import MultiSelectPanel from './components/canvas/MultiSelectPanel';
import DrcPanel from './components/canvas/DrcPanel';
import Onboarding from './components/onboarding/Onboarding';
import ComponentConfigModal from './components/modal/ComponentConfigModal';
import Toaster from './components/shared/Toast';
import ConfirmDialog from './components/shared/ConfirmDialog';
import RestoreBanner from './components/shared/RestoreBanner';
import MobileBanner from './components/shared/MobileBanner';
import useDiagramStore, { cloneCluster } from './store/diagramStore';
import { readAutosave, decodeProjectFromHash } from './utils/saveLoadUtils';

const SheetView = lazy(() => import('./components/sheet/SheetView'));
const AboutView = lazy(() => import('./components/about/AboutView'));

const deepCopy = (o) => JSON.parse(JSON.stringify(o));

function isTypingTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export default function App() {
  const activeTab = useDiagramStore((s) => s.activeTab);
  const selection = useDiagramStore((s) => s.selection);
  const setSelection = useDiagramStore((s) => s.setSelection);
  const setActiveTab = useDiagramStore((s) => s.setActiveTab);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configNodeId, setConfigNodeId] = useState(null);
  const [drcOpen, setDrcOpen] = useState(false);

  const clipboard = useRef(null);
  const pasteCount = useRef(0);

  // ---- load a shared project from the URL hash, else restore-from-autosave ----
  useEffect(() => {
    const m = window.location.hash.match(/[#&]p=([^&]+)/);
    if (m) {
      decodeProjectFromHash(m[1])
        .then((project) => {
          if (useDiagramStore.getState().loadProject(project))
            useDiagramStore.getState().addToast('Loaded shared project');
          else useDiagramStore.getState().addToast('Shared link is invalid');
        })
        .catch(() => useDiagramStore.getState().addToast('Shared link is invalid'));
      return;
    }
    const data = readAutosave();
    if (data) useDiagramStore.getState().setRestoreData(data);
  }, []);

  // Collapse the component sidebar on small screens so the canvas is usable.
  useEffect(() => {
    if (window.innerWidth < 768) useDiagramStore.setState({ sidebarOpen: false });
  }, []);

  // ---- global keyboard ----
  const doCopy = useCallback(() => {
    const { nodes, edges, selection: sel } = useDiagramStore.getState();
    const selNodes = nodes.filter((n) => sel.nodes.includes(n.id));
    if (!selNodes.length) return;
    const idSet = new Set(sel.nodes);
    const selEdges = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
    clipboard.current = { nodes: deepCopy(selNodes), edges: deepCopy(selEdges) };
    pasteCount.current = 0;
  }, []);

  const doPaste = useCallback(() => {
    const clip = clipboard.current;
    if (!clip || !clip.nodes.length) return;
    pasteCount.current += 1;
    const off = 24 * pasteCount.current;
    // Fresh node + port ids so the paste is isolated from the original.
    const { newNodes, newEdges } = cloneCluster(clip.nodes, clip.edges, (p) => ({
      x: p.x + off,
      y: p.y + off,
    }));
    useDiagramStore.getState().pasteGraph(newNodes, newEdges);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      // Escape: close modal/panel first, otherwise clear selection
      if (e.key === 'Escape') {
        if (settingsOpen) return setSettingsOpen(false);
        if (configNodeId) return setConfigNodeId(null);
        if (useDiagramStore.getState().confirmState) return; // handled by dialog
        const sel = useDiagramStore.getState().selection;
        if (sel.nodes.length || sel.edges.length) setSelection({ nodes: [], edges: [] });
        return;
      }
      if (isTypingTarget(e.target)) return;

      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) useDiagramStore.getState().redo();
        else useDiagramStore.getState().undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        useDiagramStore.getState().redo();
        return;
      }
      if (mod && (e.key === 'c' || e.key === 'C')) {
        doCopy();
        return;
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        doPaste();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeTab === 'diagram') {
          e.preventDefault();
          useDiagramStore.getState().deleteSelection();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, configNodeId, activeTab, setSelection, doCopy, doPaste]);

  const onOpenNodeConfig = useCallback((nodeId) => setConfigNodeId(nodeId), []);
  const onSelectEdgeFromModal = useCallback(
    (edgeId) => {
      setActiveTab('diagram');
      setSelection({ nodes: [], edges: [edgeId] });
    },
    [setActiveTab, setSelection]
  );

  const multiCount = selection.nodes.length + selection.edges.length;
  const selectedEdgeId =
    activeTab === 'diagram' && selection.edges.length === 1 && selection.nodes.length === 0
      ? selection.edges[0]
      : null;

  return (
    <div className="flex h-full flex-col bg-surface-0 text-silver">
      <MobileBanner />
      <Header
        onOpenSettings={() => setSettingsOpen(true)}
        drcOpen={drcOpen}
        onToggleDrc={() => setDrcOpen((o) => !o)}
      />

      <div className="relative flex flex-1 overflow-hidden">
        {activeTab === 'diagram' && <ComponentSidebar />}

        <main className="relative flex-1 overflow-hidden">
          {/* Canvas stays mounted across tabs so React Flow never remounts
              (a remount caused a GPU black-flash). Sheet/About overlay it. */}
          <DiagramCanvas onOpenNodeConfig={onOpenNodeConfig} />
          {activeTab === 'diagram' && (
            <>
              <Onboarding />
              <LayerPanel />
              {drcOpen && <DrcPanel onClose={() => setDrcOpen(false)} />}
              {selectedEdgeId && (
                <WireConfigPanel
                  edgeId={selectedEdgeId}
                  onClose={() => setSelection({ nodes: [], edges: [] })}
                />
              )}
              {multiCount > 1 && (
                <MultiSelectPanel onClose={() => setSelection({ nodes: [], edges: [] })} />
              )}
            </>
          )}
          {activeTab !== 'diagram' && (
            <div className="absolute inset-0 z-20 bg-surface-0">
              <Suspense
                fallback={<div className="flex h-full items-center justify-center text-neutral-500">Loading…</div>}
              >
                {activeTab === 'sheet' ? <SheetView /> : <AboutView />}
              </Suspense>
            </div>
          )}
        </main>
      </div>

      {configNodeId && (
        <ComponentConfigModal
          nodeId={configNodeId}
          onClose={() => setConfigNodeId(null)}
          onSelectEdge={onSelectEdgeFromModal}
        />
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      <RestoreBanner />
      <ConfirmDialog />
      <Toaster />
    </div>
  );
}
