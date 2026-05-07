import { create } from 'zustand';
import { NPCS } from '@/data/npcs';
import type { DayOfWeek } from '@/systems/TimeSystem';

/**
 * Coarse emotion taxonomy — must stay in sync with backend
 * `backend/src/models/Relationship.ts`. Duplicated here rather than
 * imported across the package boundary to keep the FE self-contained.
 */
export type Emotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'shy'
  | 'flirty'
  | 'annoyed';

/** Phase 3.3 — per-NPC relationship state slice. Mirrors backend RelationshipData. */
export interface RelationshipEntry {
  npcId: string;
  /** 0-100 affinity, default 50. */
  affinity: number;
  emotion: Emotion;
  /** Epoch ms of the last server update we know about. */
  lastUpdated: number;
}

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

/**
 * Time slice (Phase 3.1 — FR-004).
 *
 * Holds a denormalised, ready-for-render snapshot of the game clock. The
 * authoritative source is `TimeSystem` (frontend/src/systems/TimeSystem.ts);
 * it pushes a new snapshot at most once per game-minute, never every frame.
 * Both `dayOfWeek` and `phaseLabel` are recomputed by TimeSystem and stored
 * here as denormalised values so React selectors don't need a derivation
 * step on every read.
 */
export interface TimeSlice {
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: DayOfWeek;
  phaseLabel: string;
}

interface GameStoreState {
  phase: string;
  currentLocationId: string | null;
  setCurrentLocation: (id: string | null) => void;
  playerPosition: PlayerPosition;
  setPlayerPosition: (pos: PlayerPosition) => void;
  npcs: Record<string, NPCStoreEntry>;
  /** Phase 3.2 — bulk replace the NPC slice during a save load (FR-008). */
  setNPCs: (npcs: Record<string, NPCStoreEntry>) => void;

  /** Phase 2.3 dialog slice. */
  dialog: DialogSlice;
  openDialog: (npcId: string) => void;
  closeDialog: () => void;
  setDialogWaiting: (waiting: boolean) => void;
  appendDialogTurn: (role: 'user' | 'assistant', content: string, ts?: number) => void;
  setDialogHistory: (history: DialogHistoryEntry[]) => void;
  setDialogError: (error: string | null) => void;

  /** Phase 3.1 time slice. */
  time: TimeSlice;
  setTime: (t: TimeSlice) => void;

  /**
   * Phase 3.3 relationship slice (FR-007). One entry per known NPC. Updated
   * by DialogSystem after every successful talk turn; bulk-restored from a
   * save payload via setRelationships.
   */
  relationships: Record<string, RelationshipEntry>;
  setRelationship: (npcId: string, data: RelationshipEntry) => void;
  setRelationships: (record: Record<string, RelationshipEntry>) => void;
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

// Initial time mirrors TimeSystem's defaults (day 1 = Monday, 08:00).
// TimeSystem pushes its real snapshot in its constructor, so this is just a
// safe placeholder for any selector that reads `time` before TimeSystem
// instantiates.
const initialTime: TimeSlice = {
  day: 1,
  hour: 8,
  minute: 0,
  dayOfWeek: 'MON',
  phaseLabel: '오전 수업',
};

// Phase 3.3 — initialise relationships from the NPC roster with the same
// "neutral acquaintance" defaults the backend uses (affinity 50, neutral).
// Backend persists per-NPC; this is the in-memory snapshot the UI reads.
const initialRelationships: Record<string, RelationshipEntry> = Object.fromEntries(
  NPCS.map((def) => [
    def.id,
    {
      npcId: def.id,
      affinity: 50,
      emotion: 'neutral' as const,
      lastUpdated: 0,
    },
  ]),
);

export const useGameStore = create<GameStoreState>((set) => ({
  phase: '3.3',
  currentLocationId: null,
  setCurrentLocation: (id) => set({ currentLocationId: id }),
  playerPosition: { x: 640, y: 360 },
  setPlayerPosition: (pos) => set({ playerPosition: pos }),
  npcs: initialNPCs,
  setNPCs: (npcs) => set({ npcs }),

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

  // Time slice. Shallow-comparable: only mutate when at least one field
  // actually changed. TimeSystem already throttles this to once per
  // game-minute, but the extra check is cheap insurance against future
  // callers (e.g. save/load reapplying the same snapshot).
  time: initialTime,
  setTime: (t) =>
    set((state) => {
      const cur = state.time;
      if (
        cur.day === t.day &&
        cur.hour === t.hour &&
        cur.minute === t.minute &&
        cur.dayOfWeek === t.dayOfWeek &&
        cur.phaseLabel === t.phaseLabel
      ) {
        return state;
      }
      return { time: t };
    }),

  // Phase 3.3 — relationship slice (FR-007).
  relationships: initialRelationships,

  // Per-NPC merge: shallow compare so a no-op update doesn't churn React
  // subscribers. The DialogSystem call after every talk turn passes the
  // server's canonical state so we just replace the entry.
  setRelationship: (npcId, data) =>
    set((state) => {
      const cur = state.relationships[npcId];
      if (
        cur &&
        cur.affinity === data.affinity &&
        cur.emotion === data.emotion &&
        cur.lastUpdated === data.lastUpdated
      ) {
        return state;
      }
      return {
        relationships: { ...state.relationships, [npcId]: data },
      };
    }),

  // Bulk replace — used by SaveSystem.load to restore the slice atomically.
  // Missing NPCs in the payload retain their current (default) values rather
  // than being deleted, so old v1 saves stay backward-compatible.
  setRelationships: (record) =>
    set((state) => ({
      relationships: { ...state.relationships, ...record },
    })),
}));
