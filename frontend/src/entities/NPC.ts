import { Container, Graphics, Text } from 'pixi.js';
import { useGameStore, type Emotion } from '@/store/gameStore';
import {
  getAppearance,
  type NPCAppearance,
} from '@/data/appearance';

/**
 * Static-time NPC definition. Phase 2.1: position + appearance only.
 * Future phases (2.2+) will extend NPCState with emotion, context, schedule, etc.
 */
export interface NPCDef {
  /** Stable id (matches gameStore key). */
  id: string;
  /** Display name in Korean. */
  name: string;
  /** Body color hue (legacy placeholder; superseded by appearance config). */
  color: number;
  /** Spawn position in town-local coordinates. */
  spawn: { x: number; y: number };
  /** Initial location id (FR-001 NPC location state). May be null if outdoors. */
  locationId?: string | null;
}

export interface NPCOptions {
  /** Optional override for appearance (test seam). */
  appearance?: NPCAppearance;
}

/**
 * NPC entity (FR-001, FR-010, Phase B-1).
 *
 * Visual is built from layered Graphics primitives — no external sprite
 * assets. Layers, bottom to top:
 *   1. Highlight ring (Phase A-2; invisible by default).
 *   2. Shadow.
 *   3. Bottom (pants / skirt rect).
 *   4. Shirt rect (slightly tapered shoulders).
 *   5. Skin head + neck.
 *   6. Hair back layer (varies per style).
 *   7. Face — repainted by `setEmotion()`.
 *   8. Hair front (bangs / fringe — drawn over face so it frames the eyes).
 *   9. Optional accessory (glasses).
 *  10. Korean name label.
 *
 * The character's footprint is roughly 16-20px logical radius — same as the
 * Player so MovementSystem's clamp + DialogSystem's interact radius (#18, #19)
 * still feel right.
 *
 * Phase B-1 also wires a per-instance subscription to the relationship slice
 * so the face redraws when the store-owned emotion changes.
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

  /**
   * Phase A-2 — interactable hint. The ring is drawn underneath the body at
   * z-order index 0 of the container, breathes with a sine wave when active,
   * and is invisible when inactive. The DialogSystem-driven hint loop in
   * GameScene calls `setHighlight(true)` for the NPC closest to the player
   * within talk range, and `setHighlight(false)` for everyone else.
   */
  private readonly highlightRing: Graphics;
  private highlightActive = false;
  private highlightPhase = 0;

  /** Phase B-1 — face layer is repainted on emotion change. */
  private readonly face: Graphics;
  private currentEmotion: Emotion = 'neutral';

  /** Cached appearance so we can repaint the face without lookups. */
  private readonly appearance: NPCAppearance;

  /** Zustand subscription handle so we can clean up on destroy(). */
  private readonly unsubscribeRelationship: () => void;

  constructor(def: NPCDef, opts: NPCOptions = {}) {
    this.id = def.id;
    this.name = def.name;
    this.x = def.spawn.x;
    this.y = def.spawn.y;
    this.locationId = def.locationId ?? null;
    this.appearance = opts.appearance ?? getAppearance(def.id);

    const container = new Container();
    container.label = `npc:${def.id}`;
    container.x = this.x;
    container.y = this.y;

    // (1) Highlight ring — drawn first so the body sits on top. Repainted
    // per-frame in `update()` when active so we can breathe the alpha/scale;
    // invisible by default.
    this.highlightRing = new Graphics();
    this.highlightRing.visible = false;
    container.addChild(this.highlightRing);

    // (2) Shadow — same footprint as Player so the scene reads consistently.
    const shadow = new Graphics();
    shadow.ellipse(0, 14, 13, 4.5);
    shadow.fill({ color: 0x000000, alpha: 0.3 });
    container.addChild(shadow);

    // (3-4) Body silhouette: bottom (pants/skirt) → shirt. Drawn as separate
    // graphics so colors are clean. Skirt gets a trapezoid; pants stay square.
    const bottom = new Graphics();
    if (this.appearance.bottomKind === 'skirt') {
      // Trapezoid that flares slightly outward for a skirt silhouette.
      bottom.poly([
        -7, 6,
        7, 6,
        10, 14,
        -10, 14,
      ]);
    } else {
      // Two narrow legs joined at the waist for a pants silhouette.
      bottom.rect(-7, 6, 14, 9);
    }
    bottom.fill({ color: this.appearance.bottomColor });
    bottom.stroke({ color: 0x1a1a2e, width: 1.25, alpha: 0.85 });
    container.addChild(bottom);

    // Shirt — slightly tapered at the shoulders so the SD figure reads as
    // human rather than a brick.
    const shirt = new Graphics();
    shirt.poly([
      -7, -4,        // left shoulder
      7, -4,         // right shoulder
      8, 6,          // right hip
      -8, 6,         // left hip
    ]);
    shirt.fill({ color: this.appearance.shirtColor });
    shirt.stroke({ color: 0x1a1a2e, width: 1.25, alpha: 0.85 });
    container.addChild(shirt);

    // Tiny neck stub between body and head so the head doesn't float.
    const neck = new Graphics();
    neck.rect(-2, -7, 4, 3);
    neck.fill({ color: this.appearance.skinColor });
    container.addChild(neck);

    // (5) Head — slightly oval skin shape.
    const head = new Graphics();
    head.ellipse(0, -13, 7, 7.5);
    head.fill({ color: this.appearance.skinColor });
    head.stroke({ color: 0x1a1a2e, width: 1.25, alpha: 0.85 });
    container.addChild(head);

    // (6) Hair BACK layer — depends on style.
    const hairBack = new Graphics();
    this.drawHairBack(hairBack, this.appearance);
    container.addChild(hairBack);

    // (7) Face layer — eyes / mouth / blush. Repainted by setEmotion().
    this.face = new Graphics();
    container.addChild(this.face);

    // (8) Hair FRONT layer — bangs/fringe drawn on top of the face so the
    // eyes peek out from underneath.
    const hairFront = new Graphics();
    this.drawHairFront(hairFront, this.appearance);
    container.addChild(hairFront);

    // (9) Accessory (glasses). Drawn after the face/hairFront so the frame
    // sits on top of everything.
    if (this.appearance.accessory === 'glasses') {
      const glasses = new Graphics();
      // Two small circles + bridge.
      glasses.circle(-2.5, -13, 2);
      glasses.circle(2.5, -13, 2);
      glasses.stroke({ color: 0x1a1a2e, width: 1, alpha: 0.95 });
      glasses.moveTo(-0.5, -13).lineTo(0.5, -13);
      glasses.stroke({ color: 0x1a1a2e, width: 1, alpha: 0.95 });
      container.addChild(glasses);
    }

    // (10) Korean name label above head. Drop shadow ensures readability over
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

    // Pull initial emotion from the store and paint the face. Reading from
    // the store on construction means a freshly-loaded save's emotion is
    // reflected on first paint without waiting for the next subscriber tick.
    const initial = useGameStore.getState().relationships[def.id]?.emotion;
    this.currentEmotion = initial ?? 'neutral';
    this.repaintFace();

    // Subscribe to relationship-slice changes — repaint face only when THIS
    // NPC's emotion changed. Zustand `subscribe` returns an unsubscribe fn
    // we hold onto for `destroy()`.
    this.unsubscribeRelationship = useGameStore.subscribe((state, prev) => {
      const cur = state.relationships[this.id]?.emotion;
      const old = prev.relationships[this.id]?.emotion;
      if (cur && cur !== old) {
        this.setEmotion(cur);
      }
    });
  }

  /**
   * Per-frame update. NPCs are stationary (movement is via teleport from
   * ScheduleSystem) but we tick the highlight ring's breathe animation here
   * so the visual is buttery rather than constant.
   */
  update(dt: number): void {
    if (!this.highlightActive) return;
    this.highlightPhase += dt;
    // Sin wave 0..1 at ~1.5 Hz. Keeps the ring breathing without being noisy.
    const t = (Math.sin(this.highlightPhase * Math.PI * 1.5) + 1) / 2;
    const alpha = 0.45 + 0.35 * t; // 0.45..0.80
    const radius = 22 + 4 * t; // 22..26
    this.highlightRing.clear();
    this.highlightRing.circle(0, 4, radius);
    this.highlightRing.stroke({ color: 0xffd166, width: 3, alpha });
  }

  /**
   * Toggle the in-range hint ring under this NPC. Idempotent.
   */
  setHighlight(active: boolean): void {
    if (this.highlightActive === active) return;
    this.highlightActive = active;
    this.highlightRing.visible = active;
    if (!active) this.highlightRing.clear();
  }

  /**
   * Phase B-1 — repaint the face layer for a new emotion. Idempotent: a no-op
   * when the emotion hasn't changed. Safe to call any number of times.
   */
  setEmotion(emotion: Emotion): void {
    if (this.currentEmotion === emotion) return;
    this.currentEmotion = emotion;
    this.repaintFace();
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
    this.unsubscribeRelationship();
    this.view.destroy({ children: true });
  }

  // -------------------------------------------------------------------------
  // Internal: appearance drawing helpers.
  // -------------------------------------------------------------------------

  /**
   * Hair "back" layer — the silhouette of hair behind the head. Each style
   * draws its own outline. Tied tightly to the head's (-13, ±7.5) footprint.
   */
  private drawHairBack(g: Graphics, a: NPCAppearance): void {
    const hairOutline = { color: 0x1a1a2e, width: 1, alpha: 0.85 };

    switch (a.hairStyle) {
      case 'short':
        // Skull cap — small ellipse covering the top half of the head.
        g.ellipse(0, -15, 7.5, 6);
        g.fill({ color: a.hairColor });
        g.stroke(hairOutline);
        break;

      case 'medium':
        // Reaches just below the chin. Drawn as a rounded rect behind the head.
        g.roundRect(-8, -19, 16, 16, 6);
        g.fill({ color: a.hairColor });
        g.stroke(hairOutline);
        break;

      case 'long':
        // Long hair flowing down to the shoulders. A tall rounded rect that
        // sits behind both head and shoulders.
        g.roundRect(-8.5, -19, 17, 24, 6);
        g.fill({ color: a.hairColor });
        g.stroke(hairOutline);
        break;

      case 'ponytail':
        // Skull cap + a tied tail behind the head/shoulders.
        g.ellipse(0, -15, 7.5, 6);
        g.fill({ color: a.hairColor });
        g.stroke(hairOutline);
        // Ponytail trailing to the right; offset slightly so it reads as 3D.
        g.ellipse(6, -10, 3, 7);
        g.fill({ color: a.hairColor });
        g.stroke(hairOutline);
        break;

      case 'twintails': {
        // Two small bunches on either side of the head.
        g.ellipse(0, -15, 7.5, 6);
        g.fill({ color: a.hairColor });
        g.stroke(hairOutline);
        g.ellipse(-8, -10, 3, 6);
        g.fill({ color: a.hairColor });
        g.stroke(hairOutline);
        g.ellipse(8, -10, 3, 6);
        g.fill({ color: a.hairColor });
        g.stroke(hairOutline);
        break;
      }

      case 'bob':
        // Chin-length symmetric hair — squared-off rounded rect.
        g.roundRect(-8, -19, 16, 13, 4);
        g.fill({ color: a.hairColor });
        g.stroke(hairOutline);
        break;
    }
  }

  /**
   * Hair "front" layer — bangs/fringe drawn over the face so eyes peek
   * through. Kept minimal to avoid covering the emotion-driven face.
   */
  private drawHairFront(g: Graphics, a: NPCAppearance): void {
    const fill = { color: a.hairColor };

    switch (a.hairStyle) {
      case 'short':
        // Side-swept bang on the left.
        g.poly([-7, -16, 4, -16, -3, -11]);
        g.fill(fill);
        break;

      case 'medium':
        // Center-parted bangs.
        g.poly([-7, -17, 0, -16, 7, -17, 4, -11, -4, -11]);
        g.fill(fill);
        break;

      case 'long':
        // Heavy straight bangs covering the forehead.
        g.rect(-7, -19, 14, 6);
        g.fill(fill);
        // Tiny fringe peaks dipping into the eye area.
        g.poly([-4, -13, -2, -10, 0, -13, 2, -10, 4, -13]);
        g.fill(fill);
        break;

      case 'ponytail':
        // Side-swept bangs.
        g.poly([-7, -17, 5, -17, 0, -11, -4, -11]);
        g.fill(fill);
        break;

      case 'twintails':
        // Cute centered bangs.
        g.poly([-6, -17, 6, -17, 4, -12, 0, -10, -4, -12]);
        g.fill(fill);
        break;

      case 'bob':
        // Straight, blunt bangs across the forehead.
        g.rect(-7, -17, 14, 5);
        g.fill(fill);
        break;
    }
  }

  /**
   * Repaint the face layer for the current emotion. Eye / mouth / blush
   * geometry differs per emotion; the rest of the body stays untouched.
   */
  private repaintFace(): void {
    const g = this.face;
    g.clear();

    // Anchor coordinates for face features inside the head ellipse.
    const eyeY = -13;
    const eyeLX = -2.5;
    const eyeRX = 2.5;
    const mouthY = -10;

    const eyeColor = 0x1a1a2e;
    const mouthColor = 0x4a2a2a;
    const blushColor = 0xff9aa2;

    switch (this.currentEmotion) {
      case 'happy': {
        // Curved-up eyes (small upward arcs) + smile.
        this.drawArcEyes(g, eyeLX, eyeRX, eyeY, true);
        // Smile: small upward arc.
        g.moveTo(-2, mouthY).quadraticCurveTo(0, mouthY + 1.6, 2, mouthY);
        g.stroke({ color: mouthColor, width: 1, alpha: 1 });
        break;
      }

      case 'sad': {
        // Slight downturned eyes (drawn as small dots with a tiny stroke
        // dropping at the outer corners).
        g.circle(eyeLX, eyeY, 0.7);
        g.circle(eyeRX, eyeY, 0.7);
        g.fill({ color: eyeColor });
        // ︵ shaped mouth (downturned arc).
        g.moveTo(-2, mouthY + 0.4).quadraticCurveTo(0, mouthY - 1.2, 2, mouthY + 0.4);
        g.stroke({ color: mouthColor, width: 1, alpha: 1 });
        break;
      }

      case 'angry': {
        // Eyes — small dots.
        g.circle(eyeLX, eyeY, 0.8);
        g.circle(eyeRX, eyeY, 0.8);
        g.fill({ color: eyeColor });
        // Angled eyebrows above the eyes.
        g.moveTo(eyeLX - 1.6, eyeY - 2.5).lineTo(eyeLX + 1.4, eyeY - 1.4);
        g.stroke({ color: eyeColor, width: 1, alpha: 1 });
        g.moveTo(eyeRX + 1.6, eyeY - 2.5).lineTo(eyeRX - 1.4, eyeY - 1.4);
        g.stroke({ color: eyeColor, width: 1, alpha: 1 });
        // Tight mouth — short flat line.
        g.moveTo(-1.3, mouthY).lineTo(1.3, mouthY);
        g.stroke({ color: mouthColor, width: 1.2, alpha: 1 });
        break;
      }

      case 'shy': {
        // Closed/squinty eyes — small horizontal lines.
        g.moveTo(eyeLX - 1.3, eyeY).lineTo(eyeLX + 1.3, eyeY);
        g.stroke({ color: eyeColor, width: 1, alpha: 1 });
        g.moveTo(eyeRX - 1.3, eyeY).lineTo(eyeRX + 1.3, eyeY);
        g.stroke({ color: eyeColor, width: 1, alpha: 1 });
        // Small dot mouth.
        g.circle(0, mouthY, 0.6);
        g.fill({ color: mouthColor });
        // Cheek blush dots.
        g.circle(-4.5, -11, 1.1);
        g.circle(4.5, -11, 1.1);
        g.fill({ color: blushColor, alpha: 0.7 });
        break;
      }

      case 'flirty': {
        // Half-closed (lidded) eyes — short downward arcs.
        this.drawArcEyes(g, eyeLX, eyeRX, eyeY, false);
        // ‿ small smile.
        g.moveTo(-1.6, mouthY).quadraticCurveTo(0, mouthY + 1.4, 1.6, mouthY);
        g.stroke({ color: mouthColor, width: 1, alpha: 1 });
        // Cheek blush.
        g.circle(-4.5, -11, 1.1);
        g.circle(4.5, -11, 1.1);
        g.fill({ color: blushColor, alpha: 0.65 });
        break;
      }

      case 'annoyed': {
        // Half-closed eyes (lidded look) + flat-tight mouth.
        this.drawArcEyes(g, eyeLX, eyeRX, eyeY, false);
        // Slight downward eyebrows.
        g.moveTo(eyeLX - 1.6, eyeY - 2.2).lineTo(eyeLX + 1.4, eyeY - 1.6);
        g.stroke({ color: eyeColor, width: 1, alpha: 1 });
        g.moveTo(eyeRX + 1.6, eyeY - 2.2).lineTo(eyeRX - 1.4, eyeY - 1.6);
        g.stroke({ color: eyeColor, width: 1, alpha: 1 });
        // Flat mouth shifted slightly.
        g.moveTo(-1.5, mouthY).lineTo(1.2, mouthY + 0.2);
        g.stroke({ color: mouthColor, width: 1.1, alpha: 1 });
        break;
      }

      case 'neutral':
      default: {
        // Straight eyes — small filled dots.
        g.circle(eyeLX, eyeY, 0.8);
        g.circle(eyeRX, eyeY, 0.8);
        g.fill({ color: eyeColor });
        // Small flat mouth.
        g.moveTo(-1.2, mouthY).lineTo(1.2, mouthY);
        g.stroke({ color: mouthColor, width: 1, alpha: 1 });
        break;
      }
    }
  }

  /**
   * Helper — draw curved eye strokes. `upward=true` produces happy crescents
   * (∪-shape, ends going up); `upward=false` produces lidded/flirty eyes
   * (∩-shape, ends going down).
   */
  private drawArcEyes(
    g: Graphics,
    lx: number,
    rx: number,
    cy: number,
    upward: boolean,
  ): void {
    const dy = upward ? -1.4 : 1.4;
    const startY = upward ? cy + 0.4 : cy - 0.4;
    g.moveTo(lx - 1.4, startY).quadraticCurveTo(lx, cy + dy, lx + 1.4, startY);
    g.stroke({ color: 0x1a1a2e, width: 1, alpha: 1 });
    g.moveTo(rx - 1.4, startY).quadraticCurveTo(rx, cy + dy, rx + 1.4, startY);
    g.stroke({ color: 0x1a1a2e, width: 1, alpha: 1 });
  }
}
