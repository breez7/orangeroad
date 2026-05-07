import type { Container } from 'pixi.js';
import { NPC, type NPCDef } from '@/entities/NPC';

/**
 * EntityManager — owns the lifecycle of NPCs in the current scene.
 *
 * Phase 2.1: NPC-only. Future phases may extend this to manage Player and
 * other dynamic entities, but keeping the surface tight for now.
 *
 * The manager attaches NPC views to a parent container provided by the
 * scene (e.g. a dedicated `npcLayer` between locations and the player).
 */
export class EntityManager {
  private readonly parent: Container;
  private readonly npcs = new Map<string, NPC>();

  constructor(parent: Container) {
    this.parent = parent;
  }

  /** Instantiate an NPC, attach its view to the manager's parent, store it. */
  addNPC(def: NPCDef): NPC {
    if (this.npcs.has(def.id)) {
      throw new Error(`EntityManager: NPC id "${def.id}" already registered`);
    }
    const npc = new NPC(def);
    this.parent.addChild(npc.view);
    this.npcs.set(def.id, npc);
    return npc;
  }

  /** Lookup by id. */
  getNPC(id: string): NPC | undefined {
    return this.npcs.get(id);
  }

  /** Read-only view of all managed NPCs. */
  all(): readonly NPC[] {
    return Array.from(this.npcs.values());
  }

  /** Per-frame tick — fans out to each NPC. `dt` in seconds. */
  update(dt: number): void {
    for (const npc of this.npcs.values()) {
      npc.update(dt);
    }
  }

  /** Destroy every managed NPC and clear the collection. */
  destroyAll(): void {
    for (const npc of this.npcs.values()) {
      npc.destroy();
    }
    this.npcs.clear();
  }
}
