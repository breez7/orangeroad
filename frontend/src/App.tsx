import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Game } from '@/core/Game';
import { useGameStore } from '@/store/gameStore';
import { DialogBox } from '@/ui/components/DialogBox';
import { TimeDisplay } from '@/ui/components/TimeDisplay';
import { SaveSlotsPanel } from '@/ui/components/SaveSlotsPanel';
import { StoryOverlay } from '@/ui/components/StoryOverlay';
import { HelpPanel } from '@/ui/components/HelpPanel';
import { AudioPanel } from '@/ui/components/AudioPanel';
import { ToastContainer, toast } from '@/ui/components/Toast';

// Phase A-2 — onboarding toast key. Persists across saves: even if the
// player loads a fresh save, we don't want to nag them with the hint again.
const ONBOARDING_LS_KEY = 'orangeroad:onboarding-shown';

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

  // Phase 5.2 — audio-slice selectors. Each is a primitive so the parent's
  // re-render churn is minimal. Used by the AudioEngine sync effect below.
  const musicVolume = useGameStore((s) => s.audio.musicVolume);
  const sfxVolume = useGameStore((s) => s.audio.sfxVolume);
  const muted = useGameStore((s) => s.audio.muted);
  const bgmEnabled = useGameStore((s) => s.audio.bgmEnabled);

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
    // Dev-only: expose a small helper so Playwright tests can teleport the
    // player and step through scripted events without driving the entire
    // Pixi click pipeline. Stripped from production by Vite tree-shaking.
    if (import.meta.env.DEV) {
      (window as unknown as {
        __game: {
          teleportPlayer: (x: number, y: number) => void;
          openDialogWith: (npcId: string) => void;
          playEvent: (eventId: string) => Promise<void>;
          setTimeSpeed: (multiplier: number) => void;
          displaceNpc: (npcId: string, x: number, y: number) => void;
          advanceTime: (minutes: number) => void;
          loadSlot: (slotId: string) => Promise<void>;
        };
      }).__game = {
        teleportPlayer: (x: number, y: number) => {
          const scene = gameRef.current?.currentScene;
          if (!scene) return;
          scene.player.teleport(x, y);
          useGameStore.getState().setPlayerPosition({ x, y });
        },
        openDialogWith: (npcId: string) => {
          gameRef.current?.dialogSystem?.openWith(npcId);
        },
        playEvent: async (eventId: string) => {
          const story = gameRef.current?.storySystem;
          if (!story) return;
          await story.playEvent(eventId);
        },
        setTimeSpeed: (multiplier: number) => {
          const scene = gameRef.current?.currentScene;
          if (scene) scene.time.setSpeed(multiplier);
        },
        displaceNpc: (npcId: string, x: number, y: number) => {
          const scene = gameRef.current?.currentScene;
          if (!scene) return;
          const npc = scene.entityManager.getNPC(npcId);
          if (npc) npc.teleport(x, y, '__displaced__');
          const s = useGameStore.getState();
          const npcs = { ...s.npcs };
          npcs[npcId] = { ...npcs[npcId], position: { x, y }, locationId: '__displaced__' };
          s.setNPCs(npcs);
        },
        advanceTime: (minutes: number) => {
          const scene = gameRef.current?.currentScene;
          if (!scene) return;
          const t = useGameStore.getState().time;
          let day = t.day;
          let hour = t.hour;
          let minute = t.minute + Math.floor(minutes);
          while (minute >= 60) {
            minute -= 60;
            hour += 1;
            if (hour >= 24) {
              hour = 0;
              day += 1;
            }
          }
          scene.time.setTime({ day, hour, minute });
        },
        loadSlot: async (slotId: string) => {
          const sys = gameRef.current?.saveSystem;
          if (!sys) return;
          await sys.load(slotId);
        },
      };
    }
    return () => {
      gameRef.current = null;
      game.destroy();
    };
  }, []);

  // Phase A-2 — onboarding toast. Fires once after the intro completes, then
  // remembers (via localStorage) so subsequent loads / new games don't repeat
  // the hint. The watcher is keyed on the `intro_complete` flag in the
  // gameStore; we read the latest value via subscribe so a flag set inside
  // StorySystem reaches us regardless of whether App re-rendered.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const fire = () => {
      try {
        if (window.localStorage.getItem(ONBOARDING_LS_KEY)) return;
        window.localStorage.setItem(ONBOARDING_LS_KEY, '1');
      } catch {
        // localStorage unavailable (incognito + cookies blocked etc.) — fall
        // through and just show the toast; worst case is showing it twice.
      }
      toast.info(
        '마을을 둘러보고 친구들과 대화해보세요. 빛나는 친구는 클릭해서 말을 걸 수 있어요.',
        7000,
      );
    };
    // If the flag is already set when this effect mounts (e.g. user loaded
    // a save where the intro is done), don't fire — only fire on the
    // *transition* from unset → set so it's the moment the intro just ended.
    let prev = useGameStore.getState().flags['intro_complete'] === true;
    const unsub = useGameStore.subscribe((state) => {
      const cur = state.flags['intro_complete'] === true;
      if (cur && !prev) fire();
      prev = cur;
    });
    return () => {
      unsub();
    };
  }, []);

  // Phase 5.2 — one-time AudioEngine init on first user gesture.
  //
  // Browser autoplay policy: AudioContext can't start until the user has
  // interacted with the page. We register a single document-level
  // pointerdown + keydown listener that calls AudioEngine.init() and
  // immediately removes itself. After init, the engine is responsive to
  // every subsequent SFX call from anywhere in the app.
  useEffect(() => {
    const onFirstGesture = () => {
      const game = gameRef.current;
      if (game) game.audioEngine.init();
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
    window.addEventListener('pointerdown', onFirstGesture);
    window.addEventListener('keydown', onFirstGesture);
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
  }, []);

  // Phase 5.2 — sync audio store slice → AudioEngine.
  //
  // This effect runs on every audio-slice change AND right after init (the
  // engine's setters are no-ops until init succeeds, so an early run from
  // a save-load before the first gesture won't break anything; a second
  // run after the first gesture replays the apply).
  useEffect(() => {
    const engine = gameRef.current?.audioEngine;
    if (!engine) return;
    engine.setMusicVolume(musicVolume);
    engine.setSfxVolume(sfxVolume);
    engine.setMuted(muted);
    if (bgmEnabled) engine.playBgm();
    else engine.stopBgm();
  }, [musicVolume, sfxVolume, muted, bgmEnabled]);

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
    <div className="game-container" data-testid="game-container">
      <div ref={hostRef} className="game-canvas" data-testid="game-canvas-host" />
      <div className="ui-overlay">
        <div className="status-panel ui-interactive" data-testid="status-panel">
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
              <p className="text-xs text-green-400" data-testid="player-coords">
                Player: ({Math.round(playerPosition.x)}, {Math.round(playerPosition.y)})
              </p>
              <p className="text-xs text-blue-300">NPCs: {npcCount}</p>
              <button
                type="button"
                onClick={handleOpenSave}
                className="btn-game text-xs px-3 py-1 mt-2"
                data-testid="open-save-panel"
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
              data-testid="open-save-panel-compact"
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
          effectSystem={gameRef.current?.effectSystem ?? null}
          audioEngine={gameRef.current?.audioEngine ?? null}
          onClose={handleCloseSave}
        />

        {/* Phase 4.1 — story event overlay (FR-006). Rendered ABOVE the
            DialogBox so a scripted scene can never be hidden behind a
            stray AI-dialog window. */}
        <StoryOverlay npcNames={speakerNameMap} onConfirm={handleStoryConfirm} />

        {/* Phase 5.1 — UX affordances. */}
        <HelpPanel />
        {/* Phase 5.2 — audio mixer (Issue #15). */}
        <AudioPanel />
      </div>

      {/* Toasts live outside `.ui-overlay` so they aren't constrained by its
          pointer-events: none rule (toast container handles its own pointer
          policy). */}
      <ToastContainer />
    </div>
  );
}

export default App;
