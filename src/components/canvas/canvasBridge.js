// Bridge so chrome outside the ReactFlowProvider (Header export, DRC panel) can
// drive the canvas — call fitView, or pan/zoom to a set of nodes.
export const canvasBridge = { fitView: null, focusElements: null };
