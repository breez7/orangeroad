import { Application, Ticker } from 'pixi.js';
import { GameScene } from '@/scenes/GameScene';

export class Game {
  private app: Application | null = null;
  private scene: GameScene | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private tickHandler: ((ticker: Ticker) => void) | null = null;

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

    this.scene = new GameScene();
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
  }
}
