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
  private attached = false;

  private readonly onPointerDown = (e: FederatedPointerEvent): void => {
    // Map screen-space pointer into town-local coordinates using the
    // container's matrix. Works regardless of fitTo() scale + letterbox offset.
    const local = this.root.toLocal(e.global);
    const target = this.clampTarget(local.x, local.y);
    this.player.moveTo(target.x, target.y);
  };

  constructor(opts: MovementSystemOptions) {
    this.root = opts.townRoot;
    this.player = opts.player;
    this.bounds = opts.bounds;
    this.locations = opts.locations ?? [];
    this.margin = opts.margin ?? 20;
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
    this.attached = false;
  }

  /** Clamp target into bounds and softly nudge out of location rects. */
  private clampTarget(x: number, y: number): { x: number; y: number } {
    const m = this.margin;
    const cx0 = Math.max(m, Math.min(this.bounds.width - m, x));
    const cy0 = Math.max(m, Math.min(this.bounds.height - m, y));

    const inside = (px: number, py: number, loc: LocationDef): boolean =>
      px > loc.x && px < loc.x + loc.width && py > loc.y && py < loc.y + loc.height;

    const insideAny = (px: number, py: number): boolean =>
      this.locations.some((l) => inside(px, py, l));

    const inBounds = (px: number, py: number): boolean =>
      px >= m && px <= this.bounds.width - m && py >= m && py <= this.bounds.height - m;

    // Find the deepest-overlapping location and try snapping out to each of
    // its four edges. Pick the candidate closest to the original target that
    // is in-bounds and not inside any other location rect. Iterate up to 4
    // times so a snap that lands in an adjacent rect can be re-snapped.
    let cx = cx0;
    let cy = cy0;
    for (let iter = 0; iter < 4; iter++) {
      const overlap = this.locations.find((l) => inside(cx, cy, l));
      if (!overlap) break;

      const candidates = [
        { x: overlap.x - m, y: cy }, // left
        { x: overlap.x + overlap.width + m, y: cy }, // right
        { x: cx, y: overlap.y - m }, // top
        { x: cx, y: overlap.y + overlap.height + m }, // bottom
      ].filter((p) => inBounds(p.x, p.y) && !insideAny(p.x, p.y));

      if (candidates.length === 0) {
        // No valid edge candidate (e.g. building hugs the bounds AND has
        // a neighbor on every other side). Fall back to nearest in-bounds
        // edge of THIS rect even if it overlaps a neighbor — better than
        // staying inside.
        const fallback = [
          { x: overlap.x - m, y: cy },
          { x: overlap.x + overlap.width + m, y: cy },
          { x: cx, y: overlap.y - m },
          { x: cx, y: overlap.y + overlap.height + m },
        ].map((p) => ({
          x: Math.max(m, Math.min(this.bounds.width - m, p.x)),
          y: Math.max(m, Math.min(this.bounds.height - m, p.y)),
        }));
        const best = fallback.reduce((a, b) =>
          (a.x - cx0) ** 2 + (a.y - cy0) ** 2 <= (b.x - cx0) ** 2 + (b.y - cy0) ** 2 ? a : b,
        );
        cx = best.x;
        cy = best.y;
        break;
      }

      const best = candidates.reduce((a, b) =>
        (a.x - cx0) ** 2 + (a.y - cy0) ** 2 <= (b.x - cx0) ** 2 + (b.y - cy0) ** 2 ? a : b,
      );
      cx = best.x;
      cy = best.y;
    }

    return { x: cx, y: cy };
  }
}
