/**
 * EffectSystem — Phase 5.2 (Issue #15 시각 이펙트 / 감정 표현 이펙트).
 *
 * Reference: requirements.md Quality Standards (살아있는 NPC AI / 매끄러운
 * 60fps), DESIGN.md §"Frontend Structure" systems layer.
 *
 * Responsibilities
 * ----------------
 *   - Own a dedicated PixiJS Container ("effects layer") that sits ABOVE
 *     entities so floating hearts / sparkles / surprise marks render on top.
 *   - Spawn short-lived particle entities driven by per-particle update()
 *     ticked from GameScene.update(dt). Particles auto-destroy on expiry.
 *   - Cap concurrent particles (MAX_PARTICLES) so a runaway storm doesn't
 *     hurt the 60fps budget on the RPi target. Excess spawns are silently
 *     dropped (oldest-first), not queued — this keeps the cost predictable.
 *
 * Why PixiJS Graphics + manual update (no extra deps)?
 * ----------------------------------------------------
 *   PixiJS v8 ships an official ParticleContainer but the issue forbids
 *   new dependencies. A handful of small Graphics with hand-rolled physics
 *   is well under our frame budget for the visual densities we need (4
 *   hearts / sparkles per event, a few times per minute).
 *
 * StrictMode lifecycle
 * --------------------
 *   The system owns its layer container and registers it under the parent
 *   provided by GameScene. `destroy()` is called from GameScene.destroy()
 *   and clears every active particle so a re-mounted scene starts clean.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { EntityManager } from '@/entities/EntityManager';

/**
 * Hard cap on simultaneous particles. Exceeded spawns drop the oldest to
 * stay under the budget. 60 is comfortable for the RPi target — each
 * particle is a tiny Graphics, not a sprite, so the per-frame cost is a
 * few microseconds per particle.
 */
const MAX_PARTICLES = 60;

/** Internal particle base — every effect sub-class extends this. */
abstract class Particle {
  readonly view: Container;
  age = 0;
  /** Lifetime in seconds. Once age >= life the particle is destroyed. */
  protected readonly life: number;
  protected vx: number;
  protected vy: number;

  constructor(view: Container, life: number, vx = 0, vy = 0) {
    this.view = view;
    this.life = life;
    this.vx = vx;
    this.vy = vy;
  }

  get alive(): boolean {
    return this.age < this.life;
  }

  /** Return true while alive; subclass updates view properties from age. */
  update(dt: number): boolean {
    this.age += dt;
    this.view.x += this.vx * dt;
    this.view.y += this.vy * dt;
    this.tick(dt);
    return this.alive;
  }

  /** Subclass-specific per-frame logic (alpha curve, scale, etc.). */
  protected abstract tick(dt: number): void;

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

class HeartParticle extends Particle {
  constructor(x: number, y: number) {
    const g = new Graphics();
    // Simple heart shape — two circles + a triangle. 8px wide; small enough
    // to not visually clobber the NPC head.
    g.circle(-3, -2, 3).fill({ color: 0xff5e8a });
    g.circle(3, -2, 3).fill({ color: 0xff5e8a });
    g.moveTo(-5.5, 0).lineTo(5.5, 0).lineTo(0, 6).closePath().fill({ color: 0xff5e8a });
    g.x = x;
    g.y = y;
    g.eventMode = 'none';
    super(g, 1.4, 0, -38); // floats upward
  }

  protected tick(_dt: number): void {
    const t = this.age / this.life;
    // Gentle horizontal sway via sine of age.
    this.view.x += Math.sin(this.age * 6) * 0.4;
    // Fade out over the second half.
    this.view.alpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
    // Subtle pulse scale.
    const s = 1 + Math.sin(this.age * 8) * 0.06;
    this.view.scale.set(s);
  }
}

class CloudParticle extends Particle {
  constructor(x: number, y: number) {
    const g = new Graphics();
    g.circle(-4, 0, 4).fill({ color: 0x6b7280 });
    g.circle(0, -3, 5).fill({ color: 0x6b7280 });
    g.circle(4, 0, 4).fill({ color: 0x6b7280 });
    g.x = x;
    g.y = y;
    g.alpha = 0.85;
    g.eventMode = 'none';
    super(g, 1.6, 0, -22);
  }

  protected tick(_dt: number): void {
    const t = this.age / this.life;
    this.view.alpha = Math.max(0, 0.85 * (1 - t));
    const s = 1 + t * 0.4;
    this.view.scale.set(s);
  }
}

class SparkleParticle extends Particle {
  constructor(x: number, y: number, vx: number, vy: number) {
    const g = new Graphics();
    // 4-point star — a diamond with extra cross arms for sparkle.
    g.moveTo(0, -5).lineTo(1.2, -1.2).lineTo(5, 0).lineTo(1.2, 1.2)
      .lineTo(0, 5).lineTo(-1.2, 1.2).lineTo(-5, 0).lineTo(-1.2, -1.2)
      .closePath()
      .fill({ color: 0xffd166 });
    g.x = x;
    g.y = y;
    g.eventMode = 'none';
    super(g, 0.9, vx, vy);
  }

