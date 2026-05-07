import { useGameStore } from '@/store/gameStore';

function App() {
  const phase = useGameStore((s) => s.phase);

  return (
    <div className="game-container">
      <div className="ui-overlay">
        <div className="status-panel ui-interactive">
          <h2 className="text-lg font-bold text-orange-primary">Orange Road</h2>
          <p className="text-sm text-gray-300">Phase {phase} — Setup OK</p>
          <p className="text-xs text-green-400 mt-1">React + Vite + Tailwind + Zustand ready</p>
        </div>
      </div>
    </div>
  );
}

export default App;
