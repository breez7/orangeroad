import { create } from 'zustand';

interface GameStoreState {
  phase: string;
}

export const useGameStore = create<GameStoreState>(() => ({
  phase: '1.1',
}));
