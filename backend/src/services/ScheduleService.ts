/**
 * ScheduleService — Phase 4.2 (FR-009 일과 시스템).
 *
 * Reference: requirements.md FR-009 (학생 쿄우스케의 일상 스케줄), FR-001
 * (NPC `schedule` field), DESIGN.md §"NPCState" `schedule: ScheduleEntry[]`,
 * §"Time System Design" Day Cycle, §"Backend Structure" `data/schedules/`.
 *
 * Responsibilities:
 *  - Load + validate JSON schedule files under `data/schedules/` at startup.
 *  - Resolve "given a (npcId, time, dayOfWeek), where is the NPC and what
 *    activity are they doing?" — used by the FE ScheduleSystem to teleport
 *    NPCs and surface the player's current expected activity.
 *  - Pure-function semantics — no mutation; the FE owns NPC positions.
 *
 * Design choices:
 *  - One JSON per NPC keyed by id (matches characters/ + events/ patterns).
 *  - Schedule entries declare a `[fromMinute, toMinute)` half-open interval
 *    in minute-of-day units (0..1440). `toMinute` may equal 1440 to mean
 *    "until midnight". No wrap-around within a single entry — split into
 *    two days if needed.
 *  - Default fallback: if no entry matches the (day, minute) lookup, return
 *    `{ locationId: <home>, activity: '휴식' }` where <home> is derived from
 *    the NPC's location convention. The home map is hardcoded here rather
 *    than read from the NPC roster — the schedule data is authoritative.
 *  - Malformed files are skipped with a console warning (matches EventService
 *    policy of "best-effort on listing").
 */

import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { z } from 'zod';

// --- Shared primitives -----------------------------------------------------

const dayOfWeekSchema = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

export type DayOfWeek = z.infer<typeof dayOfWeekSchema>;

const minuteSchema = z.number().int().min(0).max(1440);

const scheduleEntrySchema = z
  .object({
    days: z.array(dayOfWeekSchema).min(1),
    /** Inclusive start, in minute-of-day (0..1440). */
    fromMinute: minuteSchema,
    /** Exclusive end, in minute-of-day (0..1440). Must be > fromMinute. */
    toMinute: minuteSchema,
    locationId: z.string().min(1).max(64),
    activity: z.string().min(1).max(128),
  })
  .refine((e) => e.toMinute > e.fromMinute, {
    message: 'toMinute must be strictly greater than fromMinute',
  });

export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

const npcScheduleSchema = z.object({
  id: z.string().min(1).max(64),
  weekly: z.array(scheduleEntrySchema).min(1).max(64),
});

export type NPCSchedule = z.infer<typeof npcScheduleSchema>;

// --- Public lookup result --------------------------------------------------

export interface CurrentScheduleResult {
  locationId: string;
  activity: string;
}

export interface TimeOfDay {
  hour: number;
  minute: number;
}

// --- Default fallback locations -------------------------------------------
//
// When no schedule entry matches, the NPC is "at home doing nothing in
// particular". We hardcode the home map here rather than reaching across to
// the FE NPC roster — the schedule data is authoritative for placement.
const FALLBACK_HOME: Record<string, string> = {
  kyousuke: 'kyousuke-home',
  madoka: 'madoka-home',
  hikaru: 'hikaru-home',
  kurumi: 'kyousuke-home',
  manta: 'kyousuke-home',
  yusaku: 'school',
  seiko: 'cafe',
  masumi: 'park',
};

// --- Service ---------------------------------------------------------------

export interface ScheduleServiceOptions {
  scheduleDir: string;
}

export class ScheduleService {
  private readonly scheduleDir: string;
  private cache: Map<string, NPCSchedule> | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(opts?: Partial<ScheduleServiceOptions>) {
    const defaultDir = resolve(import.meta.dir, '..', 'data', 'schedules');
    this.scheduleDir = opts?.scheduleDir ?? defaultDir;
  }

