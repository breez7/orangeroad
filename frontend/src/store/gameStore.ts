import { create } from 'zustand';

interface GameStoreState {
  phase: string;
  currentLocationId: string | null;
  setCurrentLocation: (id: string | null) => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  phase: '1.3',
  currentLocationId: null,
  setCurrentLocation: (id) => set({ currentLocationId: id }),
}));
