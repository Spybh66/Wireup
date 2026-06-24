// §8 Component config modal — opens on double-click. Edit all node properties.
import { useEffect, useMemo, useRef } from 'react';
import { X, Plus, Trash2, Lock, Unlock } from 'lucide-react';
import useDiagramStore from '../../store/diagramStore';
import { getDefinition } from '../../data/componentLibrary';
import {
  PORT_TYPES,
  GAUGE_OPTIONS,
  FITTING_OPTIONS,
  typeHasGaugeFitting,
  typeGroup,
  slotRatings,
} from '../../data/wireTypes';

// All fitting options plus a blank for "no installed connector".
const ALL_FITTINGS = FITTING_OPTIONS;

const SIDES = ['top', 'right', 'bottom', 'left'];
// Only power-distribution devices expose per-output breaker/fuse selection.
const BREAKER_DEFS = new Set(['pdh', 'pdp2', 'pdp_legacy', 'mpm']);
const uuid = () => crypto.randomUUID();

// Reassign per-side order based on array order (keeps handles evenly spaced).
function normalizeOrders(ports) {
  const counters = {};
  return ports.map((p) => ({
    ...p,
    order: (counters[p.side] = (counters[p.side] ?? -1) + 1),
  }));
}

export default function ComponentConfigModal({ nodeId, onClose, onSelectEdge }) {
  const node = useDiagramStore((s) => s.nodes.find((n) => n.id === nodeId));
  const edges = useDiagramStore((s) => s.edges);
  const nodes = useDiagramStore((s) => s.nodes);
  const customDefinitions = useDiagramStore((s) => s.customDefinitions);
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const removePort = useDiagramStore((s) => s.removePort);
  const removeNode = useDiagramStore((s) => s.removeNode);
  const addToast = useDiagramStore((s) => s.addToast);
  const requestConfirm = useDiagramStore((s) => s.requestConfirm);
  const firstRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const def = node ? getDefinition(node.data.definitionId, customDefinitions) : null;

  const connected = useMemo(() => {
    if (!node) return [];
    return edges
      .filter((e) => e.source === nodeId || e.target === nodeId)
      .map((e) => {
        const otherId = e.source === nodeId ? e.target : e.source;
        const other = nodes.find((n) => n.id === otherId);
        return { id: e.id, label: e.data.label, other: other?.data.label ?? '?' };
      });
  }, [edges, nodes, nodeId, node]);

  if (!node || !def) return null;
  const { data } = node;
  const tracks = (f) => def.trackedFields.includes(f);

  const setPorts = (ports) => updateNodeData(nodeId, { ports: normalizeOrders(ports) });

  const updatePort = (portId, patch) =>
    setPorts(data.ports.map((p) => (p.id === portId ? { ...p, ...patch } : p)));

  const addPort = () =>
    setPorts([
      ...data.ports,
      { id: uuid(), type: 'DATA', label: 'Data', side: 'top', order: 0, gauge: null, fitting: null },
    ]);

  // Removing a port cascades its wires — confirm first if any are attached so
  // the user doesn't silently orphan connections.
  const onRemovePort = async (p) => {
    const attached = edges.filter(
      (e) =>
        (e.source === nodeId && e.sourceHandle === p.id) ||
        (e.target === nodeId && e.targetHandle === p.id)
    );
    if (attached.length) {
      const ok = await requestConfirm(
        `Remove port "${p.label}" and ${attached.length} attached wire${attached.length === 1 ? '' : 's'}?`
      );
      if (!ok) return;
    }
    removePort(nodeId, p.id);
  };

  const onDelete = async () => {
    if (data.locked) {
      addToast('Component is locked');
      return;
    }
    const n = connected.length;
    const ok = await requestConfirm(`Delete ${data.label} and ${n} attached wire${n === 1 ? '' : 's'}?`);
    if (ok) {
      removeNode(nodeId);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${data.label}`}
        className="flex max-h-[88vh] w-[46rem] max-w-[94vw] flex-col rounded-lg border border-edge bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-2 border-b border-edge p-4">
          <input
            ref={firstRef}
            value={data.label}
            onChange={(e) => updateNodeData(nodeId, { label: e.target.value })}
            aria-label="Component name"
            className="flex-1 rounded border border-edge bg-surface-0 px-2 py-1.5 font-heading text-base text-silver outline-none focus:border-silver"
          />
          <label className="flex items-center gap-1 text-xs text-neutral-400" title="Border color">
            <input
              type="color"
              value={data.color ?? '#d4d4d8'}
              onChange={(e) => updateNodeData(nodeId, { color: e.target.value })}
              aria-label="Border color"
              className="h-8 w-10 cursor-pointer rounded border border-edge bg-surface-0"
            />
          </label>
          {data.color && (
            <button
              onClick={() => updateNodeData(nodeId, { color: null })}
              className="text-xs text-neutral-400 hover:text-silver"
            >
              reset
            </button>
          )}
          <button
            onClick={() => updateNodeData(nodeId, { locked: !data.locked })}
            aria-label={data.locked ? 'Unlock component' : 'Lock component'}
            className={`rounded border border-edge px-2 py-1.5 ${data.locked ? 'bg-surface-2 text-amber-400' : 'bg-surface-0 text-neutral-300'}`}
          >
            {data.locked ? <Lock size={16} /> : <Unlock size={16} />}
          </button>
          <button onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-silver">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {/* general */}
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">General</h3>
            <textarea
              value={data.notes}
              onChange={(e) => updateNodeData(nodeId, { notes: e.target.value })}
              placeholder="Notes"
              aria-label="Notes"
              rows={2}
              className="w-full rounded border border-edge bg-surface-0 px-2 py-1.5 text-sm text-silver outline-none focus:border-silver"
            />
          </section>

          {/* tracked fields */}
          {(tracks('canId') || tracks('ipAddress')) && (
            <section className="grid grid-cols-2 gap-3">
              {tracks('canId') && (
                <label className="block text-sm">
                  <span className="mb-1 block text-neutral-400">CAN ID (0–63)</span>
                  <input
                    type="number"
                    min={0}
                    max={63}
                    value={data.canId ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? null : Math.max(0, Math.min(63, Number(e.target.value)));
                      updateNodeData(nodeId, { canId: v });
                    }}
                    className="w-full rounded border border-edge bg-surface-0 px-2 py-1.5 text-silver outline-none focus:border-silver"
                  />
                </label>
              )}
              {tracks('ipAddress') && (
                <label className="block text-sm">
                  <span className="mb-1 block text-neutral-400">IP Address</span>
                  <input
                    value={data.ipAddress ?? ''}
                    onChange={(e) => updateNodeData(nodeId, { ipAddress: e.target.value || null })}
                    placeholder="10.TE.AM.2"
                    className="w-full rounded border border-edge bg-surface-0 px-2 py-1.5 text-silver outline-none focus:border-silver"
                  />
                </label>
              )}
            </section>
          )}

          {/* branch breaker / fuse grid — power-distribution outputs only
              (PDH/PDP/MPM). Excludes the main PWR input. Each channel offers the
              rating set for its slot: full-size ATO breakers (10–40 A) or
              miniature ATM blade fuses (≤15 A, PDH ch20–23 + every MPM channel). */}
          {(() => {
            if (!BREAKER_DEFS.has(def.id)) return null;
            const channels = data.ports.filter(
              (p) => p.type === 'PWR' && p.label !== 'PWR' && p.label !== 'PWR IN'
            );
            if (!channels.length) return null;
            const hasFuse = channels.some((p) => p.slot === 'fuse');
            const hasBreaker = channels.some((p) => (p.slot ?? 'breaker') !== 'fuse');
            const heading =
              hasFuse && hasBreaker ? 'Output breakers / fuses' : hasFuse ? 'Output fuses' : 'Output breakers';
            return (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  {heading}
                </h3>
                <div className="grid grid-cols-4 gap-1.5">
                  {channels.map((p) => {
                    const isFuse = p.slot === 'fuse';
                    return (
                      <label key={p.id} className="flex items-center gap-1 text-xs text-neutral-300">
                        <span
                          className={`w-9 shrink-0 text-right ${isFuse ? 'text-cyan-400' : 'text-neutral-400'}`}
                          title={isFuse ? 'Miniature blade fuse (≤15 A)' : 'Full-size ATO breaker'}
                        >
                          {p.label}
                        </span>
                        <select
                          value={p.breaker ?? ''}
                          onChange={(e) =>
                            updatePort(p.id, { breaker: e.target.value === '' ? null : Number(e.target.value) })
                          }
                          aria-label={`${p.label} ${isFuse ? 'fuse' : 'breaker'}`}
                          className="min-w-0 flex-1 rounded border border-edge bg-surface-0 px-1 py-0.5 text-silver"
                        >
                          <option value="">—</option>
                          {slotRatings(p.slot).map((a) => (
                            <option key={a} value={a}>{a}A</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {/* ports */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Ports</h3>
              <button
                onClick={addPort}
                className="flex items-center gap-1 rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-silver hover:bg-surface-0"
              >
                <Plus size={14} /> Add port
              </button>
            </div>
            <div className="space-y-2">
              {data.ports.map((p) => {
                const showGF = typeHasGaugeFitting(p.type);
                return (
                  <div key={p.id} className="flex items-center gap-2">
                    <select
                      value={p.type}
                      onChange={(e) => updatePort(p.id, { type: e.target.value })}
                      aria-label="Port type"
                      className="w-20 shrink-0 rounded border border-edge bg-surface-0 px-1 py-1 text-sm text-silver"
                    >
                      {PORT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <input
                      value={p.label}
                      onChange={(e) => updatePort(p.id, { label: e.target.value })}
                      aria-label="Port label"
                      className="min-w-0 flex-1 rounded border border-edge bg-surface-0 px-2 py-1 text-sm text-silver"
                    />
                    <select
                      value={p.side}
                      onChange={(e) => updatePort(p.id, { side: e.target.value })}
                      aria-label="Port side"
                      className="w-20 shrink-0 rounded border border-edge bg-surface-0 px-1 py-1 text-sm text-silver"
                    >
                      {SIDES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    {showGF && (
                      <>
                        <select
                          value={p.gauge ?? ''}
                          onChange={(e) => updatePort(p.id, { gauge: e.target.value || null })}
                          aria-label="Port gauge"
                          className="w-24 shrink-0 rounded border border-edge bg-surface-0 px-1 py-1 text-sm text-silver"
                        >
                          <option value="">gauge…</option>
                          {GAUGE_OPTIONS.map((g) => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                        <select
                          value={p.fitting ?? ''}
                          onChange={(e) => updatePort(p.id, { fitting: e.target.value || null })}
                          aria-label="Port fitting"
                          className="w-28 shrink-0 rounded border border-edge bg-surface-0 px-1 py-1 text-sm text-silver"
                        >
                          <option value="">fitting…</option>
                          {FITTING_OPTIONS.map((f) => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      </>
                    )}
                    <select
                      value={p.installedConnector ?? ''}
                      onChange={(e) => updatePort(p.id, { installedConnector: e.target.value || null })}
                      aria-label="Installed connector"
                      title="Connector/pigtail physically added to this port (soldered, crimped, etc.) — appears in BOM and overrides DRC fitting checks"
                      className={`w-28 shrink-0 rounded border px-1 py-1 text-sm ${p.installedConnector ? 'border-amber-600 bg-amber-950/40 text-amber-300' : 'border-edge bg-surface-0 text-neutral-500'}`}
                    >
                      <option value="">+ adapter…</option>
                      {ALL_FITTINGS.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => onRemovePort(p)}
                      aria-label="Remove port"
                      className="shrink-0 rounded p-1 text-neutral-400 hover:text-red-400"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* connected wires */}
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Connected wires ({connected.length})
            </h3>
            {connected.length === 0 ? (
              <p className="text-sm text-neutral-500">None.</p>
            ) : (
              <ul className="space-y-1">
                {connected.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        onSelectEdge(c.id);
                        onClose();
                      }}
                      className="w-full truncate rounded px-2 py-1 text-left text-sm text-silver hover:bg-surface-2"
                    >
                      <span className="font-heading">{c.label}</span>{' '}
                      <span className="text-neutral-400">→ {c.other}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-edge p-4">
          <button
            onClick={onDelete}
            className="rounded border border-red-900 bg-red-950/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/40"
          >
            Delete Component
          </button>
          <button
            onClick={onClose}
            className="rounded bg-silver px-3 py-1.5 text-sm font-semibold text-surface-0 hover:bg-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
