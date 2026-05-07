/**
 * SaveSystem — Phase 3.2 (FR-008 세이브/로드).
 *
 * Reference: DESIGN.md §"Frontend Structure" (`systems/SaveSystem.ts`).
 *
 * This system is the bridge between:
 *   - Zustand store (source of truth for serialisable state)
 *   - TimeSystem (clock that needs an explicit reset on load)
 *   - PixiJS entities (Player + NPCs that must teleport on load)
 *   - Backend save API (createSave / loadSave / listSaves / deleteSave)
 *
 * It is StrictMode-safe: it owns no timers, no DOM listeners, and no
 * subscriptions. Constructed once in App.tsx and passed to the panel via
 * props; an aborted React effect simply drops the instance.
 *
 * Versioning:
 *   v1 — pre-Phase-C; no `currentScene` field. Loaded as-if outdoor.
 *   v2 — Phase C (Issue #23); adds `currentScene` so we restore the right
 *        top-level scene (outdoor town map vs an interior room).
 *
 * The loader migrates v1 → v2 in-place (default `currentScene: outdoor`)
 * and then applies the resulting payload to the store + entities.
 */

import {
  createSave,
  deleteSave,
  listSaves,
  loadSave,
  type GameSavePayload,
  type RelationshipPayload,
  type SaveCreateResult,
  type SaveListResult,
  type SaveSummary,
} from '@/api/client';
import type { Player } from '@/entities/Player';
import type { EntityManager } from '@/entities/EntityManager';
import { useGameStore, type NPCStoreEntry, type RelationshipEntry } from '@/store/gameStore';
import type { TimeSystem } from '@/systems/TimeSystem';

export class SaveError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SaveError';
    this.cause = cause;
  }
}

export interface SaveSystemDeps {
  /** Game clock — needs setTime() on load and getTime()/getDayOfWeek() on save. */
  timeSystem: TimeSystem;
  /** Player entity — teleported on load. */
  player: Player;
  /** EntityManager — used to teleport NPCs on load. */
  entityManager: EntityManager;
}

export class SaveSystem {
  private readonly timeSystem: TimeSystem;
  private readonly player: Player;
  private readonly entityManager: EntityManager;

  constructor(deps: SaveSystemDeps) {
    this.timeSystem = deps.timeSystem;
    this.player = deps.player;
    this.entityManager = deps.entityManager;
  }

  /**
   * Capture the current store state into a versioned save payload.
   * Public for tests and for the panel to preview-before-save in the future.
   */
  buildPayload(label?: string): GameSavePayload {
    const state = useGameStore.getState();
    const payload: GameSavePayload = {
      // Phase C — bumped to v2. Loader still accepts v1 saves and migrates
      // them in-place by defaulting `currentScene` to outdoor.
      version: 2,
      savedAt: Date.now(),
      phase: state.phase,
      time: { ...state.time },
      playerPosition: { ...state.playerPosition },
      npcs: Object.fromEntries(
        Object.entries(state.npcs).map(([id, npc]) => [
          id,
          {
            id: npc.id,
            name: npc.name,
            locationId: npc.locationId,
            position: { ...npc.position },
          },
        ]),
      ),
      currentLocationId: state.currentLocationId,
      // Phase 3.3 — include relationships in the payload. Spread copies the
      // primitives so future store mutations don't bleed into the captured
      // snapshot.
      relationships: Object.fromEntries(
        Object.entries(state.relationships).map(([id, rel]) => [
          id,
          {
            npcId: rel.npcId,
            affinity: rel.affinity,
            emotion: rel.emotion,
            lastUpdated: rel.lastUpdated,
          },
        ]),
      ),
      // Phase 4.1 — flags + fireHistory. Both fields are optional on the
      // wire schema for backward-compat with v1 saves written before this
      // phase. Active-event playback state is intentionally NOT persisted
      // (mid-event saves restart from the next eligible event on load).
      flags: { ...state.flags },
      story: { fireHistory: [...state.story.fireHistory] },
      // Phase 5.2 — audio mixer settings (Issue #15). Optional on v1; we
      // always emit on new saves so a save→load round-trip preserves the
      // user's volume / mute / bgm-enabled choices.
      audio: { ...state.audio },
      // Phase C — current scene (outdoor town vs a specific indoor room).
      // Always emitted on v2; v1 loaders will simply ignore the field.
      currentScene:
        state.currentScene.kind === 'indoor'
          ? { kind: 'indoor', sceneId: state.currentScene.sceneId }
          : { kind: 'outdoor' },
    };
    if (label !== undefined && label.length > 0) {
      payload.label = label;
    }
    return payload;
  }

  /**
   * Build payload from current state, push to backend, return server result.
   * Errors propagate as SaveError (wrapping APIError) so the UI can show one
   * uniform "save failed" path.
   */
  async save(slotId: string, label?: string): Promise<SaveCreateResult> {
    const payload = this.buildPayload(label);
    try {
      return await createSave(slotId, payload);
    } catch (err) {
      throw new SaveError(`save failed for slot ${slotId}`, err);
    }
  }

