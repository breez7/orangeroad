import { useEffect, useState } from 'react';
import type { StoryEvent } from '@/api/client';
import { getEvent } from '@/api/client';
import { useGameStore } from '@/store/gameStore';

export interface StoryOverlayProps {
  /** The npc-id → display-name map (so we can render a "speaker" header). */
  npcNames: Record<string, string>;
  /** Confirm-step callback wired to the StorySystem. */
  onConfirm: () => void;
}

/**
 * StoryOverlay — Phase 4.1 (FR-006).
 *
 * Renders the currently-active scripted step (narration or dialog) above the
 * PixiJS canvas while a story event is playing. Backed by the gameStore's
 * `story` slice; the StorySystem advances the cursor and this component
 * re-renders to show the next frame.
 *
 * Visual style: full-width bottom panel similar to DialogBox but distinguished
 * by the absence of the chat input + a softer, "scene script" tone. The
 * narration variant centers text and uses an italicised gray; the dialog
 * variant shows the speaker name in orange.
 *
 * Interaction:
 *   - Click anywhere on the overlay → confirm.
 *   - Enter / Space → confirm.
 *   - The "▼ 계속하기" / "▶ 다음" button is the explicit affordance.
 *
 * The component fetches the event script once per active id (so it knows the
 * step contents to render) and caches it in component state. The StorySystem
 * also caches independently — the duplication is intentional: the overlay
 * doesn't reach into the system imperatively, it just reads the store + the
 * id, then asks the backend for the script.
 */
export function StoryOverlay({ npcNames, onConfirm }: StoryOverlayProps) {
  const activeEventId = useGameStore((s) => s.story.activeEventId);
  const stepIndex = useGameStore((s) => s.story.stepIndex);

  const [script, setScript] = useState<StoryEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch the script when an event becomes active. Aborted when the id changes
  // or when the overlay unmounts.
  useEffect(() => {
    setScript(null);
    setLoadError(null);
    if (!activeEventId) return;
    const ctrl = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const e = await getEvent(activeEventId, { signal: ctrl.signal });
        if (cancelled) return;
        setScript(e);
      } catch {
        if (cancelled) return;
        setLoadError('이벤트를 불러올 수 없습니다.');
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [activeEventId]);

  // Keyboard: Enter / Space → confirm. Bound only while overlay is visible.
  useEffect(() => {
    if (!activeEventId) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeEventId, onConfirm]);

  if (!activeEventId) return null;

  const step = script?.steps[stepIndex] ?? null;
  // Render a faint placeholder while loading rather than nothing — this keeps
  // movement/dialog locked (StorySystem.isEventActive stays true).
  const showPlaceholder = !script || !step;

  // Only narration + dialog steps are interactive. If the cursor is on a
  // side-effect step (e.g. set_flag) the StorySystem advances synchronously
  // and we re-render with the next step — but if rendering catches us
  // mid-transition, fall back to a continue button.
  const isNarration = step?.type === 'narration';
  const isDialog = step?.type === 'dialog';

  let speakerName: string | null = null;
  let bodyText = '';
  if (step) {
    if (step.type === 'dialog') {
      speakerName = npcNames[step.speaker] ?? step.speaker;
      bodyText = step.text;
    } else if (step.type === 'narration') {
      bodyText = step.text;
    }
  }

  return (
    <div
      className="absolute inset-x-0 bottom-0 px-4 pb-4 pointer-events-none animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="스토리 이벤트"
      data-testid="story-overlay"
      data-event-id={activeEventId}
      data-step-index={stepIndex}
    >
      {/* Re-key on activeEventId + stepIndex so each new step remounts the
          card, replaying the slide+fade animation — a soft cue between
          narration / dialog frames without doing a fade-out on exit. */}
      <div
        key={`${activeEventId}-${stepIndex}`}
        className="mx-auto max-w-2xl panel-glass p-4 pointer-events-auto cursor-pointer animate-slide-up"
        onClick={onConfirm}
        data-testid="story-card"
      >
        {loadError && (
          <p className="text-red-300 text-sm mb-2" role="alert">
            {loadError}
          </p>
        )}

        {showPlaceholder && !loadError && (
          <p className="text-gray-400 text-sm italic">...</p>
        )}

        {isDialog && speakerName && (
          <h3 className="text-orange-primary font-bold mb-1.5 text-base">
            {speakerName}
          </h3>
        )}

        {(isDialog || isNarration) && (
          <p
            className={
              isNarration
                ? 'text-gray-200 italic whitespace-pre-line text-sm leading-relaxed'
                : 'text-white whitespace-pre-line text-base leading-relaxed'
            }
            data-testid="story-text"
          >
            {bodyText}
          </p>
        )}

        <div className="flex justify-end mt-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onConfirm();
            }}
            className="btn-game text-sm"
            data-testid="story-continue"
          >
            {isDialog ? '▶ 다음' : '▼ 계속하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
