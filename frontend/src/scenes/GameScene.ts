import { Container, Graphics, Text } from 'pixi.js';
import { Location } from '@/entities/Location';
import { Player } from '@/entities/Player';
import { EntityManager } from '@/entities/EntityManager';
import { LOCATIONS, TOWN_BOUNDS } from '@/data/locations';
import { NPCS } from '@/data/npcs';
import { MovementSystem } from '@/systems/MovementSystem';
import { DialogSystem } from '@/systems/DialogSystem';
import { TimeSystem } from '@/systems/TimeSystem';
import { SaveSystem } from '@/systems/SaveSystem';
import { StorySystem } from '@/systems/StorySystem';
import { findLocationAt } from '@/data/locations';
import { useGameStore } from '@/store/gameStore';

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
  private readonly locations: Location[] = [];
  private readonly movement: MovementSystem;
  private readonly npcLayer: Container;

  constructor() {
    this.root = new Container();
    this.root.label = 'game-scene';

    const ground = new Graphics();
    ground.rect(0, 0, TOWN_BOUNDS.width, TOWN_BOUNDS.height);
    ground.fill({ color: 0x264653 });
    this.root.addChild(ground);

    const grid = new Graphics();
    const step = 80;
    for (let x = 0; x <= TOWN_BOUNDS.width; x += step) {
      grid.moveTo(x, 0).lineTo(x, TOWN_BOUNDS.height);
    }
    for (let y = 0; y <= TOWN_BOUNDS.height; y += step) {
      grid.moveTo(0, y).lineTo(TOWN_BOUNDS.width, y);
    }
    grid.stroke({ color: 0xffffff, width: 1, alpha: 0.06 });
    this.root.addChild(grid);

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

    // Spawn player at town center, above locations and NPCs.
    const spawn = { x: TOWN_BOUNDS.width / 2, y: TOWN_BOUNDS.height / 2 };
    this.player = new Player({ x: spawn.x, y: spawn.y, speed: 220 });
    this.root.addChild(this.player.view);
    useGameStore.getState().setPlayerPosition({ x: spawn.x, y: spawn.y });

    // Phase 2.3 — DialogSystem owns NPC-talk interaction state. It is
    // stateless w.r.t. UI (state lives in the Zustand store) and is wired
    // into MovementSystem as a click-interceptor so clicking an NPC in
    // range opens the dialog instead of walking past them.
    this.dialog = new DialogSystem({
      player: this.player,
      entityManager: this.entityManager,
    });

    // Phase 3.1 — game clock. Defaults to day 1 (Monday) 08:00 with the
    // canonical 1s = 1min acceleration from DESIGN.md. The constructor
    // pushes an initial snapshot to the store so TimeDisplay shows the
    // right state on first paint, before any ticker frames have run.
    this.time = new TimeSystem();

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
    this.story = new StorySystem({
      player: this.player,
      timeSystem: this.time,
    });
    void this.story.boot();

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
      text: '오렌지로드 마을 — Phase 2.3 (대화)',
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
    if (this.player.isMoving) {
      const px = this.player.x;
      const py = this.player.y;
      const store = useGameStore.getState();
      store.setPlayerPosition({ x: px, y: py });
      // Phase 4.1 — keep the coarse player-location id fresh so the
      // StorySystem's ON_LOCATION_ENTER trigger has something to evaluate
      // against. Soft-snapping pushes the player out of building rects most
      // of the time, so this is usually null while moving.
      const loc = findLocationAt(px, py);
      if (loc !== store.playerLocationId) {
        store.setPlayerLocationId(loc);
      }
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
