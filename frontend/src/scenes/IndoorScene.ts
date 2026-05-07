import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import { Player } from '@/entities/Player';
import { EntityManager } from '@/entities/EntityManager';
import { NPCS } from '@/data/npcs';
import { MovementSystem } from '@/systems/MovementSystem';
import { DialogSystem } from '@/systems/DialogSystem';
import { TimeSystem } from '@/systems/TimeSystem';
import { SaveSystem } from '@/systems/SaveSystem';
import { StorySystem } from '@/systems/StorySystem';
import { ScheduleSystem } from '@/systems/ScheduleSystem';
import { EffectSystem } from '@/systems/EffectSystem';
import type { AudioEngine } from '@/audio/AudioEngine';
import { getIndoorScene, type IndoorSceneDef } from '@/data/indoorScenes';
import { useGameStore } from '@/store/gameStore';

export interface IndoorSceneOptions {
  /** Which indoor room to render. Must match a known IndoorSceneDef.id. */
  sceneId: string;
  /** Shared AudioEngine; same instance used by GameScene. */
  audioEngine: AudioEngine;
  /**
   * Optional override for the player's spawn position in indoor coords. When
   * omitted we use `def.doorReturn`. Save/load passes the saved position so
   * the player materialises where they were when the save was written.
   */
  spawnAt?: { x: number; y: number };
  /**
   * Called when the player walks onto the doorway exit tile. The scene
   * doesn't perform the transition itself — it asks Game.ts (the owner of
   * scene lifetime) to do the swap.
   */
  onRequestExit: () => void;
}

/**
 * Indoor (interior) scene, Issue #23 Phase C.
 *
 * Renders a top-down hand-drawn-feeling room for one of the enterable
 * outdoor locations (school / cafe / kyousuke-home / madoka-home /
 * hikaru-home). Mirrors the GameScene API so Game.ts can swap freely
 * between the two scenes:
 *   - root: Container         — added to / removed from the Pixi stage by Game
 *   - update(dt)              — per-frame tick from the Application ticker
 *   - fitTo(viewW, viewH)     — re-letterbox on viewport resize
 *   - destroy()               — clean teardown of all owned subsystems
 *
 * Each indoor scene owns its own MovementSystem clamped to the room bounds,
 * its own EntityManager (only NPCs whose current schedule matches this
 * scene's id are spawned), and its own DialogSystem / EffectSystem /
 * StorySystem / ScheduleSystem / SaveSystem / TimeSystem instances. State
 * lives in `useGameStore`, so a scene swap is essentially a re-mount that
 * re-reads the store.
 *
 * Z-order (bottom → top):
 *   1. Floor + walls (room background)
 *   2. Furniture (per-room procedural art)
 *   3. Door tile (highlight + exit affordance)
 *   4. NPCs
 *   5. Player
 *   6. Effects layer
 *   7. Banner text
 */
export class IndoorScene {
  readonly root: Container;
  readonly player: Player;
  readonly entityManager: EntityManager;
  readonly dialog: DialogSystem;
  readonly time: TimeSystem;
  readonly save: SaveSystem;
  readonly story: StorySystem;
  readonly schedule: ScheduleSystem;
  readonly effects: EffectSystem;
  readonly def: IndoorSceneDef;

  private readonly movement: MovementSystem;
  private readonly npcLayer: Container;
  private readonly onRequestExit: () => void;
  /** Doorway zone in indoor coords — when player feet enter this we exit. */
  private readonly doorZone: { x: number; y: number; r: number };
  /**
   * True after the player has stepped OFF the door zone at least once. We
   * spawn the player on the door tile, so without this latch the very first
   * `update(dt)` would immediately re-fire `onRequestExit`. Cleared once the
   * player moves further than `doorZone.r * 1.6` away.
   */
  private exitArmed = false;

