/**
 * ScheduleSystem — Phase 4.2 (FR-009 일과 시스템).
 *
 * Reference: requirements.md FR-009, DESIGN.md §"NPCState" `schedule` and
 * §"Backend Structure" `services/ScheduleService.ts`.
 *
 * Responsibilities:
 *  - Subscribe to the time slice in the gameStore. On each game-minute change,
 *    ask the backend for the current schedule entry per NPC, then:
 *      - Update `npcSchedules` in the store (used by UI to surface the
 *        player's current activity and could surface activity tooltips for
 *        any NPC later).
 *      - Teleport every non-player NPC entity to the *center* of the
 *        location their schedule places them in. The player (`kyousuke`)
 *        is intentionally NOT auto-teleported — Phase 4.2 only surfaces the
 *        player's expected activity in UI.
 *  - Backend offline → silent no-op; NPCs stay where they are.
 *  - Throttled to "once per game minute" by virtue of the time slice only
 *    updating on minute boundaries (TimeSystem already enforces this).
 *
 * StrictMode lifecycle:
 *  - Holds ONE zustand subscription + one in-flight fetch controller.
 *  - destroy() unsubscribes and aborts.
 *  - The boot() pass kicks off an immediate fetch so NPCs settle to their
 *    schedule positions on first paint without waiting for the first
 *    minute-tick (~1s real-time at default speed).
 */

import { APIError, getCurrentSchedules, type APIDayOfWeek } from '@/api/client';
import { centerOf } from '@/data/locations';
import type { EntityManager } from '@/entities/EntityManager';
import { useGameStore } from '@/store/gameStore';

export interface ScheduleSystemDeps {
  entityManager: EntityManager;
}

/** NPC ids that should NOT be auto-teleported (the player avatar). */
const PLAYER_NPC_IDS = new Set<string>(['kyousuke']);

export class ScheduleSystem {
  private readonly entityManager: EntityManager;
  private destroyed = false;
  private booted = false;

  /** Last (day, hour, minute) we fetched for, to avoid duplicate fetches. */
  private lastFetchedKey: string | null = null;

  /** Active fetch controller — aborted on destroy / re-fetch. */
  private inflight: AbortController | null = null;

  /** Zustand unsubscribe handle. */
  private unsubscribe: (() => void) | null = null;

  constructor(deps: ScheduleSystemDeps) {
    this.entityManager = deps.entityManager;
  }

  /**
   * Subscribe to time changes and trigger the first refresh. Idempotent —
   * a second call is a no-op (the subscription persists until destroy()).
   */
  boot(): void {
    if (this.destroyed || this.booted) return;
    this.booted = true;

    this.unsubscribe = useGameStore.subscribe((state, prev) => {
      if (this.destroyed) return;
      const t = state.time;
      const p = prev.time;
      if (
        t.day !== p.day ||
        t.hour !== p.hour ||
        t.minute !== p.minute ||
        t.dayOfWeek !== p.dayOfWeek
      ) {
        void this.refresh();
      }
    });

    // Kick off an immediate refresh so first-paint NPC positions reflect the
    // current time rather than the data/npcs.ts spawn defaults.
    void this.refresh();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.inflight) {
      this.inflight.abort();
      this.inflight = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Fetch the current schedule snapshot from the backend and apply it to the
   * store + entity layer. Safe to call any number of times; redundant calls
   * within the same game-minute short-circuit on the cached `lastFetchedKey`.
   */
  async refresh(): Promise<void> {
    if (this.destroyed) return;
    const state = useGameStore.getState();
    const t = state.time;
    const key = `${t.day}-${t.hour}-${t.minute}`;
    if (key === this.lastFetchedKey) return;

    // Abort any prior in-flight fetch — only the latest minute matters.
    if (this.inflight) {
      this.inflight.abort();
      this.inflight = null;
    }
    const ctrl = new AbortController();
    this.inflight = ctrl;

    let result;
    try {
      result = await getCurrentSchedules(
        { hour: t.hour, minute: t.minute },
        t.dayOfWeek as APIDayOfWeek,
        { signal: ctrl.signal },
      );
    } catch (err) {
      // Silent on backend offline / network error / abort. NPCs stay put.
      if (err instanceof APIError && err.error !== 'request_aborted') {
        // Don't spam in dev — only log non-aborts.
        // eslint-disable-next-line no-console
        console.warn('[ScheduleSystem] schedule fetch failed:', err.error);
      }
      return;
    } finally {
      // Clear the controller iff it's still ours (a newer refresh may have
      // already replaced it).
      if (this.inflight === ctrl) this.inflight = null;
    }

    if (this.destroyed) return;
    this.lastFetchedKey = key;

    // Update store first so any UI selector reflects the new activity even
    // if the entity layer noops (e.g. NPC not yet spawned).
    const flat: Record<string, { locationId: string | null; activity: string }> = {};
    for (const [id, entry] of Object.entries(result.schedules)) {
      flat[id] = { locationId: entry.locationId, activity: entry.activity };
    }
    useGameStore.getState().setNPCSchedules(flat);

    // Apply to NPC entities — teleport everyone EXCEPT the player avatar.
    for (const [id, entry] of Object.entries(result.schedules)) {
      if (PLAYER_NPC_IDS.has(id)) continue;
      const npc = this.entityManager.getNPC(id);
      if (!npc) continue;
      const center = centerOf(entry.locationId);
      if (!center) continue;
      // Only teleport if the NPC isn't already inside the target location.
      if (npc.locationId !== entry.locationId) {
        npc.teleport(center.x, center.y, entry.locationId);
      }
    }

    // Mirror the entity-layer state into the npcs slice in the store so save
    // payloads + UI selectors remain consistent. Skip if nothing changed.
    const store = useGameStore.getState();
    const nextNpcs: Record<string, typeof store.npcs[string]> = { ...store.npcs };
    let mutated = false;
    for (const [id, entry] of Object.entries(result.schedules)) {
      if (PLAYER_NPC_IDS.has(id)) continue;
      const cur = nextNpcs[id];
      if (!cur) continue;
      const center = centerOf(entry.locationId);
      if (!center) continue;
      if (
        cur.locationId !== entry.locationId ||
        cur.position.x !== center.x ||
        cur.position.y !== center.y
      ) {
        nextNpcs[id] = {
          ...cur,
          locationId: entry.locationId,
          position: { x: center.x, y: center.y },
        };
        mutated = true;
      }
    }
    if (mutated) {
      store.setNPCs(nextNpcs);
    }
  }
}
