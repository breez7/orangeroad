import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DialogHistoryEntry, Emotion } from '@/store/gameStore';
import { AffinityIndicator } from '@/ui/components/AffinityIndicator';

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
 * Layout: anchored bottom of the viewport (via the existing `.dialog-box`
 * Tailwind component class in globals.css), with a header (NPC name + close
 * button), a scrollable history pane (last ~10 turns), an optional error
 * banner, and an input row. The component is fully controlled — all state
 * lives in the gameStore; this is a pure render of those props plus a
 * single local `inputValue` field for the textbox.
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
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
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
      {/* Header — name + affinity/emotion indicator + close button. */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-base font-bold text-orange-primary shrink-0" data-testid="dialog-npc-name">
          {npcName ?? npcId}
        </h3>
        {/* Phase 3.3 — affinity + emotion at-a-glance (FR-007). */}
        <div className="flex-1 flex justify-end">
          <AffinityIndicator affinity={affinity} emotion={emotion} />
        </div>
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

      {/* History pane */}
      <div
        ref={scrollRef}
        className="bg-gray-900/60 rounded p-2 mb-2 h-40 overflow-y-auto text-sm space-y-1.5"
        data-testid="dialog-history"
      >
        {history.length === 0 && !isWaiting && (
          <p className="text-gray-400 text-xs italic animate-fade-in">
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
          disabled={isWaiting}
          maxLength={2000}
          placeholder="메시지를 입력하세요..."
          aria-label="대화 입력"
          className="flex-1 px-3 py-2 rounded bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:outline-none focus:border-orange-primary focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
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
  );
}

/**
 * Single chat bubble — user (right, orange) vs assistant (left, gray).
 *
 * Phase 5.1: each bubble fades+slides in via `animate-fade-in` + a small
 * translateY tween so a fresh assistant reply doesn't snap into place. The
 * scroll-pin in the parent's effect runs after layout, so the animation
 * doesn't fight the auto-scroll.
 */
function DialogTurn({ entry }: { entry: DialogHistoryEntry }) {
  const isUser = entry.role === 'user';
  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}
      data-testid={isUser ? 'dialog-turn-user' : 'dialog-turn-assistant'}
    >
      <div
        className={
          isUser
            ? 'max-w-[75%] px-3 py-1.5 rounded-lg rounded-br-sm bg-orange-primary text-white text-sm whitespace-pre-wrap break-words shadow-md'
            : 'max-w-[75%] px-3 py-1.5 rounded-lg rounded-bl-sm bg-gray-700 text-gray-100 text-sm whitespace-pre-wrap break-words shadow-md'
        }
      >
        {entry.content}
      </div>
    </div>
  );
}
