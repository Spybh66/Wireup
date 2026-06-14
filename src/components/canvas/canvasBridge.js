// Bridge so chrome outside the ReactFlowProvider (Header export, DRC panel,
// panel close buttons) can drive the canvas — fit/zoom to nodes, and drive
// selection (which React Flow owns) imperatively.
export const canvasBridge = {
  fitView: null,
  focusElements: null,
  clearSelection: null,
  selectElements: null,
};
