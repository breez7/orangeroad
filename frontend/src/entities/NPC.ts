import { Container, Graphics, Text } from 'pixi.js';

/**
 * Static-time NPC definition. Phase 2.1: position + appearance only.
 * Future phases (2.2+) will extend NPCState with emotion, context, schedule, etc.
 */
export interface NPCDef {
  /** Stable id (matches gameStore key). */
  id: string;
  /** Display name in Korean. */
  name: string;
  /** Body color hue (placeholder until sprite art lands). */
  color: number;
  /** Spawn position in town-local coordinates. */
  spawn: { x: number; y: number };
  /** Initial location id (FR-001 NPC location state). May be null if outdoors. */
  locationId?: string | null;
}

export interface NPCOptions {
  /** Optional override for the head/skin color. */
  headColor?: number;
}

/**
 * NPC entity (FR-001, FR-010).
 *
 * Phase 2.1: stationary placeholder visual + Korean name label. No movement,
 * no AI, no emotion — those land in 2.2 / 2.3 / 3.3.
 *
 * Visual is intentionally similar in shape to Player but distinguishable by
 * color and a thinner outline so the player avatar still pops.
 */
export class NPC {
  readonly id: string;
  readonly name: string;
  readonly view: Container;

  /** Town-local position (matches view.x / view.y). */
  x: number;
  y: number;

  /** Current location id; may be null while travelling between locations. */
  locationId: string | null;

  /** Approximate body radius (matches Player.RADIUS for parity). */
  static readonly RADIUS = 16;

  constructor(def: NPCDef, opts: NPCOptions = {}) {
    this.id = def.id;
    this.name = def.name;
    this.x = def.spawn.x;
    this.y = def.spawn.y;
    this.locationId = def.locationId ?? null;

    const headColor = opts.headColor ?? 0xffd6a5;

    const container = new Container();
    container.label = `npc:${def.id}`;
    container.x = this.x;
    container.y = this.y;

    // Shadow — same footprint as Player so the scene reads consistently.
    const shadow = new Graphics();
    shadow.ellipse(0, 14, 13, 4.5);
    shadow.fill({ color: 0x000000, alpha: 0.3 });
    container.addChild(shadow);

    // Body (rounded rect). Slightly thinner outline than Player so the
    // player avatar remains visually dominant.
    const body = new Graphics();
    body.roundRect(-9, -5, 18, 20, 5);
    body.fill({ color: def.color });
    body.stroke({ color: 0x1a1a2e, width: 1.5, alpha: 0.85 });
    container.addChild(body);

    // Head
    const head = new Graphics();
    head.circle(0, -13, 7);
    head.fill({ color: headColor });
    head.stroke({ color: 0x1a1a2e, width: 1.5, alpha: 0.85 });
    container.addChild(head);

    // Korean name label above head. Drop shadow ensures readability over
    // both the dark ground and the colored building tiles.
    const label = new Text({
      text: def.name,
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        fontWeight: '600',
        fill: 0xf4f1de,
        align: 'center',
        stroke: { color: 0x1a1a2e, width: 3, alpha: 0.95 },
        dropShadow: {
          color: 0x000000,
          alpha: 0.5,
          blur: 2,
          distance: 1,
          angle: Math.PI / 2,
        },
      },
    });
    label.anchor.set(0.5, 1);
    label.x = 0;
    label.y = -22;
    // Label is decoration only — never swallow pointer events.
    label.eventMode = 'none';
    container.addChild(label);

    this.view = container;
  }

  /**
   * Per-frame update. Phase 2.1 NPCs are stationary, so this is a no-op stub.
   * Phase 2.2/2.3 will introduce AI-driven movement here.
   */
  update(_dt: number): void {
    // Intentionally empty — NPCs do not move yet.
  }

  /**
   * Phase 3.2 — restore NPC position + locationId from a save (FR-008).
   * Position is in town-local coords. NPCs don't yet move on their own, so
   * we don't need to cancel any in-flight pathing here.
   */
  teleport(x: number, y: number, locationId: string | null): void {
    this.x = x;
    this.y = y;
    this.view.x = x;
    this.view.y = y;
    this.locationId = locationId;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
