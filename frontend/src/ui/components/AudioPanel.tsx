import { useCallback, useEffect, useState } from 'react';
import { useGameStore } from '@/store/gameStore';

/**
 * AudioPanel (Phase 5.2 — Issue #15 사운드/이펙트).
 *
 * Floating circular speaker button anchored bottom-right (next to the help
 * "?" button). Clicking it opens a small inline panel with the audio mixer:
 *   - 음악 (BGM) volume slider 0..100
 *   - 효과음 (SFX) volume slider 0..100
 *   - 음소거 toggle
 *   - 배경음악 사용 toggle (BGM on/off, since procedural pad isn't to
 *     everyone's taste)
 *
 * State lives in the gameStore audio slice; this component is a thin
 * controller. App.tsx subscribes to the slice and applies changes to the
 * AudioEngine. The save payload also carries this slice so user choices
 * survive a save/load round-trip.
 *
 * Visual: same `.panel-glass` material + same icon-button style as the
 * help panel so the two affordances feel like a pair.
 */
export function AudioPanel() {
  const [open, setOpen] = useState(false);
  const audio = useGameStore((s) => s.audio);
  const setMusicVolume = useGameStore((s) => s.setMusicVolume);
  const setSfxVolume = useGameStore((s) => s.setSfxVolume);
  const setMuted = useGameStore((s) => s.setMuted);
  const setBgmEnabled = useGameStore((s) => s.setBgmEnabled);

  // Esc to close — bound only while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Slider handlers map 0..100 → 0..1 store units.
  const onMusicChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.currentTarget.value) / 100;
      setMusicVolume(v);
    },
    [setMusicVolume],
  );
  const onSfxChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.currentTarget.value) / 100;
      setSfxVolume(v);
    },
    [setSfxVolume],
  );

  // Speaker icon character — picked to roughly track muted state without
  // pulling in an SVG icon library.
  const icon = audio.muted ? '🔇' : audio.musicVolume + audio.sfxVolume === 0 ? '🔈' : '🔊';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute bottom-4 right-20 btn-icon panel-glass ui-interactive"
        aria-label="사운드 설정 열기"
        title="사운드 설정"
      >
        <span aria-hidden className="text-orange-primary">
          {icon}
        </span>
      </button>

      {open && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-auto animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label="사운드 설정"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="panel-glass mx-4 p-5 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-orange-primary">사운드 설정</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-icon"
                aria-label="사운드 설정 닫기"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              {/* Music volume slider */}
              <label className="block">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-semibold text-gray-100">음악</span>
                  <span className="text-xs text-gray-400">
                    {Math.round(audio.musicVolume * 100)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(audio.musicVolume * 100)}
                  onChange={onMusicChange}
                  disabled={audio.muted}
                  className="w-full accent-orange-primary disabled:opacity-50"
                  aria-label="음악 볼륨"
                />
              </label>

              {/* SFX volume slider */}
              <label className="block">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-semibold text-gray-100">효과음</span>
                  <span className="text-xs text-gray-400">
                    {Math.round(audio.sfxVolume * 100)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(audio.sfxVolume * 100)}
                  onChange={onSfxChange}
                  disabled={audio.muted}
                  className="w-full accent-orange-primary disabled:opacity-50"
                  aria-label="효과음 볼륨"
                />
              </label>

              {/* Toggles */}
              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-sm text-gray-100">배경음악 사용</span>
                  <input
                    type="checkbox"
                    checked={audio.bgmEnabled}
                    onChange={(e) => setBgmEnabled(e.currentTarget.checked)}
                    className="w-5 h-5 accent-orange-primary"
                    aria-label="배경음악 토글"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-sm text-gray-100">음소거</span>
                  <input
                    type="checkbox"
                    checked={audio.muted}
                    onChange={(e) => setMuted(e.currentTarget.checked)}
                    className="w-5 h-5 accent-orange-primary"
                    aria-label="음소거 토글"
                  />
                </label>
              </div>

              <p className="text-xs text-gray-400 pt-2 leading-relaxed">
                * 배경음악은 절차적으로 생성되는 차분한 패드입니다. 처음 클릭
                시점부터 재생됩니다 (브라우저 정책).
              </p>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-game text-sm"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