  constructor(opts: IndoorSceneOptions) {
    const def = getIndoorScene(opts.sceneId);
    if (!def) {
      throw new Error(`IndoorScene: unknown sceneId "${opts.sceneId}"`);
    }
    this.def = def;
    this.onRequestExit = opts.onRequestExit;

    this.root = new Container();
    this.root.label = `indoor-scene:${def.id}`;

    // (1) Floor + walls — varies per scene.
    this.drawRoom(this.root);

    // (2) Furniture — varies per scene id.
    switch (def.id) {
      case 'school':
        this.drawSchoolClassroom(this.root);
        break;
      case 'cafe':
        this.drawCafe(this.root);
        break;
      case 'kyousuke-home':
        this.drawHome(this.root, {
          wall: 0xe9d8b0,
          floor: 0xc89a6c,
          couch: 0xb05a3c,
          rug: 0xa84a3a,
        });
        break;
      case 'madoka-home':
        this.drawHome(this.root, {
          wall: 0xf3eadc,
          floor: 0xd6b88a,
          couch: 0x6c8cbf,
          rug: 0x7da4cf,
        });
        break;
      case 'hikaru-home':
        this.drawHome(this.root, {
          wall: 0xf2d6dc,
          floor: 0xc8a07a,
          couch: 0xff8fa9,
          rug: 0xffd1dc,
        });
        break;
      default:
        // Fallback — empty room with a center text. Should never run for the
        // canonical INDOOR_SCENES set.
        this.drawHome(this.root, {
          wall: 0xe9e9e9,
          floor: 0xb0b0b0,
          couch: 0x808080,
          rug: 0xa0a0a0,
        });
        break;
    }

    // (3) Door tile — highlight + exit text. Coordinates come from the def
    // so the renderer + the doorzone check stay aligned.
    this.doorZone = { x: def.doorReturn.x, y: def.doorReturn.y, r: 36 };
    this.drawDoorTile(this.root, def);

    // (4) NPC layer — populated once on construction with NPCs whose current
    // schedule places them in this room. Subsequent minute ticks update the
    // store's npcSchedules slice; this scene re-reads the slice via the
    // ScheduleSystem path and respawns NPCs that arrive / leave.
    this.npcLayer = new Container();
    this.npcLayer.label = 'indoor-npc-layer';
    this.npcLayer.eventMode = 'none';
    this.root.addChild(this.npcLayer);

    this.entityManager = new EntityManager(this.npcLayer);
    this.spawnRoomNpcs();

    // (5) Player — spawn at saved coords or door return.
    const spawn = opts.spawnAt ?? def.doorReturn;
    this.player = new Player({ x: spawn.x, y: spawn.y, speed: 220 });
    this.root.addChild(this.player.view);
    useGameStore.getState().setPlayerPosition({ x: spawn.x, y: spawn.y });

    // (6) Effects + (7) systems. Same construction order as GameScene so the
    // dialog/story systems pick up the audio + effect references.
    this.effects = new EffectSystem({
      parent: this.root,
      entityManager: this.entityManager,
    });

    this.dialog = new DialogSystem({
      player: this.player,
      entityManager: this.entityManager,
      audioEngine: opts.audioEngine,
      effectSystem: this.effects,
    });

    // Phase C — re-construct the TimeSystem with the store's current clock
    // values so a scene swap mid-game doesn't reset time to the day-1
    // defaults. The constructor's pushSnapshot() then re-emits the same
    // values (no-op for the store-side dedupe).
    {
      const t = useGameStore.getState().time;
      this.time = new TimeSystem({
        startDay: t.day,
        startHour: t.hour,
        startMinute: t.minute,
      });
    }

    this.save = new SaveSystem({
      timeSystem: this.time,
      player: this.player,
      entityManager: this.entityManager,
    });

    this.story = new StorySystem({
      player: this.player,
      timeSystem: this.time,
      audioEngine: opts.audioEngine,
      effectSystem: this.effects,
    });
    // Indoor scenes intentionally do NOT call story.boot() — the ON_START
    // intro should only ever fire from the outdoor scene on first load,
    // and indoor rooms shouldn't kick off ambient story events. Any
    // flag/affinity changes that happen during indoor dialog will be
    // re-evaluated by the outdoor StorySystem's boot() pass on the next
    // exit. `story` is still constructed (rather than null) so the
    // MovementSystem.isInputBlocked + DialogSystem hooks have a stable
    // `isEventActive` reference to read.

    this.schedule = new ScheduleSystem({
      entityManager: this.entityManager,
    });
    // Boot the schedule so NPC counts sync as time passes. Indoor schedule
    // updates are filtered through `applyRoomFilter()` so NPCs that travel
    // out of this room get despawned and arrivals get added.
    this.schedule.boot();

    // Click-to-walk movement clamped to indoor bounds. Same DialogSystem
    // intercept + input-blocked gate as outdoor.
    this.movement = new MovementSystem({
      townRoot: this.root,
      player: this.player,
      bounds: def.bounds,
      onClickIntercept: (lx, ly) => this.dialog.tryOpenAtPoint(lx, ly),
      isInputBlocked: () => this.dialog.isOpen || this.story.isEventActive,
    });
    this.movement.attach();

    // Banner — small Korean label at the top of the indoor canvas.
    const banner = new Text({
      text: def.displayName,
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 18,
        fill: 0xf4f1de,
        align: 'center',
        stroke: { color: 0x1a1a2e, width: 3, alpha: 0.9 },
      },
    });
    banner.anchor.set(0.5, 0);
    banner.x = def.bounds.width / 2;
    banner.y = 12;
    banner.eventMode = 'none';
    this.root.addChild(banner);
  }

  /**
   * Per-frame update. Called from Game.ts ticker; `dt` in seconds.
   */
  update(dt: number): void {
    this.player.update(dt);
    this.entityManager.update(dt);
    this.time.update(dt);
    this.effects.update(dt);

    if (this.player.isMoving) {
      const px = this.player.x;
      const py = this.player.y;
      useGameStore.getState().setPlayerPosition({ x: px, y: py });
    }

    // Doorway exit detection. The player spawns ON the door tile, so we
    // wait until they've walked away (`exitArmed = true`) before treating a
    // re-entry into the door zone as a request to exit. This avoids a
    // self-triggering loop on first render.
    const dx = this.player.x - this.doorZone.x;
    const dy = this.player.y - this.doorZone.y;
    const dist = Math.hypot(dx, dy);
    if (!this.exitArmed) {
      if (dist > this.doorZone.r * 1.6) this.exitArmed = true;
    } else if (dist <= this.doorZone.r) {
      // Disarm so we don't fire twice in the same beat.
      this.exitArmed = false;
      this.onRequestExit();
    }

    this.updateInteractionHints();
    this.applyRoomFilter();
  }

  /**
   * Toggle the highlight ring on every NPC based on player proximity. Mirrors
   * GameScene.updateInteractionHints exactly so the affordance feels the same.
   */
  private updateInteractionHints(): void {
    if (this.dialog.isOpen) {
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

  /**
   * Reconcile the indoor NPC roster with the current schedule slice in the
   * store. NPCs whose schedule.locationId === def.id live here; everyone
   * else gets despawned. ScheduleSystem already teleports NPCs to outdoor
   * coords (centerOf(locationId) + per-id offset) — for indoor we ignore
   * those positions and re-place each present NPC on a deterministic spot
   * inside the room layout.
   *
   * Called every frame but the membership comparison is O(roster size +
   * schedule entries), and only a *delta* triggers the destroy/respawn
   * pass. With ~7 NPCs this is effectively free per frame.
   */
  private applyRoomFilter(): void {
    const want = new Set<string>();
    const schedules = useGameStore.getState().npcSchedules;
    for (const [id, entry] of Object.entries(schedules)) {
      // Player avatar ('kyousuke') never gets spawned as an NPC.
      if (id === 'kyousuke') continue;
      if (entry.locationId === this.def.id) want.add(id);
    }

    // Compare membership: did any NPC arrive or leave?
    const have = new Set<string>(this.entityManager.all().map((n) => n.id));
    if (have.size === want.size) {
      let same = true;
      for (const id of want) {
        if (!have.has(id)) {
          same = false;
          break;
        }
      }
      if (same) return; // No delta; cheap exit.
    }

    this.respawnRoomNpcs(want);
  }

  /** Tear down the current NPC roster and rebuild it from `ids`. */
  private respawnRoomNpcs(ids: Set<string>): void {
    this.entityManager.destroyAll();
    let i = 0;
    const slots = this.computeNpcSlots(ids.size);
    for (const def of NPCS) {
      if (!ids.has(def.id)) continue;
      const slot = slots[i++] ?? this.def.doorReturn;
      this.entityManager.addNPC({
        ...def,
        spawn: { x: slot.x, y: slot.y },
        locationId: this.def.id,
      });
    }
  }

  /**
   * Initial NPC population — read schedules from the store and spawn the
   * matching NPCs at deterministic indoor slots.
   */
  private spawnRoomNpcs(): void {
    const want = new Set<string>();
    const schedules = useGameStore.getState().npcSchedules;
    for (const [id, entry] of Object.entries(schedules)) {
      if (id === 'kyousuke') continue;
      if (entry.locationId === this.def.id) want.add(id);
    }
    if (want.size === 0) return;
    this.respawnRoomNpcs(want);
  }

  /**
   * Deterministic indoor NPC slot positions. We hand out slots in a wide
   * arc across the upper-middle of the room so NPCs read as "hanging out
   * in the space" rather than blocking the door tile at the bottom.
   */
  private computeNpcSlots(count: number): Array<{ x: number; y: number }> {
    const cx = this.def.bounds.width / 2;
    const yTop = this.def.bounds.height * 0.4;
    const yMid = this.def.bounds.height * 0.55;
    const slots: Array<{ x: number; y: number }> = [];
    const span = this.def.bounds.width * 0.5;
    if (count <= 0) return slots;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = cx - span / 2 + span * t;
      const y = i % 2 === 0 ? yTop : yMid;
      slots.push({ x, y });
    }
    return slots;
  }

  fitTo(viewWidth: number, viewHeight: number): void {
    const scale = Math.min(
      viewWidth / this.def.bounds.width,
      viewHeight / this.def.bounds.height,
    );
    this.root.scale.set(scale);
    this.root.x = (viewWidth - this.def.bounds.width * scale) / 2;
    this.root.y = (viewHeight - this.def.bounds.height * scale) / 2;
  }

  destroy(): void {
    this.movement.detach();
    this.dialog.destroy();
    this.story.destroy();
    this.schedule.destroy();
    this.effects.destroy();
    // Phase QA-2 — see GameScene.destroy(): fence the save system so a save
    // racing the scene swap can't serialise through the destroyed player.
    this.save.destroy();
    useGameStore.getState().closeDialog();
    this.entityManager.destroyAll();
    this.player.destroy();
    this.root.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // Per-scene drawing helpers. Each takes the scene root and adds layered
  // children to it. Coordinates are in indoor-local space (0,0)..(W,H).
  // ---------------------------------------------------------------------------

  /**
   * Generic room background — a pale wall block + a wooden floor with
   * parallel plank lines. Subclassed by each per-scene draw fn that adds
   * accent colors on top.
   */
  private drawRoom(parent: Container): void {
    const { width: w, height: h } = this.def.bounds;

    // Wall (top 38% of the room).
    const wall = new Graphics();
    wall.rect(0, 0, w, h * 0.38);
    wall.fill({ color: 0xe7d9bd });
    parent.addChild(wall);

    // Floor (rest).
    const floor = new Graphics();
    floor.rect(0, h * 0.38, w, h * 0.62);
    floor.fill({ color: 0xc89a6c });
    parent.addChild(floor);

    // Wooden plank lines — parallel horizontal hairlines across the floor.
    const planks = new Graphics();
    for (let y = h * 0.45; y < h - 4; y += 28) {
      planks.moveTo(8, y).lineTo(w - 8, y);
    }
    planks.stroke({ color: 0x8b6840, width: 1, alpha: 0.45 });
    parent.addChild(planks);

    // Wall/floor seam — soft horizontal band so the wall doesn't look pasted.
    const seam = new Graphics();
    seam.rect(0, h * 0.38 - 2, w, 4);
    seam.fill({ color: 0x9c7a4a, alpha: 0.7 });
    parent.addChild(seam);
  }

  /**
   * School classroom — chalkboard + podium at the top wall, rows of desks
   * with chairs behind them, big right-side windows pouring sunlight.
   */
  private drawSchoolClassroom(parent: Container): void {
    const { width: w, height: h } = this.def.bounds;

    // Repaint walls/floor for this scene's palette (cooler greens for
    // school).
    const wallOverlay = new Graphics();
    wallOverlay.rect(0, 0, w, h * 0.38);
    wallOverlay.fill({ color: 0xdde6c8 });
    parent.addChild(wallOverlay);

    // Big window strip on the right wall — soft yellow gradient feel done
    // with three stacked alpha rectangles.
    const sunStripe = new Graphics();
    sunStripe.rect(w - 220, 30, 200, h * 0.34);
    sunStripe.fill({ color: 0xfff3a8, alpha: 0.85 });
    parent.addChild(sunStripe);

    // Window frame mullions on top of the stripe.
    const frame = new Graphics();
    frame.rect(w - 220, 30, 200, h * 0.34);
    frame.stroke({ color: 0x6b5a3a, width: 3, alpha: 0.95 });
    // Three vertical mullions.
    for (let i = 1; i < 4; i++) {
      const mx = w - 220 + (200 / 4) * i;
      frame.moveTo(mx, 30).lineTo(mx, 30 + h * 0.34);
    }
    // One horizontal mullion.
    frame.moveTo(w - 220, 30 + (h * 0.34) / 2).lineTo(w - 20, 30 + (h * 0.34) / 2);
    frame.stroke({ color: 0x6b5a3a, width: 2, alpha: 0.85 });
    parent.addChild(frame);

    // Sunlight pool on the floor below the window.
    const sunPool = new Graphics();
    sunPool.poly([
      w - 240, h * 0.38,
      w - 0, h * 0.38,
      w - 40, h - 60,
      w - 280, h - 60,
    ]);
    sunPool.fill({ color: 0xfff3a8, alpha: 0.25 });
    parent.addChild(sunPool);

    // Chalkboard — large rectangle on the back wall.
    const board = new Graphics();
    board.roundRect(80, 40, 480, 130, 6);
    board.fill({ color: 0x2a3d2a });
    board.stroke({ color: 0x6b4a2a, width: 4, alpha: 1 });
    parent.addChild(board);
    // Chalk lines (decorative).
    const chalk = new Graphics();
    chalk.moveTo(110, 78).lineTo(420, 78);
    chalk.moveTo(110, 110).lineTo(380, 110);
    chalk.moveTo(110, 140).lineTo(310, 140);
    chalk.stroke({ color: 0xf4f1de, width: 2, alpha: 0.85 });
    parent.addChild(chalk);

    // Podium — small block in front of chalkboard.
    const podium = new Graphics();
    podium.roundRect(280, 200, 80, 50, 4);
    podium.fill({ color: 0x8b6a3a });
    podium.stroke({ color: 0x4a2a1a, width: 2, alpha: 1 });
    parent.addChild(podium);

    // Desks — 3 rows × 4 columns, each with a chair behind. Skip the
    // far-right column where the window-light area is to keep it clear.
    const deskW = 80;
    const deskH = 50;
    const rowYs = [340, 440, 540];
    const colXs = [120, 240, 360, 480];
    const desks = new Graphics();
    for (const ry of rowYs) {
      for (const cx of colXs) {
        // Chair (slightly behind = above the desk in this top-down view).
        desks.roundRect(cx + 14, ry - 22, deskW - 28, 16, 3);
        desks.fill({ color: 0x6b4a2a });
        desks.stroke({ color: 0x3a2a1a, width: 1.5, alpha: 0.9 });
        // Desk surface.
        desks.roundRect(cx, ry, deskW, deskH, 4);
        desks.fill({ color: 0xd6b88a });
        desks.stroke({ color: 0x6b4a2a, width: 1.5, alpha: 0.9 });
      }
    }
    parent.addChild(desks);
  }

  /**
   * Cafe interior — counter at the back with stool circles, a coffee
   * machine outline behind the counter, two round tables with chairs, and
   * three hanging lamps from the ceiling.
   */
  private drawCafe(parent: Container): void {
    const { width: w, height: h } = this.def.bounds;

    // Warmer wall tone for the cafe.
    const wallOverlay = new Graphics();
    wallOverlay.rect(0, 0, w, h * 0.38);
    wallOverlay.fill({ color: 0xe6c8a0 });
    parent.addChild(wallOverlay);

    // Counter — long rectangle at the back wall.
    const counter = new Graphics();
    counter.roundRect(120, 220, w - 240, 60, 6);
    counter.fill({ color: 0x6b4a2a });
    counter.stroke({ color: 0x3a2a1a, width: 3, alpha: 1 });
    parent.addChild(counter);

    // Counter top stripe — slightly lighter so it reads as a polished surface.
    const counterTop = new Graphics();
    counterTop.rect(120, 220, w - 240, 8);
    counterTop.fill({ color: 0xa67b4a, alpha: 0.95 });
    parent.addChild(counterTop);

    // Coffee machine — boxy outline behind the counter (top wall).
    const machine = new Graphics();
    machine.roundRect(w / 2 - 60, 90, 120, 90, 6);
    machine.fill({ color: 0xc0c0c0 });
    machine.stroke({ color: 0x4a4a4a, width: 2, alpha: 1 });
    // Two visible spouts.
    machine.rect(w / 2 - 22, 165, 18, 18);
    machine.rect(w / 2 + 4, 165, 18, 18);
    machine.fill({ color: 0x2a2a2a });
    parent.addChild(machine);

    // Stools at the counter — three circles in front of the counter.
    const stools = new Graphics();
    const stoolY = 310;
    for (const sx of [w / 2 - 200, w / 2, w / 2 + 200]) {
      stools.circle(sx, stoolY, 16);
      stools.fill({ color: 0xc77a3a });
      stools.stroke({ color: 0x3a2a1a, width: 2, alpha: 1 });
    }
    parent.addChild(stools);

    // Round tables with chairs — two tables in the middle of the floor.
    const tablesPositions: Array<[number, number]> = [
      [w * 0.32, h * 0.66],
      [w * 0.68, h * 0.66],
    ];
    const tables = new Graphics();
    for (const [tx, ty] of tablesPositions) {
      // Chairs (4 small circles around the table).
      for (const [dx, dy] of [
        [-30, 0],
        [30, 0],
        [0, -30],
        [0, 30],
      ]) {
        tables.circle(tx + dx, ty + dy, 9);
        tables.fill({ color: 0x6b4a2a });
        tables.stroke({ color: 0x3a2a1a, width: 1.5, alpha: 0.9 });
      }
      // Table top.
      tables.circle(tx, ty, 28);
      tables.fill({ color: 0xd6b88a });
      tables.stroke({ color: 0x6b4a2a, width: 2, alpha: 0.95 });
      // Tiny coffee cup on each table.
      tables.circle(tx - 6, ty - 4, 4);
      tables.fill({ color: 0xf4f1de });
      tables.stroke({ color: 0x6b4a2a, width: 1, alpha: 1 });
    }
    parent.addChild(tables);

    // Hanging lamps — three small circles on lines descending from the top
    // edge. Sits above the counter for ambience.
    const lamps = new Graphics();
    for (const lx of [w / 2 - 220, w / 2, w / 2 + 220]) {
      lamps.moveTo(lx, 0).lineTo(lx, 60);
      lamps.stroke({ color: 0x3a2a1a, width: 1.5, alpha: 0.8 });
      lamps.circle(lx, 70, 10);
      lamps.fill({ color: 0xffd166 });
      lamps.stroke({ color: 0x6b4a2a, width: 1.5, alpha: 1 });
    }
    parent.addChild(lamps);
  }

  /**
   * Living-room layout shared by the three home scenes. Caller passes a
   * palette so each home reads as visually distinct (kyousuke warm-orange,
   * madoka cool-blue, hikaru rose-pink) without us duplicating the
   * geometry per scene.
   */
  private drawHome(
    parent: Container,
    palette: { wall: number; floor: number; couch: number; rug: number },
  ): void {
    const { width: w, height: h } = this.def.bounds;

    // Palette overlay so the base brown floor / pale wall from drawRoom
    // gets re-tinted to this home's signature mood.
    const wallOverlay = new Graphics();
    wallOverlay.rect(0, 0, w, h * 0.38);
    wallOverlay.fill({ color: palette.wall });
    parent.addChild(wallOverlay);

    const floorOverlay = new Graphics();
    floorOverlay.rect(0, h * 0.38, w, h * 0.62);
    floorOverlay.fill({ color: palette.floor });
    parent.addChild(floorOverlay);

    // Plank lines on the re-tinted floor.
    const planks = new Graphics();
    for (let y = h * 0.45; y < h - 4; y += 28) {
      planks.moveTo(8, y).lineTo(w - 8, y);
    }
    planks.stroke({ color: 0x8b6840, width: 1, alpha: 0.35 });
    parent.addChild(planks);

    // Rug — large oval under the table.
    const rug = new Graphics();
    rug.ellipse(w / 2, h * 0.62, 220, 90);
    rug.fill({ color: palette.rug, alpha: 0.85 });
    rug.stroke({ color: 0x6b4a2a, width: 2, alpha: 0.7 });
    parent.addChild(rug);

    // Low table with two cups in the middle of the rug.
    const table = new Graphics();
    table.roundRect(w / 2 - 80, h * 0.6, 160, 50, 6);
    table.fill({ color: 0x8b6a3a });
    table.stroke({ color: 0x4a2a1a, width: 2, alpha: 1 });
    parent.addChild(table);
    const cups = new Graphics();
    cups.circle(w / 2 - 30, h * 0.625, 6);
    cups.circle(w / 2 + 30, h * 0.625, 6);
    cups.fill({ color: 0xf4f1de });
    cups.stroke({ color: 0x6b4a2a, width: 1, alpha: 1 });
    parent.addChild(cups);

    // Couch — long rounded rect at the back of the room with cushion lines.
    const couch = new Graphics();
    const couchX = w / 2 - 200;
    const couchY = h * 0.42;
    couch.roundRect(couchX, couchY, 400, 80, 14);
    couch.fill({ color: palette.couch });
    couch.stroke({ color: 0x3a2a1a, width: 2, alpha: 1 });
    parent.addChild(couch);
    // Cushion seams.
    const seams = new Graphics();
    seams.moveTo(couchX + 130, couchY + 10).lineTo(couchX + 130, couchY + 70);
    seams.moveTo(couchX + 270, couchY + 10).lineTo(couchX + 270, couchY + 70);
    seams.stroke({ color: 0x3a2a1a, width: 1.5, alpha: 0.8 });
    parent.addChild(seams);

    // TV box on a small stand on the LEFT of the room.
    const tv = new Graphics();
    tv.roundRect(60, h * 0.5, 110, 70, 4);
    tv.fill({ color: 0x2a2a2a });
    tv.stroke({ color: 0x1a1a1a, width: 2, alpha: 1 });
    // TV stand.
    tv.roundRect(70, h * 0.5 + 70, 90, 14, 3);
    tv.fill({ color: 0x6b4a2a });
    tv.stroke({ color: 0x3a2a1a, width: 1.5, alpha: 1 });
    // TV screen highlight.
    tv.rect(70, h * 0.5 + 6, 90, 50);
    tv.fill({ color: 0x6b8cbf, alpha: 0.7 });
    parent.addChild(tv);

    // Plant in the right corner.
    const plant = new Graphics();
    plant.roundRect(w - 100, h - 130, 50, 50, 4);
    plant.fill({ color: 0x8b6a3a });
    plant.stroke({ color: 0x3a2a1a, width: 2, alpha: 1 });
    plant.circle(w - 75, h - 140, 30);
    plant.fill({ color: 0x4f8f3a });
    plant.stroke({ color: 0x2a4a1a, width: 2, alpha: 1 });
    plant.circle(w - 95, h - 145, 14);
    plant.fill({ color: 0x6aa84f });
    plant.circle(w - 60, h - 150, 12);
    plant.fill({ color: 0x6aa84f });
    parent.addChild(plant);
  }

  /**
   * Door tile — drawn at `def.doorReturn`. A subtle mat with a highlight
   * ring + the Korean text "나가기 ↓" beside it. Visual-only; the actual
   * exit detection lives in `update(dt)`.
   */
  private drawDoorTile(parent: Container, def: IndoorSceneDef): void {
    const tile = new Graphics();
    tile.roundRect(def.doorReturn.x - 36, def.doorReturn.y - 18, 72, 36, 6);
    tile.fill({ color: 0xc9a26a, alpha: 0.95 });
    tile.stroke({ color: 0x6b4a2a, width: 2, alpha: 1 });
    parent.addChild(tile);

    const ring = new Graphics();
    ring.circle(def.doorReturn.x, def.doorReturn.y, 28);
    ring.stroke({ color: 0xffd166, width: 3, alpha: 0.85 });
    parent.addChild(ring);

    const exitLabel = new Text({
      text: '나가기 ↓',
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 14,
        fontWeight: '700',
        fill: 0xf4f1de,
        align: 'center',
        stroke: { color: 0x1a1a2e, width: 3, alpha: 0.95 },
      },
    });
    exitLabel.anchor.set(0.5, 1);
    exitLabel.x = def.doorReturn.x;
    exitLabel.y = def.doorReturn.y - 26;
    exitLabel.eventMode = 'none';
    parent.addChild(exitLabel);

    // Set hitArea for completeness — MovementSystem.attach() will overwrite
    // this on the root, but pre-setting keeps the rect in sync if anything
    // else ever queries the scene's interactive bounds.
    parent.hitArea = new Rectangle(0, 0, def.bounds.width, def.bounds.height);
  }
}
