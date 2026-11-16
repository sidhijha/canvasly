import { create } from 'zustand';
import type { CanvasElement, Tool, Viewport } from '../types/canvas';

type CanvasState = {
  tool: Tool; viewport: Viewport; gridVisible: boolean;
  elements: CanvasElement[]; selectedIds: string[]; past: CanvasElement[][]; future: CanvasElement[][]; transaction: CanvasElement[] | null; dirty: boolean;
  setTool: (tool: Tool) => void; setViewport: (viewport: Viewport) => void; toggleGrid: () => void;
  addElement: (element: CanvasElement) => void;
  replaceElements: (elements: CanvasElement[]) => void;
  applyRemoteElement: (element: CanvasElement, zIndex?: number) => void;
  removeRemoteElement: (id: string) => void;
  updateElement: (id: string, patch: Partial<CanvasElement>) => void;
  updateSelected: (patch: Partial<CanvasElement>) => void;
  deleteElement: (id: string) => void; deleteSelected: () => void;
  selectElement: (id: string | null, additive?: boolean) => void; selectAll: () => void;
  undo: () => void; redo: () => void; duplicateSelected: () => void;
  beginTransaction: () => void; endTransaction: () => void;
  markSaved: () => void; loadElements: (elements: CanvasElement[]) => void;
  groupSelected: () => void; ungroupSelected: () => void; moveLayer: (direction: 'front' | 'back') => void;
};
const historyLimit = 80;
const commit = (state: CanvasState, elements: CanvasElement[], selection = state.selectedIds) => ({
  elements, selectedIds: selection, past: [...state.past, state.elements].slice(-historyLimit), future: [], dirty: true,
});

export const useCanvasStore = create<CanvasState>((set) => ({
  tool: 'select', viewport: { x: 0, y: 0, zoom: 1 }, gridVisible: true, elements: [], selectedIds: [], past: [], future: [], transaction: null, dirty: false,
  setTool: (tool) => set({ tool }), setViewport: (viewport) => set({ viewport }),
  toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),
  addElement: (element) => set((state) => state.transaction ? { elements: [...state.elements, element], selectedIds: [element.id] } : commit(state, [...state.elements, element], [element.id])),
  replaceElements: (elements) => set((state) => commit(state, elements, [])),
  applyRemoteElement: (element, zIndex) => set((state) => {
    const elements = state.elements.filter((item) => item.id !== element.id);
    elements.splice(zIndex === undefined ? elements.length : Math.min(Math.max(0, zIndex), elements.length), 0, element);
    return { elements };
  }),
  removeRemoteElement: (id) => set((state) => ({ elements: state.elements.filter((item) => item.id !== id), selectedIds: state.selectedIds.filter((selected) => selected !== id) })),
  updateElement: (id, patch) => set((state) => state.transaction ? { elements: state.elements.map((element) => element.id === id ? { ...element, ...patch } : element) } : commit(state, state.elements.map((element) => element.id === id ? { ...element, ...patch } : element))),
  updateSelected: (patch) => set((state) => { const elements = state.elements.map((element) => state.selectedIds.includes(element.id) ? { ...element, ...patch } : element); return state.transaction ? { elements } : commit(state, elements); }),
  deleteElement: (id) => set((state) => { const elements = state.elements.filter((element) => element.id !== id), selectedIds = state.selectedIds.filter((selected) => selected !== id); return state.transaction ? { elements, selectedIds } : commit(state, elements, selectedIds); }),
  deleteSelected: () => set((state) => state.selectedIds.length ? commit(state, state.elements.filter((element) => !state.selectedIds.includes(element.id)), []) : {}),
  selectElement: (id, additive = false) => set((state) => {
    if (!id) return { selectedIds: [] };
    if (additive) return { selectedIds: state.selectedIds.includes(id) ? state.selectedIds.filter((selected) => selected !== id) : [...state.selectedIds, id] };
    const item = state.elements.find((element) => element.id === id);
    if (item?.groupId) return { selectedIds: state.elements.filter((element) => element.groupId === item.groupId).map((element) => element.id) };
    return { selectedIds: [id] };
  }),
  selectAll: () => set((state) => ({ selectedIds: state.elements.map((element) => element.id) })),
  undo: () => set((state) => { if (!state.past.length) return {}; const previous = state.past[state.past.length - 1]; return { elements: previous, past: state.past.slice(0, -1), future: [state.elements, ...state.future].slice(0, historyLimit), selectedIds: state.selectedIds.filter((id) => previous.some((item) => item.id === id)), dirty: true }; }),
  redo: () => set((state) => { if (!state.future.length) return {}; const next = state.future[0]; return { elements: next, past: [...state.past, state.elements].slice(-historyLimit), future: state.future.slice(1), selectedIds: state.selectedIds.filter((id) => next.some((item) => item.id === id)), dirty: true }; }),
  duplicateSelected: () => set((state) => { const copies = state.elements.filter((element) => state.selectedIds.includes(element.id)).map((element) => ({ ...element, id: crypto.randomUUID(), x: element.x + 20, y: element.y + 20, groupId: undefined })); return copies.length ? commit(state, [...state.elements, ...copies], copies.map((element) => element.id)) : {}; }),
  beginTransaction: () => set((state) => state.transaction ? {} : { transaction: state.elements }),
  endTransaction: () => set((state) => {
    if (!state.transaction) return {};
    const changed = JSON.stringify(state.transaction) !== JSON.stringify(state.elements);
    return changed ? { past: [...state.past, state.transaction].slice(-historyLimit), future: [], transaction: null, dirty: true } : { transaction: null };
  }),
  markSaved: () => set({ dirty: false }),
  loadElements: (elements) => set({ elements, selectedIds: [], past: [], future: [], dirty: false }),
  groupSelected: () => set((state) => { if (state.selectedIds.length < 2) return {}; const groupId = crypto.randomUUID(); return commit(state, state.elements.map((element) => state.selectedIds.includes(element.id) ? { ...element, groupId } : element)); }),
  ungroupSelected: () => set((state) => { const groups = new Set(state.elements.filter((element) => state.selectedIds.includes(element.id)).map((element) => element.groupId).filter(Boolean)); if (!groups.size) return {}; return commit(state, state.elements.map((element) => groups.has(element.groupId) ? { ...element, groupId: undefined } : element)); }),
  moveLayer: (direction) => set((state) => { const selected = state.elements.filter((element) => state.selectedIds.includes(element.id)); const rest = state.elements.filter((element) => !state.selectedIds.includes(element.id)); const reordered = direction === 'front' ? [...rest, ...selected] : [...selected, ...rest]; return reordered === state.elements ? {} : commit(state, reordered); }),
}));
