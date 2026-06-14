// §10 Bill of Materials — wire length by gauge/color + connector counts.
import { useMemo } from 'react';
import useDiagramStore from '../../store/diagramStore';
import { buildBom } from '../../utils/sheetData';

export default function BomView() {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  // recompute when wiring changes
  const { wires, connectors } = useMemo(() => buildBom({ nodes, edges }), [nodes, edges]);

  if (!wires.length && !connectors.length) {
    return <p className="text-sm text-neutral-500">No wires with a length or connector set yet.</p>;
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="overflow-x-auto rounded-lg border border-edge">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-neutral-400">
            <tr>
              <th className="px-3 py-2">Gauge</th>
              <th className="px-3 py-2">Color</th>
              <th className="px-3 py-2 text-right">Length (in)</th>
              <th className="px-3 py-2 text-right">(ft)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {wires.map((w) => (
              <tr key={`${w.gauge}-${w.hex}`} className="text-neutral-300">
                <td className="px-3 py-2 text-silver">{w.gauge}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-full border border-edge" style={{ background: w.hex }} />
                    {w.color}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-silver">{w.lengthIn}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{w.lengthFt}</td>
              </tr>
            ))}
            {wires.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-3 text-neutral-500">No gauged wire lengths set.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-lg border border-edge">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-neutral-400">
            <tr>
              <th className="px-3 py-2">Connector</th>
              <th className="px-3 py-2 text-right">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {connectors.map((c) => (
              <tr key={c.name} className="text-neutral-300">
                <td className="px-3 py-2 text-silver">{c.name}</td>
                <td className="px-3 py-2 text-right tabular-nums text-silver">{c.qty}</td>
              </tr>
            ))}
            {connectors.length === 0 && (
              <tr><td colSpan={2} className="px-3 py-3 text-neutral-500">No connectors set.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
