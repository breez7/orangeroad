import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { DialogHistoryEntry, Emotion } from '@/store/gameStore';
import { AffinityIndicator } from '@/ui/components/AffinityIndicator';
import { NpcPortrait } from '@/ui/components/NpcPortrait';

export interface DialogBoxProps {
  open: boolean;
  npcId: string | null;
  npcName: string | null;
  history: DialogHistoryEntry[];
  isWaiting: boolean;
  error: string | null;
  /** Phase 3.3 — current affinity with the open NPC (0-100). */
  affinity: number;
  /** Phase 3.3 — current emotion of the open NPC. */
  emotion: Emotion;
  onSend: (message: string) => void;
  onClose: () => void;
}

/**
 * Dialog overlay (FR-003). Rendered by App.tsx above the PixiJS canvas.
 *
 * Phase B-3 (#22) — Doukyusei-style redesign. The panel is now a two-column
 * layout: a 140 px portrait column (NpcPortrait + AffinityIndicator) on the
 * left and the existing header / history / input on the right. Below the
 * `sm` breakpoint the portrait collapses into a small inline chip in the
 * header so the dialog still fits a 320 px viewport. The frame uses the
 * shared `.dialog-frame` (Doukyusei-toned gradient) so it visually pairs
 * with the StoryOverlay.
 *
 * Keyboard:
 * - Enter sends (Shift+Enter is reserved for future multi-line input but
 *   currently still sends to keep the input simple).
 * - Escape closes the dialog. Bound at the document level only while open
 *   so the canvas keyboard surface (future) isn't shadowed.
 *
 * Pointer events: the `.dialog-box` class sets `pointer-events: auto`, so
 * clicks on the input do not fall through to the PixiJS canvas underneath.
 *
 * Auto-scroll: every time `history` or `isWaiting` changes, the scroll
 * container is pinned to the bottom so the latest message is always visible.
 *
 * IME / Korean input: the keydown handler differentiates the Enter that
 * commits an IME composition from the Enter that submits — see
 * `composingRef` / `justComposedRef` below. **Do not change** without
 * re-running the playthrough spec; the Korean send-on-Enter behavior is
 * the regression magnet here.
 */