  /** Eagerly load + validate all schedules. Idempotent / concurrency-safe. */
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
    const cache = new Map<string, NPCSchedule>();
    let files: string[] = [];
    try {
      files = await readdir(this.scheduleDir);
    } catch (err) {
      console.warn(
        `[ScheduleService] schedules dir not readable (${this.scheduleDir}):`,
        err,
      );
      this.cache = cache;
      return;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const path = resolve(this.scheduleDir, f);
      try {
        const raw = await Bun.file(path).json();
        const result = npcScheduleSchema.safeParse(raw);
        if (!result.success) {
          console.warn(
            `[ScheduleService] skipping malformed schedule ${f}:`,
            result.error.issues,
          );
          continue;
        }
        const parsed = result.data;
        const expectedId = f.replace(/\.json$/, '');
        if (parsed.id !== expectedId) {
          console.warn(
            `[ScheduleService] schedule ${f}: filename id "${expectedId}" != json id "${parsed.id}" — using json id.`,
          );
        }
        if (cache.has(parsed.id)) {
          console.warn(
            `[ScheduleService] duplicate schedule id "${parsed.id}" — keeping first.`,
          );
          continue;
        }
        cache.set(parsed.id, parsed);
      } catch (err) {
        console.warn(`[ScheduleService] failed to read ${f}:`, err);
      }
    }
    this.cache = cache;
  }

  /** List ids of NPCs with loaded schedules. */
  async listNPCIds(): Promise<string[]> {
    await this.ensureLoaded();
    return Array.from(this.cache!.keys()).sort();
  }

  /** Full weekly schedule for one NPC, or null if unknown. */
  async getSchedule(npcId: string): Promise<NPCSchedule | null> {
    await this.ensureLoaded();
    return this.cache!.get(npcId) ?? null;
  }

  /** All entries for a given day of the week (sorted by fromMinute). */
  async getScheduleForDay(
    npcId: string,
    dayOfWeek: DayOfWeek,
  ): Promise<ScheduleEntry[]> {
    await this.ensureLoaded();
    const sched = this.cache!.get(npcId);
    if (!sched) return [];
    return sched.weekly
      .filter((e) => e.days.includes(dayOfWeek))
      .slice()
      .sort((a, b) => a.fromMinute - b.fromMinute);
  }

  /**
   * Resolve the current schedule entry for one NPC. Returns the first entry
   * whose day matches and whose [fromMinute, toMinute) interval contains the
   * lookup minute. When nothing matches, returns the fallback home/휴식.
   */
  async getCurrentSchedule(
    npcId: string,
    time: TimeOfDay,
    dayOfWeek: DayOfWeek,
  ): Promise<CurrentScheduleResult> {
    await this.ensureLoaded();
    const sched = this.cache!.get(npcId);
    const minute = time.hour * 60 + time.minute;
    if (sched) {
      // Sort by fromMinute so deterministic; first matching entry wins.
      const candidates = sched.weekly
        .filter((e) => e.days.includes(dayOfWeek))
        .sort((a, b) => a.fromMinute - b.fromMinute);
      for (const e of candidates) {
        if (minute >= e.fromMinute && minute < e.toMinute) {
          return { locationId: e.locationId, activity: e.activity };
        }
      }
    }
    return this.fallbackFor(npcId);
  }

  /**
   * Bulk lookup — returns the current schedule for every NPC the service
   * knows about. Used by the FE to position NPCs each minute boundary.
   */
  async getAllCurrentSchedules(
    time: TimeOfDay,
    dayOfWeek: DayOfWeek,
  ): Promise<Record<string, CurrentScheduleResult>> {
    await this.ensureLoaded();
    const out: Record<string, CurrentScheduleResult> = {};
    for (const id of this.cache!.keys()) {
      out[id] = await this.getCurrentSchedule(id, time, dayOfWeek);
    }
    return out;
  }

  // --- internals -----------------------------------------------------------

  private fallbackFor(npcId: string): CurrentScheduleResult {
    const home = FALLBACK_HOME[npcId];
    return {
      locationId: home ?? 'kyousuke-home',
      activity: '휴식',
    };
  }
}

// --- Request schema (re-used by route layer) -------------------------------

export const currentScheduleRequestSchema = z.object({
  time: z.object({
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  dayOfWeek: dayOfWeekSchema,
});

export type CurrentScheduleRequest = z.infer<typeof currentScheduleRequestSchema>;
