/**
 * EventService — Phase 4.1 (FR-006 스토리 진행).
 *
 * Reference: DESIGN.md §"Backend Structure" `services/EventService.ts` and
 * §"GameState" `flags: Map<string, any>` (story flags).
 *
 * Responsibilities:
 *  - Load + validate JSON event scripts under `data/events/` at startup.
 *  - Expose pure-ish helpers for the frontend:
 *      - listEvents()                       → metadata for every loaded event
 *      - getEvent(id)                       → full validated script
 *      - evaluateTriggers(state)            → ids of events whose trigger AND
 *        all `requires` evaluate true given the supplied state, AND that have
 *        not already fired (when `once: true`).
 *      - evaluateOne(id, state)             → { eligible, reasons } so the FE
 *        can ask "would event X fire right now?"
 *  - DOES NOT execute side effects. The frontend StorySystem orchestrates
 *    step playback (dialog, flag/affinity/emotion mutations) — the backend
 *    just describes what's possible.
 *
 * Design choices:
 *  - JSON-per-event (one file in data/events/) so authors can version / diff
 *    individual events without merge churn.
 *  - zod schema validates at read time — corrupt files are skipped with a
 *    console warn rather than failing the whole service. This matches the
 *    SaveService policy of "best-effort on listing".
 *  - Triggers and requires use the same predicate primitives — but a trigger
 *    is the "spark" (one of: ON_START / ON_LOCATION_ENTER / ON_FLAG / ON_TIME
 *    / ON_AFFINITY) and `requires` are extra gating conditions. The FE supplies
 *    the current state and the service short-circuits — there's intentionally
 *    no full DSL.
 */

import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { z } from 'zod';

// --- Shared primitives -----------------------------------------------------

const dayOfWeekSchema = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

const timeStateSchema = z.object({
  day: z.number().int().min(1),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  dayOfWeek: dayOfWeekSchema,
  phaseLabel: z.string().min(1).max(64),
});

export type EventTimeState = z.infer<typeof timeStateSchema>;

// --- Trigger schema --------------------------------------------------------
// A "trigger" is the moment at which the FE asks "is this event ready?".
// Phase 4.1 supports a small fixed set; the FE is responsible for invoking
// evaluation at the appropriate moments (game start, location enter, time
// tick, etc.).

const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ON_START') }),
  z.object({
    type: z.literal('ON_LOCATION_ENTER'),
    locationId: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal('ON_FLAG'),
    flag: z.string().min(1).max(64),
    /** Optional value — when set, ON_FLAG only fires if flag === value. */
    value: z.union([z.boolean(), z.string(), z.number()]).optional(),
  }),
  z.object({
    type: z.literal('ON_TIME'),
    /** Inclusive start hour [0..23]. */
    hourStart: z.number().int().min(0).max(23),
    /** Inclusive end hour [0..23]. Wraps midnight if end < start. */
    hourEnd: z.number().int().min(0).max(23),
    /** Optional day-of-week filter. */
    dayOfWeek: dayOfWeekSchema.optional(),
  }),
  z.object({
    type: z.literal('ON_AFFINITY'),
    npcId: z.string().min(1).max(64),
    /** Fires once affinity for npcId crosses (>=) threshold. */
    threshold: z.number().int().min(0).max(100),
  }),
]);

export type EventTrigger = z.infer<typeof triggerSchema>;

// --- Requires schema -------------------------------------------------------

const requireSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('FLAG_SET'), flag: z.string().min(1).max(64) }),
  z.object({ type: z.literal('FLAG_NOT_SET'), flag: z.string().min(1).max(64) }),
  z.object({
    type: z.literal('AFFINITY_GTE'),
    npcId: z.string().min(1).max(64),
    value: z.number().int().min(0).max(100),
  }),
  z.object({
    type: z.literal('AFFINITY_LT'),
    npcId: z.string().min(1).max(64),
    value: z.number().int().min(0).max(100),
  }),
  z.object({
    type: z.literal('TIME_BETWEEN'),
    hourStart: z.number().int().min(0).max(23),
    hourEnd: z.number().int().min(0).max(23),
  }),
]);

export type EventRequire = z.infer<typeof requireSchema>;

// --- Step schema (executed by the FE StorySystem) --------------------------

const stepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('narration'), text: z.string().min(1).max(2000) }),
  z.object({
    type: z.literal('dialog'),
    speaker: z.string().min(1).max(64),
    text: z.string().min(1).max(2000),
  }),
  z.object({
    type: z.literal('set_flag'),
    flag: z.string().min(1).max(64),
    /** Default true if omitted — the most common case is "mark complete". */
    value: z.union([z.boolean(), z.string(), z.number()]).optional(),
  }),
  z.object({
    type: z.literal('clear_flag'),
    flag: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal('set_affinity'),
    npcId: z.string().min(1).max(64),
    delta: z.number().int(),
  }),
  z.object({
    type: z.literal('set_emotion'),
    npcId: z.string().min(1).max(64),
    emotion: z.enum([
      'neutral',
      'happy',
      'sad',
      'angry',
      'shy',
      'flirty',
      'annoyed',
    ]),
  }),
  z.object({
    type: z.literal('teleport_player'),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
]);

