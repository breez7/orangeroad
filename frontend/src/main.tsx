import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useGameStore } from '@/store/gameStore';
import './styles/globals.css';

// Get root element
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element');
}

// Dev-only: expose the Zustand store so Playwright tests can deterministically
// mutate flags / story slices (e.g. setFlag('intro_complete', true) to skip
// past the ON_START intro). Stripped from production builds by Vite.
if (import.meta.env.DEV) {
  (window as unknown as { __store: typeof useGameStore }).__store = useGameStore;
}

// Create React root
const root = createRoot(rootElement);

// Render app
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
