import { useGameStore } from '@/store/gameStore';
import type { DayOfWeek } from '@/systems/TimeSystem';

/**
 * TimeDisplay (Phase 3.1 — FR-004 UI surface).
 *
 * Top-right HUD element rendered by App.tsx. Reads from the store via
 * primitive selectors so each field re-renders only when *that* field
 * changes — combined with TimeSystem's per-game-minute push gating, this
 * component re-renders at most once per game-minute (i.e. once per real
 * second at the default 1s = 1min acceleration), not on every PixiJS frame.
 *
 * Visual design:
 *   ┌──────────────────────┐
 *   │ Day 1                │   ← day counter
 *   │ 08:00                │   ← HH:MM (large, monospaced)
 *   │ 월요일 · 오전 수업    │   ← weekday + phase label
 *   └──────────────────────┘
 *
 * At night (밤) we tint the panel slightly purple and prepend a moon glyph
 * to the phase label so the phase change is visually obvious without
 * introducing a new layout. Day phases keep the existing orange-secondary
 * border from `.time-display` for visual continuity with the status panel.
 */

const KOREAN_WEEKDAY: Record<DayOfWeek, string> = {
  MON: '월요일',
  TUE: '화요일',
  WED: '수요일',
  THU: '목요일',
  FRI: '금요일',
  SAT: '토요일',
  SUN: '일요일',
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function TimeDisplay() {
  // Primitive selectors keep re-renders scoped: changing only `minute` won't
  // invoke the component's render function with a fresh object identity for
  // the other fields.
  const day = useGameStore((s) => s.time.day);
  const hour = useGameStore((s) => s.time.hour);
  const minute = useGameStore((s) => s.time.minute);
  const dayOfWeek = useGameStore((s) => s.time.dayOfWeek);
  const phaseLabel = useGameStore((s) => s.time.phaseLabel);

  const isNight = phaseLabel === '밤';
  // Layered classNames: keep the shared `.time-display` component class so
  // global CSS still applies (positioning + base background), then layer a
  // night-tint background on top via Tailwind's arbitrary value support.
  const className = [
    'time-display',
    'text-right',
    isNight ? 'bg-indigo-900/80 border-indigo-400' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const weekdayLabel = KOREAN_WEEKDAY[dayOfWeek];
  const phaseDisplay = isNight ? `🌙 ${phaseLabel}` : phaseLabel;

  // Phase 4.2 — kyousuke's current scheduled activity. Pulled from the
  // npcSchedules slice (kept fresh by ScheduleSystem). Until the first
  // /schedule/current fetch lands the slice is empty; we render a subtle
  // weekday/weekend fallback so the hint is never blank.
  const kyousukeActivity = useGameStore((s) => s.npcSchedules.kyousuke?.activity ?? null);
  const isWeekend = dayOfWeek === 'SAT' || dayOfWeek === 'SUN';
  const fallbackHint = isWeekend ? '주말 — 자유 시간' : '평일 일과';
  const activityHint = kyousukeActivity ?? fallbackHint;

  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      aria-label={`Day ${day}, ${pad2(hour)}시 ${pad2(minute)}분, ${weekdayLabel}, ${phaseLabel}, 일과: ${activityHint}`}
    >
      {/*
        Phase 5.1 — responsive condensation. On phones (<sm) we drop the
        Day counter row and the activity hint into a single inline strip
        so the chip stays out of the way; on tablets+ the full HUD shows.
      */}
      <p className="hidden sm:block text-xs text-gray-300 leading-tight">Day {day}</p>
      <p className="text-lg sm:text-2xl font-bold text-orange-primary leading-tight font-mono tracking-wider">
        {pad2(hour)}:{pad2(minute)}
      </p>
      <p className="text-[11px] sm:text-xs text-gray-200 leading-tight mt-0.5">
        <span className="sm:hidden">D{day} · </span>
        {weekdayLabel} · {phaseDisplay}
      </p>
      <p className="hidden sm:block text-xs text-orange-secondary leading-tight mt-0.5 italic">
        쿄우스케 일과: {activityHint}
      </p>
    </div>
  );
}
