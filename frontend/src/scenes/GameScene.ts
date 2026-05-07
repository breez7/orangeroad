import { Container, Graphics, Text } from 'pixi.js';
import { Location } from '@/entities/Location';
import { Player } from '@/entities/Player';
import { EntityManager } from '@/entities/EntityManager';
import { LOCATIONS, TOWN_BOUNDS } from '@/data/locations';
import { hasIndoorScene } from '@/data/indoorScenes';
import { NPCS } from '@/data/npcs';
import { MovementSystem } from '@/systems/MovementSystem';
import { DialogSystem } from '@/systems/DialogSystem';
import { TimeSystem } from '@/systems/TimeSystem';
import { SaveSystem } from '@/systems/SaveSystem';
import { StorySystem } from '@/systems/StorySystem';
import { ScheduleSystem } from '@/systems/ScheduleSystem';
import { EffectSystem } from '@/systems/EffectSystem';
import type { AudioEngine } from '@/audio/AudioEngine';
import { findLocationAt } from '@/data/locations';
import { useGameStore } from '@/store/gameStore';

export interface GameSceneOptions {
  /** Phase 5.2 — shared AudioEngine. Owned by Game.ts, passed in here. */
  audioEngine: AudioEngine;
  /**
   * Phase C (Issue #23) — fires when the player walks into a building's
   * doorway zone on the outdoor map. The scene doesn't perform the
   * transition itself — it asks Game.ts (the owner of scene lifetime) to
   * destroy this scene and mount the matching IndoorScene.
   */
  onRequestEnterIndoor?: (sceneId: string) => void;
  /**
   * Phase C (Issue #23) — optional spawn override. Used after exiting an
   * indoor scene to drop the player at a known outdoorReturn coord rather
   * than the town center.
   */
  spawnAt?: { x: number; y: number };
}

export class GameScene {
  readonly root: Container;
  readonly player: Player;
  readonly entityManager: EntityManager;
  readonly dialog: DialogSystem;
  /**
   * Game clock. Owned by the scene so its lifetime matches the PixiJS world
   * (StrictMode-safe: a fresh scene gets a fresh clock; the discarded one
   * simply stops being ticked). Holds no DOM listeners or timers, so no
   * explicit teardown is required beyond dropping the reference.
   */
  readonly time: TimeSystem;
  /** Phase 3.2 — save/load orchestration (FR-008). */
  readonly save: SaveSystem;
  /** Phase 4.1 — scripted story event playback (FR-006). */
  readonly story: StorySystem;
  /** Phase 4.2 — NPC daily schedule + teleport-on-minute (FR-009). */
  readonly schedule: ScheduleSystem;
  /** Phase 5.2 — particle effects (hearts / sparkles / clouds / surprise). */
  readonly effects: EffectSystem;
  private readonly locations: Location[] = [];
  private readonly movement: MovementSystem;
  private readonly npcLayer: Container;
  /**
   * Phase C (Issue #23) — scene-switch hook. Wired by Game.ts to swap to
   * the matching IndoorScene when the player walks into a doorway zone.
   */
  private readonly onRequestEnterIndoor?: (sceneId: string) => void;
  /**
   * Phase C (Issue #23) — once the player has stepped into a building's
   * doorway zone we set this to the location id and won't re-fire the
   * enter callback until they walk out and back in. Without the latch a
   * single click that lands inside the rect would re-trigger every tick.
   */
  private doorEntryLatch: string | null = null;

