import { createContext, useContext } from 'react';

// Worst DRC severity per element, for canvas badges.
// { nodes: Map<nodeId, severity>, edges: Map<edgeId, severity> }
export const DrcContext = createContext({ nodes: new Map(), edges: new Map() });
export const useDrcMarks = () => useContext(DrcContext);
