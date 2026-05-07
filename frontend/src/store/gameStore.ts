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
 * Story flag value type — open enough for booleans, counters, or short
 * authoring strings. Phase 4.1 only uses booleans in event scripts but
 * keeping the slot open prevents a future migration if we add e.g.
 * `madoka_route_progress: 2`.
 */
export type FlagValue = boolean | string | number;

/**
 * Story slice (Phase 4.1 — FR-006).
 *
 * Tracks the currently-playing scripted event (if any) and the cumulative
 * list of event ids that have already fired in this save (used to gate
 * `once: true` events). The actual event scripts (steps array, etc.) are
 * fetched on-demand from the backend by StorySystem; the store only holds
 * the playback cursor.
 */
export interface StorySlice {
  /** id of the event currently playing, or null when free play. */
  activeEventId: string | null;
  /** Index of the next step to play within the active event. */
  stepIndex: number;
  /** Cumulative list of event ids that have already fired (per save). */
  fireHistory: string[];
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

  // --- Phase 4.1 story / flags (FR-006) -------------------------------------
  flags: Record<string, FlagValue>;
  setFlag: (key: string, value?: FlagValue) => void;
  clearFlag: (key: string) => void;
  setFlags: (record: Record<string, FlagValue>) => void;

  story: StorySlice;
  /** Begin a scripted event. Resets stepIndex to 0. Idempotent for same id. */
  startEvent: (eventId: string) => void;
  /** Advance to the next step. */
  advanceStep: () => void;
  /** End the active event. The event id is appended to fireHistory if absent. */
  endEvent: () => void;
  /** Bulk replace fireHistory (used by SaveSystem.load). */
  setStoryFireHistory: (history: string[]) => void;

  /**
   * Phase 4.1 — coarse current-location id derived from playerPosition.
   * StorySystem keeps this fresh; UI selectors can read it for "you are at"
   * displays without reaching into PixiJS state. Distinct from
   * `currentLocationId` which is reserved for the destination/active scene.
   */
  playerLocationId: string | null;
  setPlayerLocationId: (id: string | null) => void;
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

const initialStory: StorySlice = {
  activeEventId: null,
  stepIndex: 0,
  fireHistory: [],
};

export const useGameStore = create<GameStoreState>((set) => ({
  phase: '4.1',
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

  // --- Phase 4.1 flags + story slice (FR-006) -------------------------------

  flags: {},

  // setFlag with optional value defaults to `true` — the most common case is
  // "mark complete". Short-circuits when the value is unchanged so the
  // StorySystem ON_FLAG subscriber doesn't re-fire for a no-op write.
  setFlag: (key, value) =>
    set((state) => {
      const v: FlagValue = value === undefined ? true : value;
      if (state.flags[key] === v) return state;
      return { flags: { ...state.flags, [key]: v } };
    }),

  clearFlag: (key) =>
    set((state) => {
      if (!(key in state.flags)) return state;
      const next = { ...state.flags };
      delete next[key];
      return { flags: next };
    }),

  setFlags: (record) => set({ flags: { ...record } }),

  story: initialStory,

  startEvent: (eventId) =>
    set((state) => {
      if (state.story.activeEventId === eventId && state.story.stepIndex === 0) {
        return state;
      }
      return {
        story: { ...state.story, activeEventId: eventId, stepIndex: 0 },
      };
    }),

  advanceStep: () =>
    set((state) => {
      if (!state.story.activeEventId) return state;
      return {
        story: { ...state.story, stepIndex: state.story.stepIndex + 1 },
      };
    }),

  endEvent: () =>
    set((state) => {
      const id = state.story.activeEventId;
      if (!id) return state;
      // Append to fireHistory if not already present (idempotent on replay).
      const fireHistory = state.story.fireHistory.includes(id)
        ? state.story.fireHistory
        : [...state.story.fireHistory, id];
      return {
        story: {
          activeEventId: null,
          stepIndex: 0,
          fireHistory,
        },
      };
    }),

  setStoryFireHistory: (history) =>
    set((state) => ({
      story: { ...state.story, fireHistory: [...history] },
    })),

  playerLocationId: null,
  setPlayerLocationId: (id) =>
    set((state) => (state.playerLocationId === id ? state : { playerLocationId: id })),
}));
