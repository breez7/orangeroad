import { useEffect, useState } from 'react';

/**
 * HelpPanel (Phase 5.1 — UX affordance).
 *
 * A floating circular "?" button anchored to the bottom-right of the
 * viewport. Clicking it opens an inline modal listing the core controls
 * a first-time player needs. Five-to-seven bullets max — this is a quick
 * reference, not a manual.
 *
 * Visual: same `.panel-glass` material as the rest of the floating UI
 * so it feels like part of the chrome rather than a foreign tooltip.
 *
 * Keyboard:
 *   - The "?" trigger is a normal <button> — focusable, gets the
 *     standard `:focus-visible` ring.
 *   - Esc closes the panel while open.
 *   - Click on backdrop closes the panel.
 */
export function HelpPanel() {
  const [open, setOpen] = useState(false);

  // Esc to close — bound only while open so we don't shadow other dialog
  // listeners. A dialog box is also listening for Esc, so we let both
  // run; when the help panel is on top it consumes the press first
  // because event listeners fire in registration order.
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute bottom-4 right-4 btn-icon panel-glass ui-interactive"
        aria-label="도움말 열기"
        title="도움말"
      >
        <span aria-hidden className="text-orange-primary font-bold">?</span>
      </button>

      {open && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-auto animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label="도움말"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="panel-glass mx-4 p-5 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-orange-primary">도움말</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-icon"
                aria-label="도움말 닫기"
              >
                ×
              </button>
            </div>

            <ul className="space-y-2 text-sm text-gray-200">
              <li className="flex gap-2">
                <span aria-hidden className="text-orange-secondary">•</span>
                <span>
                  <span className="font-semibold text-white">화면을 클릭</span>해
                  플레이어를 이동시킵니다.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-orange-secondary">•</span>
                <span>
                  NPC에게 가까이 다가가
                  <span className="font-semibold text-white"> NPC를 클릭</span>하면
                  대화가 시작됩니다.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-orange-secondary">•</span>
                <span>
                  대화 중에는 <kbd className="px-1.5 py-0.5 rounded bg-gray-700 text-xs">Enter</kbd>
                  로 전송, <kbd className="px-1.5 py-0.5 rounded bg-gray-700 text-xs">Esc</kbd>
                  로 닫을 수 있습니다.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-orange-secondary">•</span>
                <span>
                  화면 우측 상단의 <span className="font-semibold text-white">시계</span>가
                  현재 시간 / 요일 / 일과를 알려줍니다.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-orange-secondary">•</span>
                <span>
                  좌측 상단의 <span className="font-semibold text-white">세이브 / 로드</span>
                  버튼으로 진행 상황을 저장하거나 불러올 수 있습니다.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-orange-secondary">•</span>
                <span>
                  스토리 이벤트가 시작되면 화면 하단 패널을 클릭(또는
                  <kbd className="px-1.5 py-0.5 rounded bg-gray-700 text-xs mx-1">Space</kbd>)
                  으로 다음 장면으로 진행합니다.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-orange-secondary">•</span>
                <span>
                  호감도와 감정은 대화 헤더에서 확인할 수 있습니다.
                  관계가 깊어질수록 대화가 풍부해집니다.
                </span>
              </li>
            </ul>

            <div className="mt-4 flex justify-end">
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
