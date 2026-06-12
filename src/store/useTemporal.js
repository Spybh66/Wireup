// Reactive access to zundo's temporal store (past/future stacks).
import { useStore } from 'zustand';
import useDiagramStore from './diagramStore';

export function useTemporal(selector) {
  return useStore(useDiagramStore.temporal, selector);
}

export function useCanUndo() {
  return useTemporal((s) => s.pastStates.length > 0);
}

export function useCanRedo() {
  return useTemporal((s) => s.futureStates.length > 0);
}
