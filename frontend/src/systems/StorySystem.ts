/**
 * StorySystem — Phase 4.1 (FR-006 스토리 진행).
 *
 * Reference: requirements.md FR-006, DESIGN.md §"GameState" `flags` slice.
 *
 * Responsibilities
 * ----------------
 *  - Subscribe to the gameStore (flags, story, time, playerPosition,
 *    relationships) and trigger event evaluation at the appropriate moments.
 *  - Pull event scripts from the backend's EventService on demand and play
 *    them step-by-step against the store + Player + TimeSystem.
 *  - During scripted playback the TimeSystem is paused and movement is
 *    blocked (via DialogSystem.isOpen-style gate; we mirror by exposing
 *    `isEventActive` for MovementSystem.isInputBlocked).
 *
 * Step semantics
 * --------------
 *   narration / dialog    — push a frame to the StoryOverlay; advance on user
 *                           confirm (Enter / click).
 *   set_flag / clear_flag — store mutation, advances immediately.
 *   set_affinity          — clamped delta against `relationships[npcId]`.
 *   set_emotion           — replaces emotion on `relationships[npcId]`.
 *   teleport_player       — relocates the Player entity AND the store slice.
 *
 * Persistence
 * -----------
 *   When an event ends we call `endEvent()` which appends the event id to
 *   `story.fireHistory` (idempotent). Side effects (flags / affinity) are
 *   persisted to the save via the existing save payload — there is no
 *   separate server-side write for event playback.
 *
 * StrictMode lifecycle
 * --------------------
 *   We hold ONE zustand subscription for ON_FLAG triggers (the spark moment
 *   for non-START events) plus the polled-on-demand evaluations for the rest.
 *   `destroy()` unsubscribes and aborts in-flight network requests.
 */

import {
  APIError,
  checkEventEligible,
  getEvent,
  listEvents,
  type EligibilityState,
  type FlagValue,
  type StoryEvent,
} from '@/api/client';
import type { Player } from '@/entities/Player';
import type { TimeSystem } from '@/systems/TimeSystem';
import { findLocationAt } from '@/data/locations';
import { useGameStore, type Emotion } from '@/store/gameStore';

export interface StorySystemDeps {
  player: Player;
  timeSystem: TimeSystem;
}

export class StorySystem {
  private readonly player: Player;
  private readonly timeSystem: TimeSystem;
  private destroyed = false;
  private booted = false;

  /** Cache of event scripts fetched from the backend (id → script). */
  private readonly cache = new Map<string, StoryEvent>();
  /** Aborts any in-flight fetch when the system is destroyed. */
  private inflight: AbortController | null = null;
  /** Zustand unsubscribe for flag-change driven re-evaluation. */
  private unsubscribe: (() => void) | null = null;

  /** Public read-only flag — true while a scripted event is playing. */
  isEventActive = false;

  constructor(deps: StorySystemDeps) {
    this.player = deps.player;
    this.timeSystem = deps.timeSystem;
  }

  /**
   * Boot the system. Loads the event catalogue from the backend (best-effort)
   * and runs an initial pass for ON_START + any state-derived eligible event.
   * Idempotent.
   */
  async boot(): Promise<void> {
    if (this.destroyed || this.booted) return;
    this.booted = true;

    // Subscribe AFTER first-pass triggers complete to avoid duplicate fires.
    this.unsubscribe = useGameStore.subscribe((state, prev) => {
      if (this.destroyed || this.isEventActive) return;
      const flagsChanged = state.flags !== prev.flags;
      const affinityChanged = state.relationships !== prev.relationships;
      const locationChanged = state.playerLocationId !== prev.playerLocationId;
      const timeChanged =
        state.time.day !== prev.time.day ||
        state.time.hour !== prev.time.hour ||
        state.time.minute !== prev.time.minute;
      if (flagsChanged || affinityChanged || locationChanged || timeChanged) {
        // Schedule a microtask to coalesce same-frame multi-mutation bursts.
        queueMicrotask(() => void this.evaluateAndMaybeFire());
      }
    });

    // Initial pass — handles ON_START intro after a fresh game launch and
    // any flag/affinity-driven event that was already eligible from a load.
    // (Catalogue prefetch was dropped — listEvents() returns metadata only,
    // and full scripts must be fetched lazily inside playEvent() anyway.)
    await this.evaluateAndMaybeFire();
  }