  protected tick(dt: number): void {
    // Gravity pulls sparkles down slowly so the burst arcs.
    this.vy += 60 * dt;
    const t = this.age / this.life;
    this.view.alpha = Math.max(0, 1 - t);
    this.view.rotation += dt * 6;
  }
}

class SurpriseParticle extends Particle {
  constructor(x: number, y: number) {
    const text = new Text({
      text: '!',
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 22,
        fontWeight: '900',
        fill: 0xffffff,
        stroke: { color: 0x1a1a2e, width: 3, alpha: 0.95 },
      },
    });
    text.anchor.set(0.5, 1);
    text.x = x;
    text.y = y;
    text.eventMode = 'none';
    super(text, 0.9, 0, -16);
  }

  protected tick(_dt: number): void {
    const t = this.age / this.life;
    // Pop in scale, then settle, then fade.
    const scaleIn = Math.min(1, this.age / 0.12);
    const overshoot = scaleIn < 1 ? scaleIn * 1.25 : 1 + Math.sin(this.age * 10) * 0.04;
    this.view.scale.set(overshoot);
    this.view.alpha = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);
  }
}

export interface EffectSystemDeps {
  /** Container the effects layer is attached to (typically `scene.root`). */
  parent: Container;
  /**
   * EntityManager so the system can resolve npc-id → world coordinates for
   * `spawnAffinityEffect()` without GameScene having to look them up.
   */
  entityManager: EntityManager;
}

export class EffectSystem {
  private readonly parent: Container;
  private readonly entityManager: EntityManager;
  /** Container for all effect graphics. Above entities, below UI. */
  readonly layer: Container;
  private readonly particles: Particle[] = [];
  private destroyed = false;

  constructor(deps: EffectSystemDeps) {
    this.parent = deps.parent;
    this.entityManager = deps.entityManager;
    this.layer = new Container();
    this.layer.label = 'effects-layer';
    // Effects are decorative — never swallow pointer events.
    this.layer.eventMode = 'none';
    this.parent.addChild(this.layer);
  }

  /**
   * Per-frame tick. Called from GameScene.update(dt). Drops expired
   * particles and runs the per-particle update routine. O(n) on the active
   * count, which is bounded by MAX_PARTICLES.
   */
  update(dt: number): void {
    if (this.destroyed) return;
    // Iterate backwards so we can splice without shifting indexes.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      const alive = p.update(dt);
      if (!alive) {
        p.destroy();
        this.particles.splice(i, 1);
      }
    }
  }

  /**
   * Public dispatch keyed on a per-NPC affinity delta.
   *   delta > 0 → 3 floating hearts above the NPC's head.
   *   delta < 0 → 1 gray cloud puff.
   *   delta === 0 → no effect (avoid noise).
   */
  spawnAffinityEffect(npcId: string, delta: number): void {
    if (this.destroyed) return;
    if (delta === 0) return;
    const npc = this.entityManager.getNPC(npcId);
    if (!npc) return;
    // Stagger the hearts horizontally so they don't all overlap.
    if (delta > 0) {
      for (let i = 0; i < 3; i++) {
        const offsetX = (i - 1) * 8;
        const offsetY = -28 + (i % 2) * -3;
        this.add(new HeartParticle(npc.x + offsetX, npc.y + offsetY));
      }
    } else {
      this.add(new CloudParticle(npc.x, npc.y - 26));
    }
  }

  /** Burst of 8 sparkles around a viewport position (PixiJS-local coords). */
  spawnSparkles(x: number, y: number): void {
    if (this.destroyed) return;
    const COUNT = 8;
    for (let i = 0; i < COUNT; i++) {
      const angle = (i / COUNT) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 80 + Math.random() * 60;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed - 40; // bias upward
      this.add(new SparkleParticle(x, y, vx, vy));
    }
  }

  /**
   * Spawn a "!" surprise mark above an NPC (or anywhere via x,y) — used as
   * a subtle visual cue when a story event begins. Falls back to scene
   * center if no NPC is provided.
   */
  spawnSurprise(npcId: string | null, fallback: { x: number; y: number }): void {
    if (this.destroyed) return;
    let x = fallback.x;
    let y = fallback.y;
    if (npcId) {
      const npc = this.entityManager.getNPC(npcId);
      if (npc) {
        x = npc.x;
        y = npc.y - 28;
      }
    }
    this.add(new SurpriseParticle(x, y));
  }

  /** Tear down — destroy all particles and the layer container. */
  destroy(): void {
    this.destroyed = true;
    for (const p of this.particles) p.destroy();
    this.particles.length = 0;
    this.layer.destroy({ children: true });
  }

  // --- internals ----------------------------------------------------------

  private add(p: Particle): void {
    if (this.destroyed) return;
    // Trim oldest if we'd exceed the cap.
    while (this.particles.length >= MAX_PARTICLES) {
      const dead = this.particles.shift();
      if (dead) dead.destroy();
    }
    this.layer.addChild(p.view);
    this.particles.push(p);
  }
}