export type EventStep = z.infer<typeof stepSchema>;

// --- Event schema ----------------------------------------------------------

export const storyEventSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  trigger: triggerSchema,
  requires: z.array(requireSchema).optional(),
  /** When true the event fires at most once per save (uses fireHistory). */
  once: z.boolean().default(true),
  steps: z.array(stepSchema).min(1).max(64),
});

export type StoryEvent = z.infer<typeof storyEventSchema>;

// --- Eligibility input -----------------------------------------------------

export const eligibilityStateSchema = z.object({
  flags: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])),
  fireHistory: z.array(z.string()),
  time: timeStateSchema.nullable().optional(),
  /** Coarse current location id (or null if outside any rect). */
  location: z.string().nullable().optional(),
  /** Per-NPC affinity snapshot (0..100). */
  affinities: z.record(z.string(), z.number().int().min(0).max(100)),
});

export type EligibilityState = z.infer<typeof eligibilityStateSchema>;

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export interface EventMetadata {
  id: string;
  title: string;
  trigger: EventTrigger;
  once: boolean;
  description?: string;
}

// --- Service ---------------------------------------------------------------

export interface EventServiceOptions {
  eventsDir: string;
}

export class EventService {
  private readonly eventsDir: string;
  private cache: Map<string, StoryEvent> | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(opts?: Partial<EventServiceOptions>) {
    const defaultDir = resolve(import.meta.dir, '..', 'data', 'events');
    this.eventsDir = opts?.eventsDir ?? defaultDir;
  }

  /** Eagerly load + validate all events. Idempotent / concurrency-safe. */
  async ensureLoaded(): Promise<void> {
    if (this.cache) return;
    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }
    this.loadPromise = this.loadAll();
    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private async loadAll(): Promise<void> {
    const cache = new Map<string, StoryEvent>();
    let files: string[] = [];
    try {
      files = await readdir(this.eventsDir);
    } catch (err) {
      console.warn(`[EventService] events dir not readable (${this.eventsDir}):`, err);
      this.cache = cache;
      return;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const path = resolve(this.eventsDir, f);
      try {
        const raw = await Bun.file(path).json();
        const result = storyEventSchema.safeParse(raw);
        if (!result.success) {
          console.warn(
            `[EventService] skipping malformed event ${f}:`,
            result.error.issues,
          );
          continue;
        }
        const parsed = result.data;
        // The id inside the JSON is authoritative; warn if filename diverges.
        const expectedId = f.replace(/\.json$/, '');
        if (parsed.id !== expectedId) {
          console.warn(
            `[EventService] event ${f}: filename id "${expectedId}" != json id "${parsed.id}" — using json id.`,
          );
        }
        if (cache.has(parsed.id)) {
          console.warn(`[EventService] duplicate event id "${parsed.id}" — keeping first.`);
          continue;
        }
        cache.set(parsed.id, parsed);
      } catch (err) {
        console.warn(`[EventService] failed to read ${f}:`, err);
      }
    }
    this.cache = cache;
  }

