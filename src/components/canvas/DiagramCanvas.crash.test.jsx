// Reproduction for the multi-select crash (React #185) when a component AND its
// wire are selected together. Drives selection through React Flow's own store
// actions (addSelectedNodes / addSelectedEdges) — the same path a rubber-band
// uses — so the controlled-selection feedback loop is exercised for real.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect } from 'react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { Flow } from './DiagramCanvas';
import useDiagramStore from '../../store/diagramStore';

// jsdom lacks ResizeObserver / matchMedia / DOMMatrix / DOMRect that React Flow
// touches during measurement. Provide just enough for it to run.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!window.matchMedia)
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  class DOMMatrixReadOnly {
    constructor() {
      this.m22 = 1;
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
    }
  }
  global.DOMMatrixReadOnly = DOMMatrixReadOnly;
  window.DOMMatrixReadOnly = DOMMatrixReadOnly;
  if (!Element.prototype.getBoundingClientRect.__patched) {
    Element.prototype.getBoundingClientRect = function () {
      return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 50, width: 100, height: 50, toJSON() {} };
    };
    Element.prototype.getBoundingClientRect.__patched = true;
  }
});

let storeApi = null;
function GrabStore() {
  const s = useStoreApi();
  useEffect(() => {
    storeApi = s;
  }, [s]);
  return null;
}

function reset() {
  useDiagramStore.getState().newProject();
  useDiagramStore.temporal.getState().clear();
  storeApi = null;
}

describe('DiagramCanvas multi-select crash', () => {
  beforeEach(() => reset());

  it('does not loop when a component and its wire are selected together', async () => {
    // Build a component with a wire attached: PDH → Kraken (PWR).
    const s = useDiagramStore.getState();
    const pdh = s.addNode('pdh', { x: 0, y: 0 });
    const kraken = s.addNode('krakenx60', { x: 300, y: 0 });
    let st = useDiagramStore.getState();
    const ch = st.nodes.find((n) => n.id === pdh).data.ports.find((p) => p.label === 'CH0');
    const kpwr = st.nodes.find((n) => n.id === kraken).data.ports.find((p) => p.type === 'PWR');
    st.addEdge({ source: pdh, target: kraken, sourceHandle: ch.id, targetHandle: kpwr.id });
    const edgeId = useDiagramStore.getState().edges[0].id;

    await act(async () => {
      render(
        <ReactFlowProvider>
          <Flow onOpenNodeConfig={() => {}} />
          <GrabStore />
        </ReactFlowProvider>
      );
    });
    expect(storeApi).toBeTruthy();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Mimic a rubber-band that catches the Kraken node AND its wire: multi-select
    // is active so both are added to the selection together (not replaced).
    await act(async () => {
      storeApi.setState({ multiSelectionActive: true });
      storeApi.getState().addSelectedNodes([kraken]);
      storeApi.getState().addSelectedEdges([edgeId]);
      await new Promise((r) => setTimeout(r, 50));
    });

    // If the controlled-selection feedback looped, React would have thrown
    // "Maximum update depth exceeded" inside act() above and failed the test.
    // Assert the selection settled correctly in our store.
    const sel = useDiagramStore.getState().selection;
    expect(sel.nodes).toContain(kraken);
    expect(sel.edges).toContain(edgeId);
  });
});
