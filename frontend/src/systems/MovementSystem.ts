import { Container, FederatedPointerEvent, Rectangle } from 'pixi.js';
import type { Player } from '@/entities/Player';
import type { LocationDef } from '@/entities/Location';

export interface MovementSystemOptions {
  /** The town root container (transform-aware; we toLocal() events through this). */
  townRoot: Container;
  /** Player to drive. */
  player: Player;
  /** Town bounds in local coordinates (clamped target position). */
  bounds: { width: number; height: number };
  /** Optional location rects used for soft "do not walk through buildings" snapping. */
  locations?: LocationDef[];
  /** Inset margin so the player doesn't push into walls. Defaults to player radius + 4. */
  margin?: number;
  /**
   * Optional hook called BEFORE the click is treated as a walk target.
   * Receives the click position in town-local coordinates. If the callback
   * returns true the click is consumed and no walk-to is issued — used by
   * the DialogSystem to convert "click an NPC in range" into a dialog open.
   */
  onClickIntercept?: (localX: number, localY: number) => boolean;
  /**
   * Optional gate: while it returns true, all pointer-down events are
   * ignored entirely. Used to freeze movement while the dialog box is open.
   */
  isInputBlocked?: () => boolean;
}

/**
 * Click-to-walk movement system (FR-005).
 *
 * Listens for pointer events on the town root, maps global pointer position
 * into town-local coordinates via the container's transform (so it survives
 * GameScene.fitTo() scaling/letterboxing), clamps to bounds, and tells the
 * player to walk to that point.
 */
export class MovementSystem {
  private readonly root: Container;
  private readonly player: Player;
  private readonly bounds: { width: number; height: number };
  private readonly locations: LocationDef[];
  private readonly margin: number;
  private readonly onClickIntercept?: (localX: number, localY: number) => boolean;
  private readonly isInputBlocked?: () => boolean;
  private attached = false;

  private readonly onPointerDown = (e: FederatedPointerEvent): void => {
    if (this.isInputBlocked?.()) return;
    // Map screen-space pointer into town-local coordinates using the
    // container's matrix. Works regardless of fitTo() scale + letterbox offset.
    const local = this.root.toLocal(e.global);
    // Give the dialog system first crack at the click — if the user clicked
    // an NPC who is within talk range, the click becomes "open dialog"
    // instead of "walk here".
    if (this.onClickIntercept?.(local.x, local.y)) return;
    const target = this.clampTarget(local.x, local.y);
    this.player.moveTo(target.x, target.y);
  };

  constructor(opts: MovementSystemOptions) {
    this.root = opts.townRoot;
    this.player = opts.player;
    this.bounds = opts.bounds;
    this.locations = opts.locations ?? [];
    this.margin = opts.margin ?? 20;
    this.onClickIntercept = opts.onClickIntercept;
    this.isInputBlocked = opts.isInputBlocked;
  }

  attach(): void {
    if (this.attached) return;
    // Make the entire town clickable, including empty grass between locations.
    this.root.eventMode = 'static';
    this.root.hitArea = new Rectangle(0, 0, this.bounds.width, this.bounds.height);
    this.root.cursor = 'pointer';
    this.root.on('pointerdown', this.onPointerDown);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    this.root.off('pointerdown', this.onPointerDown);
    this.root.eventMode = 'auto';
    this.root.hitArea = null;
    // Phase 5.3 bug fix: attach() set cursor='pointer' on the town root, but
    // detach previously left it pointing — so a re-attach (e.g. StrictMode
    // double-mount) saw a stale cursor. Reset to inherit so the page's
    // default cursor takes over until attach() runs again.
    this.root.cursor = 'inherit';
    this.attached = false;
  }

  /**
   * Clamp the click target into the town's outer bounds. Buildings (location
   * rects) are walkable: NPCs do their schedule activities inside them and
   * the player needs to step in to talk. The earlier "snap-out of building"
   * collision was incompatible with that.
   *
   * `locations` is kept as a constructor option so the field still references
   * something — future indoor-scene transition (Phase C) will use it.
   */
  private clampTarget(x: number, y: number): { x: number; y: number } {
    const m = this.margin;
    return {
      x: Math.max(m, Math.min(this.bounds.width - m, x)),
      y: Math.max(m, Math.min(this.bounds.height - m, y)),
    };
  }
}