export function DialogBox({
  open,
  npcId,
  npcName,
  history,
  isWaiting,
  error,
  affinity,
  emotion,
  onSend,
  onClose,
}: DialogBoxProps) {
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track IME composition state. Korean/Japanese/Chinese input methods fire
  // keydown(Enter) with isComposing=true to *commit* a composition; users
  // expect that first Enter to commit and the next Enter to actually send.
  // We use a ref because the keydown handler reads it on the same tick that
  // compositionend fires, and refs sidestep React's batched setState.
  const composingRef = useRef(false);
  // Suppresses the Enter that committed an IME composition — that keydown
  // arrives after compositionend in some browsers (Chrome/Edge), so we have
  // to filter it out for one keystroke.
  const justComposedRef = useRef(false);

  // Auto-scroll history to the bottom whenever it changes (or while waiting,
  // so the typing indicator stays visible). Using scrollTop = scrollHeight
  // is sufficient — no smooth scroll, the box is short.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, history, isWaiting]);

  // Focus the input when the dialog opens (or when switching NPCs while
  // open). Skip when waiting since the input is disabled and would steal
  // nothing useful.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open, npcId]);

  // Global Escape-to-close. Bound only while open to avoid leaking the
  // listener and to leave Escape free for other UI later.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !npcId) return null;

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isWaiting) return;
    onSend(trimmed);
    setInputValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // Korean IME: the Enter that *commits* a composition arrives with
    // isComposing=true (or right after compositionend on some browsers).
    // We swallow it once so users don't have to press Enter twice.
    if (e.nativeEvent.isComposing || composingRef.current || justComposedRef.current) {
      justComposedRef.current = false;
      return;
    }
    e.preventDefault();
    handleSend();
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };
  const handleCompositionEnd = () => {
    composingRef.current = false;
    // Some Chromium versions emit compositionend BEFORE the keydown that
    // commits the IME — flag the next keydown so it's swallowed.
    justComposedRef.current = true;
    // Clear the flag after one tick if no Enter follows, so a subsequent
    // typed Enter still sends.
    setTimeout(() => {
      justComposedRef.current = false;
    }, 0);
  };

  return (
    <div
      className="dialog-box animate-slide-up"
      role="dialog"
      aria-modal="false"
      aria-label={`${npcName ?? npcId}와의 대화`}
      data-testid="dialog-box"
      data-npc-id={npcId}
    >
      {/* Phase B-3 — two-column flex. The portrait column has a fixed 140px
          width on `sm+` and shrinks to a small ~48px chip below `sm` so a
          narrow viewport can still fit the chat. AffinityIndicator is
          rendered exactly once so strict-mode locators in the integration
          test resolve uniquely. */}
      <div className="flex gap-3 sm:gap-4 items-stretch">
        {/* Portrait column. Below `sm` the SVG shrinks to ~48px; the
            outer column's width follows. The portrait itself is decorative
            (aria-hidden) — name + emotion are announced separately. */}
        <aside className="shrink-0 flex flex-col items-center gap-2 w-12 sm:w-[140px]">
          <div className="rounded-full sm:rounded-xl overflow-hidden border border-orange-primary/40 shadow-md bg-gradient-to-b from-orange-200/15 to-transparent">
            {/* CSS-only responsive size swap. Two SVGs in DOM is acceptable
                because the portrait carries no test-relevant role/aria. */}
            <span className="sm:hidden block">
              <NpcPortrait npcId={npcId} emotion={emotion} size={48} />
            </span>
            <span className="hidden sm:block">
              <NpcPortrait npcId={npcId} emotion={emotion} size={140} />
            </span>
          </div>
          {/* AffinityIndicator on sm+ only. Strict-mode test locators rely
              on `[role="progressbar"]` resolving to exactly one DOM node,
              so we deliberately avoid duplicating the indicator at smaller
              breakpoints — the small portrait chip + its emotion-driven
              face carry the mood read on phone-width viewports. */}
          <div className="hidden sm:flex w-full justify-center">
            <AffinityIndicator affinity={affinity} emotion={emotion} />
          </div>
        </aside>

        {/* Conversation column. Min-width:0 lets the flex child shrink
            properly so long words / messages wrap inside the bubbles. */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Header — name + close. The AffinityIndicator is rendered
              exactly once in the portrait column above; we deliberately
              don't duplicate it here so the strict-mode `[role="progressbar"]`
              test locator resolves uniquely. */}
          <div className="flex items-center gap-2 mb-2">
            <h3
              className="text-base font-bold text-orange-primary shrink-0"
              data-testid="dialog-npc-name"
            >
              {npcName ?? npcId}
            </h3>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="btn-icon"
              aria-label="대화 닫기"
              data-testid="dialog-close"
            >
              <span aria-hidden>×</span>
            </button>
          </div>

          {/* Error banner — small shake animation on appearance to draw the eye. */}
          {error && (
            <div
              className="mb-2 px-3 py-2 rounded bg-red-900/60 border border-red-500 text-red-100 text-xs animate-shake"
              role="alert"
              aria-live="assertive"
            >
              {error}
            </div>
          )}

          {/* History pane — slightly taller than before (h-44) since the
              portrait column gives us vertical real estate to spend. */}
          <div
            ref={scrollRef}
            className="bg-gray-900/55 rounded-lg p-2.5 mb-2 h-44 overflow-y-auto text-sm space-y-2 border border-white/5"
            data-testid="dialog-history"
          >
            {history.length === 0 && !isWaiting && (
              <p className="text-gray-400 text-xs italic animate-fade-in text-ko">
                {npcName ?? '상대'}에게 말을 걸어보세요...
              </p>
            )}
            {/* Render only the last 10 turns to keep DOM cheap; full history
                is preserved server-side and refreshed on every send. */}
            {history.slice(-10).map((entry, idx) => (
              <DialogTurn key={`${entry.ts ?? idx}-${idx}`} entry={entry} />
            ))}
            {isWaiting && (
              <div className="flex items-center gap-2 text-gray-300 text-xs animate-fade-in">
                <span className="inline-block w-3 h-3 spinner" aria-hidden />
                <span>{npcName ?? 'NPC'}이(가) 답변 중...</span>
              </div>
            )}
          </div>

          {/* Input row */}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              disabled={isWaiting}
              maxLength={2000}
              placeholder="메시지를 입력하세요..."
              aria-label="대화 입력"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-gray-700/80 text-white placeholder-gray-400 border border-gray-600 focus:outline-none focus:border-orange-primary focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              data-testid="dialog-input"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isWaiting || inputValue.trim().length === 0}
              className="btn-game"
              aria-label="전송"
              data-testid="dialog-send"
            >
              전송
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Single chat bubble — user (right, orange) vs assistant (left, gray).
 *
 * Phase B-3 (#22): bubbles get a tiny CSS triangle "tail" pointing back at
 * the speaker via the `chat-bubble-them` / `chat-bubble-me` utility classes
 * in globals.css. Each variant sets `--bubble-bg` inline so the tail color
 * stays in sync with the bubble.
 */
function DialogTurn({ entry }: { entry: DialogHistoryEntry }) {
  const isUser = entry.role === 'user';

  // CSS variable used by the `::after` tail in globals.css. Inline-styled
  // so a future color tweak only needs to change one place.
  const bubbleStyle: CSSProperties = isUser
    ? { ['--bubble-bg' as string]: '#ff6b35' }
    : { ['--bubble-bg' as string]: '#374151' };

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}
      data-testid={isUser ? 'dialog-turn-user' : 'dialog-turn-assistant'}
    >
      <div
        style={bubbleStyle}
        className={
          isUser
            ? 'chat-bubble-me max-w-[78%] px-3 py-1.5 rounded-2xl rounded-br-sm bg-orange-primary text-white text-sm whitespace-pre-wrap break-words shadow-md text-ko'
            : 'chat-bubble-them max-w-[78%] px-3 py-1.5 rounded-2xl rounded-bl-sm bg-gray-700 text-gray-100 text-sm whitespace-pre-wrap break-words shadow-md text-ko'
        }
      >
        {entry.content}
      </div>
    </div>
  );
}
