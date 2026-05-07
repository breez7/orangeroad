/**
 * TimeSystem (Phase 3.1 — FR-004 / FR-009 prerequisite)
 *
 * Owns the in-game clock. Per `DESIGN.md` §"Time System Design" the original
 * spec was 1 real-second = 1 game-minute. Phase 5.3 doubled the default to
 * 2 real-seconds per game-minute (so a full game-day takes ~48 real-minutes
 * instead of ~24) — the spec rate left no room to read NPC dialog before the
 * next schedule tick fired, and dropping the rate to half is the smallest
 * change that gives players time to breathe between events. The constant is
 * still configurable via {@link TimeSystemOptions.secondsPerGameMinute}, so
 * cutscenes / debug tools can revert to the spec rate when needed.
 *
 * Responsibilities (Phase 3.1 only):
 * - Tick a `GameTime` ({day, hour, minute}) at a configurable acceleration.
 * - Derive `DayOfWeek` from `day` (day 1 = Monday).
 * - Derive a Korean phase label (아침 / 오전 / 점심 / 오후 / 방과후 / 저녁 / 밤)
 *   from the current hour using DESIGN.md's Day Cycle, with the slight
 *   refinement that 방과후 starts at 15:30 (matching FR-009's 방과후 phase
 *   right after the last class period).
 * - Push the derived snapshot into the Zustand store **only when a game-minute
 *   actually advances**, never every render frame — this keeps React selectors
 *   from re-rendering at 60Hz while still giving us minute-level resolution.
 *
 * Explicitly NOT in scope (deferred to later phases per CLAUDE.md):
 * - NPC schedules / 일과 (Phase 4.2)
 * - Time-triggered story events (Phase 4.1)
 * - Save/load of time (Phase 3.2)
 *
 * StrictMode lifecycle: this class holds no DOM listeners, no timers, and no
 * subscriptions — it only mutates internal counters and calls
 * `useGameStore.getState().setTime(...)`. A second instance from React's
 * double-invoke is therefore harmless; the eventually-discarded one stops
 * being ticked when its owning scene is destroyed.
 */

import { useGameStore } from '@/store/gameStore';

export interface GameTime {
  /** 1-indexed day counter. Day 1 = Monday. */
  day: number;
  /** 0..23 */
  hour: number;
  /** 0..59 */
  minute: number;
}

export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

const DAY_OF_WEEK_ORDER: readonly DayOfWeek[] = [
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
  'SUN',
];

export type PhaseLabel =
  | '아침'
  | '오전 수업'
  | '점심시간'
  | '오후 수업'
  | '방과후'
  | '저녁'
  | '밤';

export interface TimeSystemOptions {
  startDay?: number;
  startHour?: number;
  startMinute?: number;
  /**
   * Real seconds per one game-minute. Default 2 — Phase 5.3 tuning slowed
   * the original 1s/min spec down so a full in-game day takes ~48 real
   * minutes instead of ~24, giving players more time to read dialog and
   * watch NPCs before the schedule ticks the next minute. Cutscenes /
   * cheats may temporarily change this via {@link TimeSystem.setSpeed}
   * (which divides this value).
   */
  secondsPerGameMinute?: number;
}

export class TimeSystem {
  private day: number;
  private hour: number;
  private minute: number;

  /** Accumulator of *effective* real seconds since the last minute tick. */
  private accumulator = 0;

  /** Base configuration: real seconds per game minute (before speed mult). */
  private readonly baseSecondsPerMinute: number;

  /** Speed multiplier; effectiveSecondsPerMinute = base / speed. */
  private speed = 1;

  private paused = false;

  /**
   * Last snapshot pushed to the store. We only push when one of these fields
   * actually changes — the inner accumulator can advance for nearly a full
   * second each frame without producing any store write.
   */
  private lastPushed: {
    day: number;
    hour: number;
    minute: number;
    dayOfWeek: DayOfWeek;
    phaseLabel: PhaseLabel;
  } | null = null;

  constructor(opts: TimeSystemOptions = {}) {
    this.day = opts.startDay ?? 1;
    // Day 1 is Saturday 10:30 — see gameStore.initialTime for the rationale
    // (weekend lets NPCs scatter naturally on the very first morning).
    this.hour = opts.startHour ?? 10;
    this.minute = opts.startMinute ?? 30;
    this.baseSecondsPerMinute = opts.secondsPerGameMinute ?? 2;

    // Push initial snapshot so UI shows the start state immediately, before
    // the first frame ticks.
    this.pushSnapshot();
  }

