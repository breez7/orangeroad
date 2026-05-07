import { Application, Ticker } from 'pixi.js';
import { GameScene } from '@/scenes/GameScene';
import { IndoorScene } from '@/scenes/IndoorScene';
import { getIndoorScene } from '@/data/indoorScenes';
import { useGameStore } from '@/store/gameStore';
import type { DialogSystem } from '@/systems/DialogSystem';
import type { SaveSystem } from '@/systems/SaveSystem';
import type { StorySystem } from '@/systems/StorySystem';
import type { EffectSystem } from '@/systems/EffectSystem';
import { AudioEngine } from '@/audio/AudioEngine';

/**
 * Phase C (Issue #23) — common surface that both GameScene (outdoor) and
 * IndoorScene (interior) implement, so Game.ts can ticker / fitTo / destroy
 * either without branching. Defined as a structural alias rather than an
 * `implements` declaration to avoid forcing both scene classes through a
 * shared base class.
 */
type ActiveScene = GameScene | IndoorScene;

export class Game {
  private app: Application | null = null;
  private scene: ActiveScene | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private tickHandler: ((ticker: Ticker) => void) | null = null;
  /**
   * Phase C (Issue #23) — store subscriber that reacts to external
   * `setCurrentScene()` writes (notably from SaveSystem.load) by swapping
   * the mounted scene. Internal calls go through enter/exit which already
   * write the store, so the subscriber's own change is short-circuited by
   * the "already on this scene" checks inside enter/exit/mountInitialScene.
   */
  private sceneUnsubscribe: (() => void) | null = null;
  /**
   * Phase 5.2 — single AudioEngine instance owned by the Game (one
   * AudioContext per page, regardless of scene rebuilds in StrictMode).
   * The engine is constructed eagerly but its underlying AudioContext is
   * lazy-init'd on the first user gesture per the autoplay policy.
   */
  private readonly audio = new AudioEngine();

  /** Currently-active scene (or null before init / after destroy). */
  get currentScene(): ActiveScene | null {
    return this.scene;
  }

  /** Convenience accessor for the dialog system on the active scene. */
  get dialogSystem(): DialogSystem | null {
    return this.scene?.dialog ?? null;
  }

  /** Phase 3.2 — accessor for the save system on the active scene (FR-008). */
  get saveSystem(): SaveSystem | null {
    return this.scene?.save ?? null;
  }

  /** Phase 4.1 — accessor for the story system on the active scene (FR-006). */
  get storySystem(): StorySystem | null {
    return this.scene?.story ?? null;
  }

  /** Phase 5.2 — accessor for the effect system on the active scene. */
  get effectSystem(): EffectSystem | null {
    return this.scene?.effects ?? null;
  }

  /** Phase 5.2 — shared AudioEngine. Guaranteed non-null after Game construction. */
  get audioEngine(): AudioEngine {
    return this.audio;
  }