  constructor(opts: GameSceneOptions) {
    this.onRequestEnterIndoor = opts.onRequestEnterIndoor;
    this.root = new Container();
    this.root.label = 'game-scene';

    // Base ground — a warm grass-green replacing the old dark teal so the
    // open areas read as lawn rather than abstract void.
    const ground = new Graphics();
    ground.rect(0, 0, TOWN_BOUNDS.width, TOWN_BOUNDS.height);
    ground.fill({ color: 0x4f7a3a });
    this.root.addChild(ground);

    // Grass texture — deterministic dot scatter so reloading doesn't reshuffle
    // the pattern. Pre-baked into a single Graphics object so we pay one
    // draw call regardless of dot count. Avoids the location rects so it
    // doesn't bleed into the buildings' own ground.
    const grass = this.buildGrassTexture();
    this.root.addChild(grass);

    // Subtle reference grid — kept much fainter than before so the new
    // grass+buildings dominate the silhouette but the grid is still useful
    // for spatial debugging.
    const grid = new Graphics();
    const step = 80;
    for (let x = 0; x <= TOWN_BOUNDS.width; x += step) {
      grid.moveTo(x, 0).lineTo(x, TOWN_BOUNDS.height);
    }
    for (let y = 0; y <= TOWN_BOUNDS.height; y += step) {
      grid.moveTo(0, y).lineTo(TOWN_BOUNDS.width, y);
    }
    grid.stroke({ color: 0xffffff, width: 1, alpha: 0.04 });
    this.root.addChild(grid);

    // Town decor layer — sits BELOW the location rects so paths don't paint
    // over the buildings' own front-door geometry. This is the canonical
    // place to draw cross-location decoration like footpaths and outdoor
    // landmarks.
    const townDecor = new Graphics();
    townDecor.label = 'town-decor';
    this.drawConnectingPaths(townDecor);
    this.root.addChild(townDecor);

    for (const def of LOCATIONS) {
      const loc = new Location(def);
      this.root.addChild(loc.view);
      this.locations.push(loc);
    }

    // NPC layer: above buildings, below the player avatar so the player
    // visually walks "in front of" stationary NPCs. Phase 2.1 NPCs don't
    // move, so render order is fixed and we don't need depth-sort yet.
    this.npcLayer = new Container();
    this.npcLayer.label = 'npc-layer';
    // NPCs themselves shouldn't intercept clicks — the town root handles
    // click-to-walk and consumed clicks would create dead zones.
    this.npcLayer.eventMode = 'none';
    this.root.addChild(this.npcLayer);

    this.entityManager = new EntityManager(this.npcLayer);
    for (const def of NPCS) {
      this.entityManager.addNPC(def);
    }

    // Spawn player at the supplied position (used when materialising back
    // outside after an indoor exit) or fall back to town center.
    const spawn = opts.spawnAt ?? {
      x: TOWN_BOUNDS.width / 2,
      y: TOWN_BOUNDS.height / 2,
    };
    this.player = new Player({ x: spawn.x, y: spawn.y, speed: 220 });
    this.root.addChild(this.player.view);
    useGameStore.getState().setPlayerPosition({ x: spawn.x, y: spawn.y });
    // Phase C — if we materialised inside or near a doorway after an exit,
    // arm the latch with that location id so the player walking back out
    // doesn't immediately re-trigger an enter. Cleared on first frame the
    // player is outside any doorway zone.
    {
      const here = findLocationAt(spawn.x, spawn.y);
      if (here && hasIndoorScene(here)) {
        this.doorEntryLatch = here;
      }
    }

    // Phase 5.2 — effect system. Layer is added to the scene root above
    // the NPC layer so particles render on top of entities. Constructed
    // before DialogSystem / StorySystem so we can pass it in for
    // affinity / story cue effects.
    this.effects = new EffectSystem({
      parent: this.root,
      entityManager: this.entityManager,
    });

    // Phase 2.3 — DialogSystem owns NPC-talk interaction state. It is
    // stateless w.r.t. UI (state lives in the Zustand store) and is wired
    // into MovementSystem as a click-interceptor so clicking an NPC in
    // range opens the dialog instead of walking past them.
    // Phase 5.2 — also receives the AudioEngine + EffectSystem so a
    // successful talk turn can fire the matching SFX + particles.
    this.dialog = new DialogSystem({
      player: this.player,
      entityManager: this.entityManager,
      audioEngine: opts.audioEngine,
      effectSystem: this.effects,
    });

    // Phase 3.1 — game clock. Defaults to day 1 (Saturday) 10:30 with the
    // canonical 2s = 1min acceleration from DESIGN.md. The constructor
    // pushes an initial snapshot to the store so TimeDisplay shows the
    // right state on first paint, before any ticker frames have run.
    //
    // Phase C — re-construct from the store's current clock values so a
    // scene swap mid-game (outdoor → indoor → outdoor) doesn't reset time
    // back to the day-1 defaults.
    {
      const t = useGameStore.getState().time;
      this.time = new TimeSystem({
        startDay: t.day,
        startHour: t.hour,
        startMinute: t.minute,
      });
    }

    // Phase 3.2 — save system. No timers, no listeners; safe to construct
    // here and drop with the scene on StrictMode double-invoke.
    this.save = new SaveSystem({
      timeSystem: this.time,
      player: this.player,
      entityManager: this.entityManager,
    });

    // Phase 4.1 — story system. Subscribes to the store + drives event
    // playback. boot() runs the ON_START pass async so an unstarted intro
    // fires after the scene is on screen.
    // Phase 5.2 — also receives the AudioEngine + EffectSystem so events
    // can play a "story-step" SFX on each step + a surprise visual cue
    // when an event begins.
    this.story = new StorySystem({
      player: this.player,
      timeSystem: this.time,
      audioEngine: opts.audioEngine,
      effectSystem: this.effects,
    });
    void this.story.boot();

    // Phase 4.2 — schedule system. Subscribes to time changes and teleports
    // NPCs to their schedule's location each game-minute. The boot() call
    // also kicks off an immediate refresh so first-paint reflects the
    // current time-of-day, not the spawn defaults.
    this.schedule = new ScheduleSystem({
      entityManager: this.entityManager,
    });
    this.schedule.boot();

    // Click-to-walk system. Bind events on the scene root so empty grass
    // between location tiles still registers clicks. The dialog system gets
    // first crack at every click; movement ignores input while dialog OR a
    // scripted story event is open.
    this.movement = new MovementSystem({
      townRoot: this.root,
      player: this.player,
      bounds: TOWN_BOUNDS,
      locations: LOCATIONS,
      onClickIntercept: (lx, ly) => this.dialog.tryOpenAtPoint(lx, ly),
      isInputBlocked: () => this.dialog.isOpen || this.story.isEventActive,
    });
    this.movement.attach();

    const banner = new Text({
      text: '오렌지로드 마을 — Phase 4.2 (일과)',
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 18,
        fill: 0xf4f1de,
        align: 'center',
      },
    });
    banner.anchor.set(0.5, 0);
    banner.x = TOWN_BOUNDS.width / 2;
    banner.y = 12;
    // Banner shouldn't swallow clicks — the scene root is the click target.
    banner.eventMode = 'none';
    this.root.addChild(banner);
  }

  /** Per-frame update; called from Game.ts ticker. `dt` is in seconds. */
  update(dt: number): void {
    this.player.update(dt);
    this.entityManager.update(dt);
    // Tick the clock. Internally this only mutates the store on game-minute
    // boundaries (default: ~once per real-second), not every frame.
    // TimeSystem.pause() (called by StorySystem during scripted playback)
    // makes update() a no-op while a story event is playing.
    this.time.update(dt);
    // Phase 5.2 — tick particle effects. EffectSystem is a no-op when the
    // pool is empty so this costs near-zero per frame between bursts.
    this.effects.update(dt);
    if (this.player.isMoving) {
      const px = this.player.x;
      const py = this.player.y;
      const store = useGameStore.getState();
      store.setPlayerPosition({ x: px, y: py });
      // Phase 4.1 — keep the coarse player-location id fresh so the
      // StorySystem's ON_LOCATION_ENTER trigger has something to evaluate
      // against. Phase A-1: location rects are walkable so this stays in sync
      // with the room the player is standing inside.
      const loc = findLocationAt(px, py);
      if (loc !== store.playerLocationId) {
        store.setPlayerLocationId(loc);
      }
    }
    // Phase C (Issue #23) — doorway entry detection. Even when the player
    // is at rest we evaluate the latch each frame so a teleport that drops
    // them inside a doorway zone (e.g. dev hook) still triggers cleanly.
    this.checkDoorwayEntry();
    this.updateInteractionHints();
  }

  /**
   * Phase C (Issue #23) — doorway entry trigger.
   *
   * Fires when the player has come to rest *inside* an enterable building
   * rect AND within a small doorway disc around the rect's center. The
   * "at rest" requirement (not `isMoving`) keeps the player from being
   * yanked into an indoor scene while they're walking PAST a building on
   * their way to somewhere else — the scene swap should only happen when
   * the user clicked on the building and the player has actually arrived.
   *
   * The `doorEntryLatch` keeps the trigger from re-firing every frame
   * while the player stays inside; it's cleared when the player walks
   * out of every doorway zone.
   *
   * If a transition is already in flight (dialog open, story active) we
   * skip — the indoor scene shouldn't barge over a scripted moment.
   */
  private checkDoorwayEntry(): void {
    if (!this.onRequestEnterIndoor) return;
    if (this.dialog.isOpen || this.story.isEventActive) return;
    const px = this.player.x;
    const py = this.player.y;

    // Doorway disc — generous enough to forgive imprecise clicks, small
    // enough that "walking adjacent" doesn't trigger. Combined with the
    // `isMoving` gate this won't fire on a transient pass-through.
    const ENTER_RADIUS = 60;
    let hit: string | null = null;
    for (const l of LOCATIONS) {
      if (!hasIndoorScene(l.id)) continue;
      // Require the player to be inside the rect AND near the center.
      // The rect-only check would also fire when they merely cross the
      // perimeter; the center-distance check enforces "they really came
      // to the door".
      if (px < l.x || px > l.x + l.width) continue;
      if (py < l.y || py > l.y + l.height) continue;
      const cx = l.x + l.width / 2;
      const cy = l.y + l.height / 2;
      const d = Math.hypot(cx - px, cy - py);
      if (d <= ENTER_RADIUS) {
        hit = l.id;
        break;
      }
    }

    if (hit === null) {
      // Player is outside every doorway zone — clear the latch so the next
      // entry into any zone is treated as fresh.
      this.doorEntryLatch = null;
      return;
    }

    // Don't fire while the player is still walking — wait until they
    // settle inside the doorway. This prevents accidental entries on
    // walk-past trajectories.
    if (this.player.isMoving) return;

    if (this.doorEntryLatch === hit) return; // Already triggered for this zone.
    this.doorEntryLatch = hit;
    this.onRequestEnterIndoor(hit);
  }

  /**
   * Phase A-2 — toggle the highlight ring on every NPC based on player
   * proximity. The dialog system's interact radius is the source of truth so
   * "the NPC is glowing" ↔ "clicking opens dialog right now" is always true.
   */
  private updateInteractionHints(): void {
    if (this.dialog.isOpen) {
      // Don't visually invite clicks while the dialog box is up.
      for (const npc of this.entityManager.all()) npc.setHighlight(false);
      return;
    }
    const px = this.player.x;
    const py = this.player.y;
    for (const npc of this.entityManager.all()) {
      const d = Math.hypot(npc.x - px, npc.y - py);
      npc.setHighlight(d <= this.dialog.interactRadiusValue);
    }
  }

  fitTo(viewWidth: number, viewHeight: number): void {
    const scale = Math.min(
      viewWidth / TOWN_BOUNDS.width,
      viewHeight / TOWN_BOUNDS.height,
    );
    this.root.scale.set(scale);
    this.root.x = (viewWidth - TOWN_BOUNDS.width * scale) / 2;
    this.root.y = (viewHeight - TOWN_BOUNDS.height * scale) / 2;
  }

  /**
   * Phase B-2 — bake the grass texture into a single Graphics object. We
   * pre-compute a deterministic spray of small green-toned dots/dashes
   * across the whole town, skipping the rectangles owned by `LOCATIONS` so
   * the dots don't paint over building decor. Pre-baking means ~200 leaves
   * cost one draw call rather than spawning hundreds of objects.
   */
  private buildGrassTexture(): Graphics {
    const g = new Graphics();
    g.label = 'grass-texture';
    // Cheap deterministic hash — the sample task suggested an xor-mix; we use
    // a similar large-prime hash so the scatter is stable across reloads but
    // not aligned to the underlying grid.
    const hash = (a: number, b: number) =>
      (((a * 73856093) ^ (b * 19349663)) >>> 0) % 100000;

    const stepX = 28;
    const stepY = 28;
    // Tones of green that read as varied grass without being noisy.
    const tones = [0x6aa84f, 0x83b66c, 0x4f8f3a, 0x9bbe7e];
    for (let y = 6; y < TOWN_BOUNDS.height - 6; y += stepY) {
      for (let x = 6; x < TOWN_BOUNDS.width - 6; x += stepX) {
        // Skip dots that would land inside any location rect — the location
        // entity owns those pixels and draws its own ground patch.
        if (this.isPointInsideAnyLocation(x, y)) continue;
        const h1 = hash(x, y);
        // Jitter the position so the texture doesn't show its grid.
        const jx = x + ((h1 % 17) - 8);
        const jy = y + (((h1 / 17) | 0) % 17) - 8;
        if (this.isPointInsideAnyLocation(jx, jy)) continue;
        const tone = tones[h1 % tones.length];
        // 1-in-3 dots become a small dash (line) instead — adds variety.
        if (h1 % 3 === 0) {
          g.moveTo(jx, jy).lineTo(jx + 3, jy - 1);
          g.stroke({ color: tone, width: 1.4, alpha: 0.55 });
        } else {
          g.circle(jx, jy, 1.5);
          g.fill({ color: tone, alpha: 0.65 });
        }
      }
    }
    return g;
  }

  /**
   * Helper for the grass + path layers: is `(x, y)` inside any LOCATIONS rect?
   * Used to keep grass dots from intruding on a building's ground patch and
   * to clip path segments at the front-door target.
   */
  private isPointInsideAnyLocation(x: number, y: number): boolean {
    for (const l of LOCATIONS) {
      if (x >= l.x && x <= l.x + l.width && y >= l.y && y <= l.y + l.height) {
        return true;
      }
    }
    return false;
  }

  /**
   * Phase B-2 — short brown footpaths connecting the front-door area of each
   * building to the central town square (TOWN_BOUNDS center). Drawn into the
   * provided Graphics so all paths share a single draw call. Stroked twice:
   * once with a soft-cream highlight then a darker tan core, which gives the
   * paths a baked-look without textures.
   */
  private drawConnectingPaths(g: Graphics): void {
    const cx = TOWN_BOUNDS.width / 2;
    const cy = TOWN_BOUNDS.height / 2;

    // Each path runs from a "doorstep" anchor outside the location rect to
    // the town center. Anchoring outside the rect (rather than at the door
    // itself) keeps the path from painting over the front-door art.
    const anchors: Array<{ x: number; y: number }> = LOCATIONS.map((l) => ({
      x: l.x + l.width / 2,
      // Anchor 6px outside the rect on whichever edge faces the town center.
      y: l.y + l.height / 2 < cy ? l.y + l.height + 6 : l.y - 6,
    }));

    // Outer halo — soft sandy border so the path edges don't look like a
    // hard cut against the grass.
    for (const a of anchors) {
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo((a.x + cx) / 2, (a.y + cy) / 2 + 4, cx, cy);
    }
    g.stroke({ color: 0xe6cfa3, width: 16, alpha: 0.55 });

    // Core path stroke — warmer tan.
    for (const a of anchors) {
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo((a.x + cx) / 2, (a.y + cy) / 2 + 4, cx, cy);
    }
    g.stroke({ color: 0xc9a26a, width: 10, alpha: 0.95 });

    // Small plaza disc at the town center where all paths meet.
    g.circle(cx, cy, 22);
    g.fill({ color: 0xd6b88a, alpha: 0.95 });
    g.stroke({ color: 0x9c7a4a, width: 1.5, alpha: 0.85 });
  }

  destroy(): void {
    this.movement.detach();
    // Abort any in-flight dialog request and clear UI state — we do this
    // before tearing down entities so the system's references stay valid
    // until its destroy() returns.
    this.dialog.destroy();
    // Phase 4.1 — also tear down the story system (unsubscribes from store +
    // aborts any in-flight event fetch). Active scripted state in the store
    // is intentionally NOT cleared here so a save written mid-event can
    // resume on next load (Phase 4.x).
    this.story.destroy();
    // Phase 4.2 — tear down schedule system (unsubscribe + abort fetch).
    this.schedule.destroy();
    // Phase 5.2 — destroy any in-flight particles before the scene root
    // tears down. The effects layer is a child of root so the root.destroy
    // below would cascade-clean it anyway, but explicit teardown clears
    // the in-memory particle list too.
    this.effects.destroy();
    useGameStore.getState().closeDialog();
    // Tear down NPCs before the parent container goes away so each NPC's
    // own destroy() runs (StrictMode-safe re-init).
    this.entityManager.destroyAll();
    this.player.destroy();
    for (const loc of this.locations) loc.destroy();
    this.locations.length = 0;
    this.root.destroy({ children: true });
  }
}
