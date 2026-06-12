import { createContext, useContext } from 'react';

// Map<edgeId, { d, midpoint, fallback, color, type }>
export const RoutingContext = createContext(new Map());
export const useRouting = () => useContext(RoutingContext);