  async init(host: HTMLElement): Promise<void> {
    if (this.destroyed) return;

    const app = new Application();
    const rect = host.getBoundingClientRect();
    await app.init({
      resizeTo: host,
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height)),
      backgroundColor: 0x1a1a2e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    if (this.destroyed) {
      app.destroy(true, { children: true, texture: true });
      return;
    }

    this.app = app;
    host.appendChild(app.canvas);

    // Phase C — initial scene comes from the gameStore's currentScene slice
    // so loading a v2 save before the canvas mounts (e.g. boot path) puts
    // the player in the right scene. Default for a fresh game is outdoor.
    this.mountInitialScene();

    // Phase C — wire a store subscriber so SaveSystem.load (which writes
    // `currentScene` directly) results in a scene swap. Internal scene
    // transitions also write the store but they're already mounted by the
    // time the subscriber fires, so the swap call short-circuits.
    this.sceneUnsubscribe = useGameStore.subscribe((state, prev) => {
      if (this.destroyed) return;
      if (state.currentScene === prev.currentScene) return;
      this.syncToStoreScene();
    });

    this.tickHandler = (ticker: Ticker) => {
      if (!this.scene) return;
      this.scene.update(ticker.deltaMS / 1000);
    };
    app.ticker.add(this.tickHandler);

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.app || !this.scene) return;
      this.scene.fitTo(this.app.screen.width, this.app.screen.height);
    });
    this.resizeObserver.observe(host);
  }

  /**
   * Phase C (Issue #23) — destroy the current scene and mount the indoor
   * scene matching `sceneId`. Called from GameScene's doorway-entry
   * callback AND from the dev `__game.enterIndoor()` hook. No-op if a
   * transition is already in progress.
   */
  enterIndoor(sceneId: string, opts: { spawnAt?: { x: number; y: number } } = {}): void {
    if (!this.app) return;
    if (this.destroyed) return;
    const def = getIndoorScene(sceneId);
    if (!def) {
      // eslint-disable-next-line no-console
      console.warn(`[Game] enterIndoor: unknown sceneId "${sceneId}"`);
      return;
    }
    // If already in this indoor scene, no-op.
    if (this.scene instanceof IndoorScene && this.scene.def.id === sceneId) {
      return;
    }
    this.tearDownActiveScene();
    const next = new IndoorScene({
      sceneId,
      audioEngine: this.audio,
      ...(opts.spawnAt !== undefined ? { spawnAt: opts.spawnAt } : {}),
      onRequestExit: () => this.exitIndoor(),
    });
    this.attachScene(next);
    useGameStore.getState().setCurrentScene({ kind: 'indoor', sceneId });
  }

  /**
   * Phase C (Issue #23) — destroy the current indoor scene and remount the
   * outdoor GameScene at the matching `outdoorReturn` coords. Called from
   * IndoorScene's exit callback AND from the dev `__game.exitIndoor()`
   * hook. If we're already outdoor this is a no-op.
   */
  exitIndoor(): void {
    if (!this.app || this.destroyed) return;
    if (this.scene instanceof GameScene) return;
    let spawnAt: { x: number; y: number } | undefined;
    if (this.scene instanceof IndoorScene) {
      spawnAt = { ...this.scene.def.outdoorReturn };
    }
    this.tearDownActiveScene();
    const next = new GameScene({
      audioEngine: this.audio,
      onRequestEnterIndoor: (id) => this.enterIndoor(id),
      ...(spawnAt !== undefined ? { spawnAt } : {}),
    });
    this.attachScene(next);
    useGameStore.getState().setCurrentScene({ kind: 'outdoor' });
  }

  /**
   * Mount the scene matching the store's current `currentScene` slice. Used
   * on init() AND after a save load that switched scenes. Idempotent — a
   * call that matches the active scene is a no-op.
   */
  private mountInitialScene(): void {
    const target = useGameStore.getState().currentScene;
    if (target.kind === 'indoor') {
      const def = getIndoorScene(target.sceneId);
      if (def) {
        const next = new IndoorScene({
          sceneId: target.sceneId,
          audioEngine: this.audio,
          onRequestExit: () => this.exitIndoor(),
        });
        this.attachScene(next);
        return;
      }
      // Unknown scene id (e.g. a save written against an older catalogue);
      // fall through to outdoor and reset the store slice.
      useGameStore.getState().setCurrentScene({ kind: 'outdoor' });
    }
    const next = new GameScene({
      audioEngine: this.audio,
      onRequestEnterIndoor: (id) => this.enterIndoor(id),
    });
    this.attachScene(next);
  }

  /**
   * Phase C — sync the mounted scene to whatever the store says. Used by
   * the save-load path (which writes `currentScene` directly without going
   * through enter/exit). No-op when the mounted scene already matches.
   */
  private syncToStoreScene(): void {
    if (!this.app || this.destroyed) return;
    const target = useGameStore.getState().currentScene;
    if (target.kind === 'outdoor') {
      if (this.scene instanceof GameScene) return;
      // Pull the player position from the store so we land where the save
      // says, not at the previous indoor's outdoorReturn.
      const pos = useGameStore.getState().playerPosition;
      this.tearDownActiveScene();
      const next = new GameScene({
        audioEngine: this.audio,
        onRequestEnterIndoor: (id) => this.enterIndoor(id),
        spawnAt: { x: pos.x, y: pos.y },
      });
      this.attachScene(next);
    } else {
      if (
        this.scene instanceof IndoorScene &&
        this.scene.def.id === target.sceneId
      ) {
        return;
      }
      const def = getIndoorScene(target.sceneId);
      if (!def) return;
      const pos = useGameStore.getState().playerPosition;
      this.tearDownActiveScene();
      const next = new IndoorScene({
        sceneId: target.sceneId,
        audioEngine: this.audio,
        spawnAt: { x: pos.x, y: pos.y },
        onRequestExit: () => this.exitIndoor(),
      });
      this.attachScene(next);
    }
  }

  private attachScene(scene: ActiveScene): void {
    if (!this.app) return;
    this.scene = scene;
    this.app.stage.addChild(scene.root);
    scene.fitTo(this.app.screen.width, this.app.screen.height);
  }

  private tearDownActiveScene(): void {
    if (!this.scene) return;
    const s = this.scene;
    this.scene = null;
    if (this.app) {
      this.app.stage.removeChild(s.root);
    }
    s.destroy();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.sceneUnsubscribe) {
      this.sceneUnsubscribe();
      this.sceneUnsubscribe = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.app && this.tickHandler) {
      this.app.ticker.remove(this.tickHandler);
    }
    this.tickHandler = null;

    if (this.scene) {
      this.scene.destroy();
      this.scene = null;
    }

    if (this.app) {
      const canvas = this.app.canvas;
      this.app.destroy(true, { children: true, texture: true });
      if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
      this.app = null;
    }

    // Phase 5.2 — close the AudioContext last so any in-flight SFX (rare,
    // but possible if a teardown lands mid-step) get cleaned up.
    this.audio.destroy();
  }
}
