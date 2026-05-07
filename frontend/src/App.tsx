import { useEffect, useRef } from 'react';
import { Game } from '@/core/Game';
import { useGameStore } from '@/store/gameStore';

function App() {
  const phase = useGameStore((s) => s.phase);
  const playerPosition = useGameStore((s) => s.playerPosition);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const game = new Game();
    void game.init(host);
    return () => {
      game.destroy();
    };
  }, []);

  return (
    <div className="game-container">
      <div ref={hostRef} className="game-canvas" />
      <div className="ui-overlay">
        <div className="status-panel ui-interactive">
          <h2 className="text-lg font-bold text-orange-primary">Orange Road</h2>
          <p className="text-sm text-gray-300">Phase {phase} — Click to walk</p>
          <p className="text-xs text-green-400 mt-1">
            Player: ({Math.round(playerPosition.x)}, {Math.round(playerPosition.y)})
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
