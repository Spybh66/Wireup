// React hook: run the DRC engine over current store state, memoized on the
// structural inputs (nodes, edges, custom defs, disabled-rule list).
import { useMemo } from 'react';
import useDiagramStore from './diagramStore';
import { runDrc } from '../utils/drc/engine';

export function useDrc() {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const customDefinitions = useDiagramStore((s) => s.customDefinitions);
  const disabledRules = useDiagramStore((s) => s.settings.drc?.disabledRules);

  return useMemo(
    () => runDrc({ nodes, edges, customDefinitions }, disabledRules ?? []),
    [nodes, edges, customDefinitions, disabledRules]
  );
}
