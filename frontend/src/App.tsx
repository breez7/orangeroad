import { useEffect, useRef, useCallback } from 'react';
import { Game } from '@/core/Game';
import { useGameStore } from '@/store/gameStore';
import { DialogBox } from '@/ui/components/DialogBox';

function App() {
  const phase = useGameStore((s) => s.phase);
  const playerPosition = useGameStore((s) => s.playerPosition);
  const npcCount = useGameStore((s) => Object.keys(s.npcs).length);

  // Dialog-slice selectors. Each is a primitive / stable reference so the
  // <DialogBox /> only re-renders when its own slice changes — not on
  // every player-position tick.
  const dialogOpen = useGameStore((s) => s.dialog.open);
  const dialogNpcId = useGameStore((s) => s.dialog.npcId);
  const dialogHistory = useGameStore((s) => s.dialog.history);
  const dialogWaiting = useGameStore((s) => s.dialog.isWaiting);
  const dialogError = useGameStore((s) => s.dialog.error);
  const dialogNpcName = useGameStore((s) =>
    s.dialog.npcId ? (s.npcs[s.dialog.npcId]?.name ?? null) : null,
  );

  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const game = new Game();
    gameRef.current = game;
    void game.init(host);
    return () => {
      gameRef.current = null;
      game.destroy();
    };
  }, []);

  // Imperative bridge: React's onSend fires the DialogSystem.send() on the
  // active scene. Stable callback so the <DialogBox /> input doesn't churn.
  const handleSend = useCallback((message: string) => {
    const dialog = gameRef.current?.dialogSystem;
    if (!dialog) return;
    void dialog.send(message);
  }, []);

  const handleClose = useCallback(() => {
    const dialog = gameRef.current?.dialogSystem;
    if (dialog) dialog.close();
    else useGameStore.getState().closeDialog();
  }, []);

  return (
    <div className="game-container">
      <div ref={hostRef} className="game-canvas" />
      <div className="ui-overlay">
        <div className="status-panel ui-interactive">
          <h2 className="text-lg font-bold text-orange-primary">Orange Road</h2>
          <p className="text-sm text-gray-300">
            Phase {phase} — Click NPC to talk
          </p>
          <p className="text-xs text-green-400 mt-1">
            Player: ({Math.round(playerPosition.x)}, {Math.round(playerPosition.y)})
          </p>
          <p className="text-xs text-blue-300 mt-1">NPCs: {npcCount}</p>
        </div>

        <DialogBox
          open={dialogOpen}
          npcId={dialogNpcId}
          npcName={dialogNpcName}
          history={dialogHistory}
          isWaiting={dialogWaiting}
          error={dialogError}
          onSend={handleSend}
          onClose={handleClose}
        />
      </div>
    </div>
  );
}

export default App;