  /**
   * Pull a save payload from the backend, validate, then apply to store +
   * scene entities atomically (entity teleports happen after store updates,
   * which keeps the store-driven UI from blinking the old positions).
   */
  async load(slotId: string): Promise<GameSavePayload> {
    let payload: GameSavePayload;
    try {
      payload = await loadSave(slotId);
    } catch (err) {
      throw new SaveError(`load failed for slot ${slotId}`, err);
    }

    // Phase C — accept v1 (pre-#23) and v2 (#23+). v1 → v2 migration is just
    // "default currentScene to outdoor" since every other field is shared.
    // Any other version is rejected so a future v3 lands behind a real
    // migration path rather than silently coercing.
    if (payload.version !== 1 && payload.version !== 2) {
      throw new SaveError(
        `unsupported save version: ${(payload as { version?: unknown }).version}`,
      );
    }
    if (payload.version === 1) {
      // In-place upgrade. The optional `currentScene` field is already
      // typed as undefined-or-present on `GameSavePayload`, so we just
      // assign a default here and bump the version literal.
      payload = { ...payload, version: 2, currentScene: { kind: 'outdoor' } };
    }

    this.applyPayload(payload);
    return payload;
  }

  async list(): Promise<SaveSummary[]> {
    try {
      const result: SaveListResult = await listSaves();
      return result.slots;
    } catch (err) {
      throw new SaveError('list saves failed', err);
    }
  }

  async delete(slotId: string): Promise<void> {
    try {
      await deleteSave(slotId);
    } catch (err) {
      throw new SaveError(`delete failed for slot ${slotId}`, err);
    }
  }

  // --- internals ------------------------------------------------------------

  private applyPayload(payload: GameSavePayload): void {
    const store = useGameStore.getState();

    // 1. Time — clock first so any time-derived UI sees the new state when
    //    we then re-render from the rest of the slice updates.
    this.timeSystem.setTime({
      day: payload.time.day,
      hour: payload.time.hour,
      minute: payload.time.minute,
    });

    // 2. Store — player position, current location, NPC slice. We rebuild
    //    the NPC record from the payload but keep names from the payload
    //    rather than initialNPCs so a future renamed NPC restores cleanly.
    store.setPlayerPosition({ ...payload.playerPosition });
    store.setCurrentLocation(payload.currentLocationId);

    const restored: Record<string, NPCStoreEntry> = {};
    for (const [id, npc] of Object.entries(payload.npcs)) {
      restored[id] = {
        id: npc.id,
        name: npc.name,
        locationId: npc.locationId,
        position: { ...npc.position },
      };
    }
    store.setNPCs(restored);

    // Phase 3.3 — relationship slice. v1 saves written before Phase 3.3
    // omit this field; in that case we keep whatever defaults the store
    // currently has (initialised from the NPC roster). New saves override
    // per-NPC; missing entries stay at their defaults.
    if (payload.relationships) {
      const rels: Record<string, RelationshipEntry> = {};
      for (const [id, rel] of Object.entries<RelationshipPayload>(payload.relationships)) {
        rels[id] = {
          npcId: rel.npcId,
          affinity: rel.affinity,
          emotion: rel.emotion,
          lastUpdated: rel.lastUpdated,
        };
      }
      store.setRelationships(rels);
    }

    // Phase 4.1 — flags + story.fireHistory. Both optional for v1 backward
    // compat. When absent we explicitly reset to empty so loading an old
    // save doesn't leak flags from a previous game session.
    store.setFlags(payload.flags ?? {});
    store.setStoryFireHistory(payload.story?.fireHistory ?? []);

    // Phase 5.2 — restore audio mixer settings. Missing on older saves;
    // when present we apply each field. The actual AudioEngine sync is
    // handled by App.tsx's effect listener on the audio slice (so the
    // engine reflects the just-applied values without coupling SaveSystem
    // to the engine instance).
    if (payload.audio) {
      store.setAudioSettings(payload.audio);
    }

    // 3. Scene entities — teleport BEFORE the scene swap so the existing
    //    Player / NPC views reflect the new positions on the same frame
    //    for the same-scene round-trip case (the most common one). Doing
    //    this before the scene swap also avoids touching destroyed views
    //    if the swap fires in step 4.
    this.player.teleport(payload.playerPosition.x, payload.playerPosition.y);
    for (const [id, npc] of Object.entries(payload.npcs)) {
      const entity = this.entityManager.getNPC(id);
      if (entity) {
        entity.teleport(npc.position.x, npc.position.y, npc.locationId);
      }
      // Unknown ids in the save (e.g. an NPC removed from the roster) are
      // silently ignored — the store still keeps the entry so a future
      // reload retains it, but no scene entity exists to update.
    }

    // 4. Phase C (Issue #23) — restore the active scene slice last. The
    //    actual scene swap (destroy current scene, mount the right one) is
    //    driven by Game.ts via a store subscriber on `currentScene`. The
    //    post-swap scene re-reads `playerPosition` from the store (already
    //    set in step 2) on construction, so it lands at the right spot.
    //    Missing on v1 saves → outdoor.
    store.setCurrentScene(payload.currentScene ?? { kind: 'outdoor' });
  }
}
