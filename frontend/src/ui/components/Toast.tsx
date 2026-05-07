import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Toast / snackbar system (Phase 5.1 — FR §"User feedback").
 *
 * A tiny self-contained Zustand store + React renderer. Lives in its own
 * module rather than the main `gameStore` because:
 *   - Toasts are pure UI state (no save serialisation, no game-tick churn).
 *   - Components anywhere in the tree can fire one via `useToast().push(...)`
 *     without wiring through props or coupling to the game lifecycle.
 *
 * Features:
 *   - Auto-dismiss after `duration` ms (default 3000).
 *   - Stacks in display order; max 5 visible to avoid runaway lists.
 *   - Three kinds: 'success' (green border), 'error' (red border), 'info'.
 *   - Click anywhere on a toast (or its × button) to dismiss early.
 *   - Korean copy throughout — caller passes the message string verbatim.
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
  /** Auto-dismiss delay (ms); pass 0 for sticky. */
  duration: number;
  /** Wall-clock ms when this toast was created. */
  createdAt: number;
}

interface ToastStore {
  toasts: ToastEntry[];
  push: (kind: ToastKind, message: string, duration?: number) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

const MAX_VISIBLE = 5;
let nextId = 1;

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (kind, message, duration = 3000) => {
    const id = nextId++;
    const entry: ToastEntry = {
      id,
      kind,
      message,
      duration,
      createdAt: Date.now(),
    };
    set((state) => {
      // Trim from the front if we'd overflow MAX_VISIBLE — oldest goes first.
      const next = [...state.toasts, entry];
      while (next.length > MAX_VISIBLE) next.shift();
      return { toasts: next };
    });
    return id;
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/**
 * Hook returning a stable api for firing toasts from anywhere.
 *
 * Example:
 *   const toast = useToast();
 *   toast.success('저장했습니다.');
 *   toast.error('서버에 연결할 수 없습니다.');
 *   toast.info('새로운 이벤트가 발생했습니다.');
 */
export function useToast(): {
  push: (kind: ToastKind, message: string, duration?: number) => number;
  success: (message: string, duration?: number) => number;
  error: (message: string, duration?: number) => number;
  info: (message: string, duration?: number) => number;
  dismiss: (id: number) => void;
} {
  const push = useToastStore((s) => s.push);
  const dismiss = useToastStore((s) => s.dismiss);
  return {
    push,
    success: (m, d) => push('success', m, d),
    error: (m, d) => push('error', m, d),
    info: (m, d) => push('info', m, d),
    dismiss,
  };
}

/**
 * Imperative escape hatch — for non-React call sites (e.g. system layer
 * that wants to fire a toast on a network failure without prop-drilling
 * a hook through PixiJS event handlers).
 */
export const toast = {
  push: (kind: ToastKind, message: string, duration?: number) =>
    useToastStore.getState().push(kind, message, duration),
  success: (m: string, d?: number) =>
    useToastStore.getState().push('success', m, d),
  error: (m: string, d?: number) =>
    useToastStore.getState().push('error', m, d),
  info: (m: string, d?: number) => useToastStore.getState().push('info', m, d),
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
};

/**
 * Container — render once near the app root. Visible toasts auto-dismiss
 * via a single per-entry timer registered by `<ToastItem>` below.
 */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="toast-container"
      role="region"
      aria-label="알림"
      aria-live="polite"
      data-testid="toast-container"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} entry={t} />
      ))}
    </div>
  );
}

const KIND_META: Record<ToastKind, { className: string; icon: string; aria: string }> = {
  success: { className: 'toast--success', icon: '✓', aria: '성공' },
  error: { className: 'toast--error', icon: '!', aria: '오류' },
  info: { className: 'toast--info', icon: 'ℹ', aria: '알림' },
};

function ToastItem({ entry }: { entry: ToastEntry }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const meta = KIND_META[entry.kind];

  // Auto-dismiss timer. Re-set if duration changes (rare). When duration is
  // 0 the toast becomes sticky — caller must dismiss it manually.
  useEffect(() => {
    if (entry.duration <= 0) return undefined;
    const id = window.setTimeout(() => dismiss(entry.id), entry.duration);
    return () => window.clearTimeout(id);
  }, [entry.id, entry.duration, dismiss]);

  return (
    <div
      className={`toast ${meta.className}`}
      role={entry.kind === 'error' ? 'alert' : 'status'}
      data-testid={`toast-${entry.kind}`}
    >
      <span
        aria-hidden
        className={
          entry.kind === 'success'
            ? 'inline-block w-5 h-5 rounded-full bg-green-500/20 text-green-300 text-center text-xs leading-5 font-bold'
            : entry.kind === 'error'
              ? 'inline-block w-5 h-5 rounded-full bg-red-500/20 text-red-300 text-center text-xs leading-5 font-bold'
              : 'inline-block w-5 h-5 rounded-full bg-accent/20 text-accent-soft text-center text-xs leading-5 font-bold'
        }
      >
        {meta.icon}
      </span>
      <span className="flex-1 leading-snug">
        <span className="sr-only">{meta.aria}: </span>
        {entry.message}
      </span>
      <button
        type="button"
        onClick={() => dismiss(entry.id)}
        className="text-gray-400 hover:text-white text-base leading-none px-1"
        aria-label="알림 닫기"
      >
        ×
      </button>
    </div>
  );
}
