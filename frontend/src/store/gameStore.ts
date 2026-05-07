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

interface GameStoreState {
  phase: string;
  currentLocationId: string | null;
  setCurrentLocation: (id: string | null) => void;
  playerPosition: PlayerPosition;
  setPlayerPosition: (pos: PlayerPosition) => void;
  npcs: Record<string, NPCStoreEntry>;
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

export const useGameStore = create<GameStoreState>((set) => ({
  phase: '2.1',
  currentLocationId: null,
  setCurrentLocation: (id) => set({ currentLocationId: id }),
  playerPosition: { x: 640, y: 360 },
  setPlayerPosition: (pos) => set({ playerPosition: pos }),
  npcs: initialNPCs,
}));
