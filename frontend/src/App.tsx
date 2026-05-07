import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Game } from '@/core/Game';
import { useGameStore } from '@/store/gameStore';
import { DialogBox } from '@/ui/components/DialogBox';
import { TimeDisplay } from '@/ui/components/TimeDisplay';
import { SaveSlotsPanel } from '@/ui/components/SaveSlotsPanel';
import { StoryOverlay } from '@/ui/components/StoryOverlay';
import { HelpPanel } from '@/ui/components/HelpPanel';
import { ToastContainer } from '@/ui/components/Toast';

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

  // Phase 3.3 — relationship slice for the open NPC. Defaults are returned
  // when no entry exists yet (e.g. before the first talk turn syncs the
  // server state) so the UI never has to handle undefined.
  const dialogAffinity = useGameStore((s) =>
    s.dialog.npcId ? (s.relationships[s.dialog.npcId]?.affinity ?? 50) : 50,
  );
  const dialogEmotion = useGameStore((s) =>
    s.dialog.npcId ? (s.relationships[s.dialog.npcId]?.emotion ?? 'neutral') : 'neutral',
  );

  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);

  // Phase 3.2 — save panel toggle. The SaveSystem itself is owned by
  // GameScene; the panel reads it lazily through gameRef when opened.
  const [saveOpen, setSaveOpen] = useState(false);

  // Phase 5.1 — collapse the verbose status-panel details on narrow screens.
  // Track viewport width via a single matchMedia listener so the layout
  // reflows without re-rendering on every resize tick.
  const [isNarrow, setIsNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 639px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 639px)');
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    // Both `addEventListener` and the legacy `addListener` exist; modern
    // browsers prefer the former. The cast keeps TS strict happy without
    // pulling in lib.dom updates.
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // On narrow screens default to "collapsed" — the user can tap the
  // chevron to expand the verbose details if they want them.
  const [statusExpanded, setStatusExpanded] = useState<boolean>(false);
  const showStatusDetails = !isNarrow || statusExpanded;

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

  const handleOpenSave = useCallback(() => setSaveOpen(true), []);
  const handleCloseSave = useCallback(() => setSaveOpen(false), []);

  // Phase 4.1 — StoryOverlay needs the npc-id → display-name map to render
  // the speaker label for `dialog` steps. Memoised against the npcs slice
  // so the overlay only re-renders when names change (rare).
  const npcNames = useGameStore((s) => s.npcs);
  const speakerNameMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, npc] of Object.entries(npcNames)) out[id] = npc.name;
    return out;
  }, [npcNames]);

  const handleStoryConfirm = useCallback(() => {
    const story = gameRef.current?.storySystem;
    if (!story) return;
    void story.confirmStep();
  }, []);

  return (
    <div className="game-container">
      <div ref={hostRef} className="game-canvas" />
      <div className="ui-overlay">
        <div className="status-panel ui-interactive">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-orange-primary leading-tight">
                Orange Road
              </h2>
              {showStatusDetails && (
                <p className="text-xs sm:text-sm text-gray-300 leading-snug animate-fade-in">
                  Phase {phase} — NPC를 클릭해 대화하세요
                </p>
              )}
            </div>
            {isNarrow && (
              <button
                type="button"
                onClick={() => setStatusExpanded((v) => !v)}
                className="btn-icon shrink-0"
                aria-label={statusExpanded ? '상세 정보 접기' : '상세 정보 펼치기'}
                aria-expanded={statusExpanded}
              >
                <span aria-hidden className="text-orange-secondary text-base">
                  {statusExpanded ? '▾' : '▸'}
                </span>
              </button>
            )}
          </div>

          {showStatusDetails && (
            <div className="mt-1 space-y-0.5 animate-fade-in">
              <p className="text-xs text-green-400">
                Player: ({Math.round(playerPosition.x)}, {Math.round(playerPosition.y)})
              </p>
              <p className="text-xs text-blue-300">NPCs: {npcCount}</p>
              <button
                type="button"
                onClick={handleOpenSave}
                className="btn-game text-xs px-3 py-1 mt-2"
              >
                세이브 / 로드
              </button>
            </div>
          )}

          {!showStatusDetails && (
            <button
              type="button"
              onClick={handleOpenSave}
              className="btn-game-ghost text-xs px-2 py-0.5 mt-1"
              aria-label="세이브 / 로드 열기"
            >
              저장
            </button>
          )}
        </div>

        {/* Phase 3.1 — top-right clock HUD (FR-004). */}
        <TimeDisplay />

        <DialogBox
          open={dialogOpen}
          npcId={dialogNpcId}
          npcName={dialogNpcName}
          history={dialogHistory}
          isWaiting={dialogWaiting}
          error={dialogError}
          affinity={dialogAffinity}
          emotion={dialogEmotion}
          onSend={handleSend}
          onClose={handleClose}
        />

        {/* Phase 3.2 — save/load panel (FR-008). Read SaveSystem lazily so
            we don't capture a stale reference if the scene is rebuilt. */}
        <SaveSlotsPanel
          open={saveOpen}
          saveSystem={gameRef.current?.saveSystem ?? null}
          onClose={handleCloseSave}
        />

        {/* Phase 4.1 — story event overlay (FR-006). Rendered ABOVE the
            DialogBox so a scripted scene can never be hidden behind a
            stray AI-dialog window. */}
        <StoryOverlay npcNames={speakerNameMap} onConfirm={handleStoryConfirm} />

        {/* Phase 5.1 — UX affordances. */}
        <HelpPanel />
      </div>

      {/* Toasts live outside `.ui-overlay` so they aren't constrained by its
          pointer-events: none rule (toast container handles its own pointer
          policy). */}
      <ToastContainer />
    </div>
  );
}

export default App;
