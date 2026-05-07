import { create } from 'zustand';
import { NPCS } from '@/data/npcs';

export interface PlayerPosition {
  x: number;
  y: number;
}

/**
 * Phase 2.1 NPC store slice.
 *
 * Intentionally minimal — only id/name/locationId/position. Emotion, context,
 * and relationship fields from FR-001 / NPCState in DESIGN.md will be added
 * in later phases (2.2 AI, 3.3 emotion). Keeping the surface tight avoids
 * shipping unused state that future code would have to migrate.
 */
export interface NPCStoreEntry {
  id: string;
  name: string;
  locationId: string | null;
  position: { x: number; y: number };
}

/** Single chat turn, mirrors backend NPCHistoryEntry shape (FR-003). */
export interface DialogHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
}

/**
 * Dialog UI state slice (Phase 2.3 — FR-003).
 *
 * Lives in the global store so the React `<DialogBox />` overlay and the
 * imperative `DialogSystem` (called from PixiJS event handlers) share a
 * single source of truth without prop-drilling. Only primitive/array fields
 * are exposed so per-field selectors avoid re-render churn.
 */
export interface DialogSlice {
  open: boolean;
  npcId: string | null;
  history: DialogHistoryEntry[];
  isWaiting: boolean;
  error: string | null;
}

interface GameStoreState {
  phase: string;
  currentLocationId: string | null;
  setCurrentLocation: (id: string | null) => void;
  playerPosition: PlayerPosition;
  setPlayerPosition: (pos: PlayerPosition) => void;
  npcs: Record<string, NPCStoreEntry>;

  /** Phase 2.3 dialog slice. */
  dialog: DialogSlice;
  openDialog: (npcId: string) => void;
  closeDialog: () => void;
  setDialogWaiting: (waiting: boolean) => void;
  appendDialogTurn: (role: 'user' | 'assistant', content: string, ts?: number) => void;
  setDialogHistory: (history: DialogHistoryEntry[]) => void;
  setDialogError: (error: string | null) => void;
}

const initialNPCs: Record<string, NPCStoreEntry> = Object.fromEntries(
  NPCS.map((def) => [
    def.id,
    {
      id: def.id,
      name: def.name,
      locationId: def.locationId ?? null,
      position: { x: def.spawn.x, y: def.spawn.y },
    },
  ]),
);

const initialDialog: DialogSlice = {
  open: false,
  npcId: null,
  history: [],
  isWaiting: false,
  error: null,
};

export const useGameStore = create<GameStoreState>((set) => ({
  phase: '2.3',
  currentLocationId: null,
  setCurrentLocation: (id) => set({ currentLocationId: id }),
  playerPosition: { x: 640, y: 360 },
  setPlayerPosition: (pos) => set({ playerPosition: pos }),
  npcs: initialNPCs,

  dialog: initialDialog,

  // Switching NPCs resets history + error so the box always opens to a clean
  // slate; the system layer is responsible for fetching prior context if any.
  openDialog: (npcId) =>
    set((state) => {
      if (state.dialog.open && state.dialog.npcId === npcId) return state;
      return {
        dialog: {
          open: true,
          npcId,
          history: state.dialog.npcId === npcId ? state.dialog.history : [],
          isWaiting: false,
          error: null,
        },
      };
    }),

  closeDialog: () =>
    set((state) => ({
      dialog: { ...state.dialog, open: false, isWaiting: false, error: null },
    })),

  setDialogWaiting: (waiting) =>
    set((state) => ({ dialog: { ...state.dialog, isWaiting: waiting } })),

  appendDialogTurn: (role, content, ts) =>
    set((state) => ({
      dialog: {
        ...state.dialog,
        history: [...state.dialog.history, { role, content, ts: ts ?? Date.now() }],
      },
    })),

  setDialogHistory: (history) =>
    set((state) => ({ dialog: { ...state.dialog, history } })),

  setDialogError: (error) =>
    set((state) => ({ dialog: { ...state.dialog, error } })),
}));
