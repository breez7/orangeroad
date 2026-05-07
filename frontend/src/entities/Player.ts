import { Container, Graphics } from 'pixi.js';

export interface PlayerOptions {
  x?: number;
  y?: number;
  speed?: number; // px/sec in town coordinates
  bodyColor?: number;
  headColor?: number;
}

/**
 * Player character entity (FR-005 이동 시스템).
 *
 * Placeholder visual: rounded-rect body + circle head + small directional
 * indicator. No texture loading — this will be replaced by sprite art in a
 * later phase.
 */
export class Player {
  readonly view: Container;

  /** Town-local position (matches view.x / view.y). */
  x: number;
  y: number;

  /** Movement speed in px/sec (town coords). */
  speed: number;

  private targetX: number | null = null;
  private targetY: number | null = null;

  /** Facing direction in radians; only updated while moving. */
  private facing = 0;
  private indicator: Graphics;

  /** Approximate body radius for collision/clamping logic. */
  static readonly RADIUS = 16;

  constructor(opts: PlayerOptions = {}) {
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.speed = opts.speed ?? 200;

    const bodyColor = opts.bodyColor ?? 0xff6b35;
    const headColor = opts.headColor ?? 0xffd6a5;

    const container = new Container();
    container.label = 'player';
    container.x = this.x;
    container.y = this.y;

    // Shadow
    const shadow = new Graphics();
    shadow.ellipse(0, 14, 14, 5);
    shadow.fill({ color: 0x000000, alpha: 0.35 });
    container.addChild(shadow);

    // Body (rounded rect, anchor at center-bottom-ish)
    const body = new Graphics();
    body.roundRect(-10, -6, 20, 22, 6);
    body.fill({ color: bodyColor });
    body.stroke({ color: 0x1a1a2e, width: 2, alpha: 0.9 });
    container.addChild(body);

    // Head
    const head = new Graphics();
    head.circle(0, -14, 8);
    head.fill({ color: headColor });
    head.stroke({ color: 0x1a1a2e, width: 2, alpha: 0.9 });
    container.addChild(head);

    // Directional indicator (small triangle that rotates around player)
    const indicator = new Graphics();
    indicator.poly([6, 0, -3, -4, -3, 4]);
    indicator.fill({ color: 0xffffff, alpha: 0.85 });
    indicator.stroke({ color: 0x1a1a2e, width: 1, alpha: 0.9 });
    indicator.x = 0;
    indicator.y = 4;
    indicator.visible = false;
    container.addChild(indicator);
    this.indicator = indicator;

    this.view = container;
  }

  /** Set a movement target in town-local coordinates. */
  moveTo(targetX: number, targetY: number): void {
    this.targetX = targetX;
    this.targetY = targetY;
  }

  /** Stop any in-progress movement. */
  stop(): void {
    this.targetX = null;
    this.targetY = null;
    this.indicator.visible = false;
  }

  /**
   * Phase 3.2 — instantly relocate the player (FR-008 load).
   *
   * Cancels any in-progress walk target so the loaded save doesn't get
   * overwritten by the previous click destination on the next frame.
   */
  teleport(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.view.x = x;
    this.view.y = y;
    this.targetX = null;
    this.targetY = null;
    this.indicator.visible = false;
  }

  /** True if currently moving toward a target. */
  get isMoving(): boolean {
    return this.targetX !== null && this.targetY !== null;
  }

  /** Advance toward target. `dt` in seconds. */
  update(dt: number): void {
    if (this.targetX === null || this.targetY === null) return;

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= 1) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.view.x = this.x;
      this.view.y = this.y;
      this.targetX = null;
      this.targetY = null;
      this.indicator.visible = false;
      return;
    }

    const step = Math.min(dist, this.speed * dt);
    const nx = dx / dist;
    const ny = dy / dist;
    this.x += nx * step;
    this.y += ny * step;
    this.view.x = this.x;
    this.view.y = this.y;

    this.facing = Math.atan2(dy, dx);
    this.indicator.visible = true;
    this.indicator.rotation = this.facing;
  }

  destroy(): void {
    this.stop();
    this.view.destroy({ children: true });
  }
}
