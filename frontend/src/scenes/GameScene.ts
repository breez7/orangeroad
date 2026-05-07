import { Container, Graphics, Text } from 'pixi.js';
import { Location } from '@/entities/Location';
import { Player } from '@/entities/Player';
import { EntityManager } from '@/entities/EntityManager';
import { LOCATIONS, TOWN_BOUNDS } from '@/data/locations';
import { NPCS } from '@/data/npcs';
import { MovementSystem } from '@/systems/MovementSystem';
import { useGameStore } from '@/store/gameStore';

export class GameScene {
  readonly root: Container;
  readonly player: Player;
  readonly entityManager: EntityManager;
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

    // Click-to-walk system. Bind events on the scene root so empty grass
    // between location tiles still registers clicks.
    this.movement = new MovementSystem({
      townRoot: this.root,
      player: this.player,
      bounds: TOWN_BOUNDS,
      locations: LOCATIONS,
    });
    this.movement.attach();

    const banner = new Text({
      text: '오렌지로드 마을 — Phase 2.1 (NPC 배치)',
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
    if (this.player.isMoving) {
      useGameStore.getState().setPlayerPosition({
        x: this.player.x,
        y: this.player.y,
      });
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
    // Tear down NPCs before the parent container goes away so each NPC's
    // own destroy() runs (StrictMode-safe re-init).
    this.entityManager.destroyAll();
    this.player.destroy();
    for (const loc of this.locations) loc.destroy();
    this.locations.length = 0;
    this.root.destroy({ children: true });
  }
}
