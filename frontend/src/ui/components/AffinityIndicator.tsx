import type { Emotion } from '@/store/gameStore';

/**
 * AffinityIndicator — Phase 3.3 (FR-007) UI sliver.
 *
 * A compact two-row indicator that lives in the DialogBox header:
 *   1. emotion emoji + Korean label
 *   2. 0-100 affinity bar with color grade
 *
 * Color grade thresholds are deliberately coarse — the player should feel
 * "low / mid / high" rather than read a precise number. Numeric value is
 * still shown next to the bar for legibility.
 */

export interface AffinityIndicatorProps {
  affinity: number;
  emotion: Emotion;
}

const EMOTION_META: Record<Emotion, { emoji: string; label: string }> = {
  neutral: { emoji: '😐', label: '평온' },
  happy: { emoji: '😊', label: '기쁨' },
  sad: { emoji: '😢', label: '슬픔' },
  angry: { emoji: '😠', label: '분노' },
  shy: { emoji: '😳', label: '수줍음' },
  flirty: { emoji: '😘', label: '설렘' },
  annoyed: { emoji: '😒', label: '짜증' },
};

/** Map affinity to a Tailwind bg color class. Three bands. */
function affinityColor(v: number): string {
  if (v < 30) return 'bg-red-500';
  if (v < 70) return 'bg-yellow-400';
  return 'bg-green-500';
}

export function AffinityIndicator({ affinity, emotion }: AffinityIndicatorProps) {
  const meta = EMOTION_META[emotion];
  // Clamp defensively — server already clamps, but a stale state could leak
  // an out-of-range value into render.
  const clamped = Math.max(0, Math.min(100, Math.round(affinity)));
  const widthPct = `${clamped}%`;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1" title={meta.label}>
        <span aria-hidden className="text-base leading-none">{meta.emoji}</span>
        <span className="text-gray-300">{meta.label}</span>
      </span>
      <div className="flex items-center gap-1">
        <div
          className="w-20 h-2 bg-gray-700 rounded overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped}
          aria-label="호감도"
        >
          <div
            className={`h-full ${affinityColor(clamped)}`}
            style={{ width: widthPct, transition: 'width 400ms ease-out, background-color 300ms ease-out' }}
          />
        </div>
        <span className="text-gray-300 tabular-nums w-7 text-right">{clamped}</span>
      </div>
    </div>
  );
}