  /** Tear down — abort fetches, unsubscribe from store. */
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
    // Clear active-event flag so any stragglers don't think we're mid-script.
    this.isEventActive = false;
  }

  // --- evaluation ----------------------------------------------------------

  private buildEligibilityState(): EligibilityState {
    const s = useGameStore.getState();
    const affinities: Record<string, number> = {};
    for (const [id, rel] of Object.entries(s.relationships)) {
      affinities[id] = rel.affinity;
    }
    return {
      flags: { ...s.flags },
      fireHistory: [...s.story.fireHistory],
      time: { ...s.time },
      location: s.playerLocationId,
      affinities,
    };
  }

  /**
   * Ask the backend which events are eligible right now and play the first
   * one (deterministic order). At most one event plays at a time.
   *
   * This intentionally uses single-event eligibility checks rather than the
   * batch endpoint so the FE stays in control of priority; for Phase 4.1 we
   * iterate the catalogue ids in alphabetical order.
   */
  private async evaluateAndMaybeFire(): Promise<void> {
    if (this.destroyed || this.isEventActive) return;

    let ids: string[] = [];
    try {
      const list = await listEvents();
      ids = list.events.map((e) => e.id).sort();
    } catch {
      return; // backend offline — silent.
    }
    if (this.destroyed || this.isEventActive) return;

    const fired = new Set(useGameStore.getState().story.fireHistory);
    for (const id of ids) {
      if (this.destroyed || this.isEventActive) return;
      if (fired.has(id)) continue; // FE-side skip; backend also enforces.
      const state = this.buildEligibilityState();
      let eligible = false;
      try {
        const res = await checkEventEligible(id, state);
        eligible = res.eligible;
      } catch {
        continue;
      }
      if (this.destroyed || this.isEventActive) return;
      if (!eligible) continue;
      await this.playEvent(id);
      // Only one event per evaluation pass.
      return;
    }
  }

  // --- playback ------------------------------------------------------------

  /** Public entrypoint for tests / dev tools. */
  async playEvent(eventId: string): Promise<void> {
    if (this.destroyed || this.isEventActive) return;
    let script = this.cache.get(eventId);
    if (!script) {
      try {
        const ctrl = new AbortController();
        this.inflight = ctrl;
        script = await getEvent(eventId, { signal: ctrl.signal });
        this.cache.set(eventId, script);
      } catch (err) {
        if (err instanceof APIError && err.status === 404) {
          console.warn(`[StorySystem] event not found: ${eventId}`);
        }
        return;
      } finally {
        this.inflight = null;
      }
    }
    if (this.destroyed) return;

    // Begin playback.
    this.isEventActive = true;
    this.timeSystem.pause();
    const store = useGameStore.getState();
    store.startEvent(eventId);

    // Drive the steps. Steps that need user input (narration / dialog) yield
    // back to the StoryOverlay which calls `confirmStep()` on click/Enter.
    // Other steps execute immediately and we keep advancing.
    await this.runUntilWaitingForInput(script);
  }

  /**
   * Confirm the currently-displayed narration/dialog frame. Called by the
   * StoryOverlay button / Enter key handler. Advances the cursor and runs
   * non-interactive steps until the next interactive frame (or end).
   */
  async confirmStep(): Promise<void> {
    if (this.destroyed || !this.isEventActive) return;
    const store = useGameStore.getState();
    const id = store.story.activeEventId;
    if (!id) return;
    const script = this.cache.get(id);
    if (!script) return;

    // Advance past the just-confirmed interactive step.
    store.advanceStep();
    await this.runUntilWaitingForInput(script);
  }

  /**
   * Walk steps from the current cursor: execute side-effecting steps inline,
   * advance, and stop when we hit an interactive step (narration/dialog) or
   * run off the end of the script.
   */
  private async runUntilWaitingForInput(script: StoryEvent): Promise<void> {
    while (!this.destroyed && this.isEventActive) {
      const cur = useGameStore.getState();
      const idx = cur.story.stepIndex;
      if (idx >= script.steps.length) {
        this.finishEvent();
        return;
      }
      const step = script.steps[idx]!;
      switch (step.type) {
        case 'narration':
        case 'dialog':
          // Interactive — leave the cursor here, let the overlay render it.
          return;
        case 'set_flag': {
          const v: FlagValue = step.value === undefined ? true : step.value;
          useGameStore.getState().setFlag(step.flag, v);
          useGameStore.getState().advanceStep();
          break;
        }
        case 'clear_flag':
          useGameStore.getState().clearFlag(step.flag);
          useGameStore.getState().advanceStep();
          break;
        case 'set_affinity': {
          const s = useGameStore.getState();
          const cur = s.relationships[step.npcId];
          if (cur) {
            const next = clamp(cur.affinity + step.delta, 0, 100);
            s.setRelationship(step.npcId, {
              ...cur,
              affinity: next,
              lastUpdated: Date.now(),
            });
          }
          useGameStore.getState().advanceStep();
          break;
        }
        case 'set_emotion': {
          const s = useGameStore.getState();
          const cur = s.relationships[step.npcId];
          if (cur) {
            s.setRelationship(step.npcId, {
              ...cur,
              emotion: step.emotion as Emotion,
              lastUpdated: Date.now(),
            });
          }
          useGameStore.getState().advanceStep();
          break;
        }
        case 'teleport_player': {
          const s = useGameStore.getState();
          this.player.teleport(step.x, step.y);
          s.setPlayerPosition({ x: step.x, y: step.y });
          s.setPlayerLocationId(findLocationAt(step.x, step.y));
          useGameStore.getState().advanceStep();
          break;
        }
      }
    }
  }

  private finishEvent(): void {
    this.isEventActive = false;
    this.timeSystem.resume();
    useGameStore.getState().endEvent();
  }
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
