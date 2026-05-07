import { Application, Ticker } from 'pixi.js';
import { GameScene } from '@/scenes/GameScene';
import type { DialogSystem } from '@/systems/DialogSystem';
import type { SaveSystem } from '@/systems/SaveSystem';
import type { StorySystem } from '@/systems/StorySystem';
import type { EffectSystem } from '@/systems/EffectSystem';
import { AudioEngine } from '@/audio/AudioEngine';

export class Game {
  private app: Application | null = null;
  private scene: GameScene | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private tickHandler: ((ticker: Ticker) => void) | null = null;
  /**
   * Phase 5.2 — single AudioEngine instance owned by the Game (one
   * AudioContext per page, regardless of scene rebuilds in StrictMode).
   * The engine is constructed eagerly but its underlying AudioContext is
   * lazy-init'd on the first user gesture per the autoplay policy.
   */
  private readonly audio = new AudioEngine();

  /** Currently-active scene (or null before init / after destroy). */
  get currentScene(): GameScene | null {
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

    // Phase 5.2 — pass shared AudioEngine + visual EffectSystem owner so
    // GameScene can wire them into DialogSystem / StorySystem.
    this.scene = new GameScene({ audioEngine: this.audio });
    app.stage.addChild(this.scene.root);
    this.scene.fitTo(app.screen.width, app.screen.height);

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

  destroy(): void {
    this.destroyed = true;
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
