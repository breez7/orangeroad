import { create } from 'zustand';

export interface PlayerPosition {
  x: number;
  y: number;
}

interface GameStoreState {
  phase: string;
  currentLocationId: string | null;
  setCurrentLocation: (id: string | null) => void;
  playerPosition: PlayerPosition;
  setPlayerPosition: (pos: PlayerPosition) => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  phase: '1.4',
  currentLocationId: null,
  setCurrentLocation: (id) => set({ currentLocationId: id }),
  playerPosition: { x: 640, y: 360 },
  setPlayerPosition: (pos) => set({ playerPosition: pos }),
}));