  async listEvents(): Promise<EventMetadata[]> {
    await this.ensureLoaded();
    const cache = this.cache!;
    const out: EventMetadata[] = [];
    for (const e of cache.values()) {
      const meta: EventMetadata = {
        id: e.id,
        title: e.title,
        trigger: e.trigger,
        once: e.once,
      };
      if (e.description !== undefined) meta.description = e.description;
      out.push(meta);
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  async getEvent(id: string): Promise<StoryEvent | null> {
    await this.ensureLoaded();
    return this.cache!.get(id) ?? null;
  }

  /**
   * Return ids of every event whose trigger + requires match the given state
   * AND which haven't already been fired (when `once: true`). The FE then
   * picks one (typically the first by deterministic order) to play.
   */
  async evaluateTriggers(state: EligibilityState): Promise<string[]> {
    await this.ensureLoaded();
    const fired = new Set(state.fireHistory);
    const out: string[] = [];
    for (const e of this.cache!.values()) {
      if (e.once && fired.has(e.id)) continue;
      const { eligible } = this.checkEvent(e, state);
      if (eligible) out.push(e.id);
    }
    out.sort(); // deterministic order
    return out;
  }

  /** Single-event eligibility check exposed via the route layer. */
  async evaluateOne(id: string, state: EligibilityState): Promise<EligibilityResult> {
    await this.ensureLoaded();
    const e = this.cache!.get(id);
    if (!e) {
      return { eligible: false, reasons: [`event_not_found:${id}`] };
    }
    if (e.once && state.fireHistory.includes(e.id)) {
      return { eligible: false, reasons: ['already_fired'] };
    }
    return this.checkEvent(e, state);
  }

  // --- internals -----------------------------------------------------------

  private checkEvent(e: StoryEvent, state: EligibilityState): EligibilityResult {
    const reasons: string[] = [];
    const triggerOk = this.checkTrigger(e.trigger, state, reasons);
    if (!triggerOk) return { eligible: false, reasons };
    if (e.requires) {
      for (const r of e.requires) {
        if (!this.checkRequire(r, state, reasons)) {
          return { eligible: false, reasons };
        }
      }
    }
    return { eligible: true, reasons: [] };
  }

  private checkTrigger(t: EventTrigger, s: EligibilityState, reasons: string[]): boolean {
    switch (t.type) {
      case 'ON_START':
        // Always satisfied — this trigger is checked exclusively at game-load
        // boot. Filtering against fireHistory above prevents double-fire.
        return true;
      case 'ON_LOCATION_ENTER':
        if (s.location !== t.locationId) {
          reasons.push(`trigger_location_mismatch:${t.locationId}:got=${s.location ?? 'null'}`);
          return false;
        }
        return true;
      case 'ON_FLAG': {
        // ON_FLAG fires whenever the flag is *defined* (even if the value is
        // false), and an optional `value` field can pin it to a specific value.
        // Note: this is asymmetric with the FLAG_SET requires-clause, which
        // treats `value === false` as "not set". The asymmetry is intentional
        // — ON_FLAG is a trigger ("react to any change"), FLAG_SET is a gate
        // ("must be truthy"). Authors who want "fire only when set true"
        // should use ON_FLAG with value:true OR pair it with FLAG_SET.
        const v = s.flags[t.flag];
        if (v === undefined) {
          reasons.push(`trigger_flag_unset:${t.flag}`);
          return false;
        }
        if (t.value !== undefined && v !== t.value) {
          reasons.push(`trigger_flag_value_mismatch:${t.flag}`);
          return false;
        }
        return true;
      }
      case 'ON_TIME': {
        if (!s.time) {
          reasons.push('trigger_time_missing');
          return false;
        }
        if (t.dayOfWeek && s.time.dayOfWeek !== t.dayOfWeek) {
          reasons.push(`trigger_day_mismatch:${t.dayOfWeek}`);
          return false;
        }
        const h = s.time.hour;
        const inRange =
          t.hourStart <= t.hourEnd
            ? h >= t.hourStart && h <= t.hourEnd
            : h >= t.hourStart || h <= t.hourEnd; // wraps midnight
        if (!inRange) {
          reasons.push(`trigger_hour_out_of_range:${t.hourStart}-${t.hourEnd}:got=${h}`);
          return false;
        }
        return true;
      }
      case 'ON_AFFINITY': {
        const a = s.affinities[t.npcId];
        if (a === undefined) {
          reasons.push(`trigger_affinity_unknown:${t.npcId}`);
          return false;
        }
        if (a < t.threshold) {
          reasons.push(`trigger_affinity_below:${t.npcId}:${a}<${t.threshold}`);
          return false;
        }
        return true;
      }
    }
  }

  private checkRequire(r: EventRequire, s: EligibilityState, reasons: string[]): boolean {
    switch (r.type) {
      case 'FLAG_SET': {
        const v = s.flags[r.flag];
        if (v === undefined || v === false) {
          reasons.push(`require_flag_set:${r.flag}`);
          return false;
        }
        return true;
      }
      case 'FLAG_NOT_SET': {
        const v = s.flags[r.flag];
        if (v !== undefined && v !== false) {
          reasons.push(`require_flag_not_set:${r.flag}`);
          return false;
        }
        return true;
      }
      case 'AFFINITY_GTE': {
        const a = s.affinities[r.npcId] ?? 0;
        if (a < r.value) {
          reasons.push(`require_affinity_gte:${r.npcId}:${a}<${r.value}`);
          return false;
        }
        return true;
      }
      case 'AFFINITY_LT': {
        const a = s.affinities[r.npcId] ?? 0;
        if (a >= r.value) {
          reasons.push(`require_affinity_lt:${r.npcId}:${a}>=${r.value}`);
          return false;
        }
        return true;
      }
      case 'TIME_BETWEEN': {
        if (!s.time) {
          reasons.push('require_time_missing');
          return false;
        }
        const h = s.time.hour;
        const inRange =
          r.hourStart <= r.hourEnd
            ? h >= r.hourStart && h <= r.hourEnd
            : h >= r.hourStart || h <= r.hourEnd;
        if (!inRange) {
          reasons.push(`require_time_between:${r.hourStart}-${r.hourEnd}:got=${h}`);
          return false;
        }
        return true;
      }
    }
  }
}