  /**
   * Per-frame tick. `dt` is real seconds since the previous frame.
   *
   * Uses an accumulator so partial frame deltas (e.g. 16.6ms) don't get lost:
   * once the accumulator crosses `effectiveSecondsPerMinute`, we advance the
   * clock by one game-minute and subtract that threshold. The `while` loop
   * handles the (rare) case of a long frame stutter that should advance
   * multiple game-minutes at once.
   */
  update(dt: number): void {
    if (this.paused) return;
    if (dt <= 0) return;

    this.accumulator += dt * this.speed;
    const threshold = this.baseSecondsPerMinute;

    let advanced = false;
    // Guard against runaway loops (e.g. tab-resume gives a huge dt). Cap the
    // catch-up at ~1 game-day worth of minutes per frame; anything beyond
    // that is treated as "lost time" and dropped.
    let safety = 24 * 60;
    while (this.accumulator >= threshold && safety-- > 0) {
      this.accumulator -= threshold;
      this.tickMinute();
      advanced = true;
    }

    if (advanced) this.pushSnapshot();
  }

  /** Snapshot of current game time. */
  getTime(): GameTime {
    return { day: this.day, hour: this.hour, minute: this.minute };
  }

  getDayOfWeek(): DayOfWeek {
    // `day` is 1-indexed and day 1 = SAT (이사 오는 날 = 토요일). Story-wise,
    // moving in on a weekend day is more natural than a Monday morning, and
    // it puts NPCs on weekend schedules (park / cafe / home) on day 1 instead
    // of clustering them all at school for "오전 수업".
    const idx = ((this.day - 1 + 5) % 7 + 7) % 7; // 0..6 → MON..SUN; +5 anchors day 1 to SAT
    return DAY_OF_WEEK_ORDER[idx]!;
  }

  /**
   * Korean phase label derived from `hour` (and `minute`, since 방과후 starts
   * at 15:30, mid-hour). Boundaries (inclusive-start, exclusive-end except
   * for the wrap-around 밤 case):
   *   06:00–07:59 아침
   *   08:00–11:59 오전 수업
   *   12:00–12:59 점심시간
   *   13:00–15:29 오후 수업
   *   15:30–17:59 방과후
   *   18:00–21:59 저녁
   *   22:00–05:59 밤  (wraps midnight)
   */
  getPhaseLabel(): PhaseLabel {
    const h = this.hour;
    const m = this.minute;
    if (h >= 22 || h < 6) return '밤';
    if (h < 8) return '아침';
    if (h < 12) return '오전 수업';
    if (h < 13) return '점심시간';
    if (h < 15 || (h === 15 && m < 30)) return '오후 수업';
    if (h < 18) return '방과후';
    return '저녁';
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Multiplier on the real → game-time rate. `1` is normal; `2` makes time
   * pass twice as fast; `0.5` half. Reserved for future cheats / cutscenes;
   * Phase 3.1 leaves this at 1.0 and exposes no UI toggle.
   */
  setSpeed(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    this.speed = multiplier;
  }

  /**
   * Phase 3.2 — restore the clock from a save (FR-008).
   *
   * Resets the sub-minute accumulator so loading mid-tick doesn't immediately
   * advance another minute. After updating internal counters we push a fresh
   * snapshot to the store (recomputing dayOfWeek + phaseLabel from the new
   * day/hour/minute, ignoring whatever was in the save — the save's labels
   * are debug-only).
   */
  setTime(time: GameTime): void {
    const day = Math.max(1, Math.floor(time.day));
    const hour = Math.min(23, Math.max(0, Math.floor(time.hour)));
    const minute = Math.min(59, Math.max(0, Math.floor(time.minute)));
    this.day = day;
    this.hour = hour;
    this.minute = minute;
    this.accumulator = 0;
    // Force a snapshot push by clearing lastPushed — the new time may equal
    // the old `lastPushed` if a load is a no-op, in which case the store-
    // side dedupe will short-circuit anyway.
    this.lastPushed = null;
    this.pushSnapshot();
  }

  // ---------- internals ----------

  private tickMinute(): void {
    this.minute += 1;
    if (this.minute >= 60) {
      this.minute = 0;
      this.hour += 1;
      if (this.hour >= 24) {
        this.hour = 0;
        this.day += 1;
      }
    }
  }

  /**
   * Push current state to the store *iff* something visible changed. The
   * store-side `setTime` does another shallow check, but doing it here too
   * means we don't even create the object on no-op frames (post-init the
   * accumulator can run for ~1 real-second between mutations).
   */
  private pushSnapshot(): void {
    const dayOfWeek = this.getDayOfWeek();
    const phaseLabel = this.getPhaseLabel();
    const last = this.lastPushed;
    if (
      last &&
      last.day === this.day &&
      last.hour === this.hour &&
      last.minute === this.minute &&
      last.dayOfWeek === dayOfWeek &&
      last.phaseLabel === phaseLabel
    ) {
      return;
    }
    this.lastPushed = {
      day: this.day,
      hour: this.hour,
      minute: this.minute,
      dayOfWeek,
      phaseLabel,
    };
    useGameStore.getState().setTime({
      day: this.day,
      hour: this.hour,
      minute: this.minute,
      dayOfWeek,
      phaseLabel,
    });
  }
}
