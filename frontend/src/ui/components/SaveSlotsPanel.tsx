import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SaveSummary } from '@/api/client';
import { APIError } from '@/api/client';
import type { SaveSystem } from '@/systems/SaveSystem';
import { SaveError } from '@/systems/SaveSystem';

/**
 * SaveSlotsPanel (Phase 3.2 — FR-008).
 *
 * Inline overlay listing the three named save slots (slot1/slot2/slot3) and,
 * below them, any additional slots discovered on the server. Each row shows:
 *   - slotId + saved-at (Korean locale)
 *   - in-game time (day, weekday, HH:MM, phase label)
 *   - Save / Load / Delete actions
 *
 * State management:
 *   - `slots` is fetched on open and refreshed after every mutation.
 *   - `busySlot` blocks concurrent ops on the same slot.
 *   - `status` shows the latest success / error toast inline.
 *
 * StrictMode: every fetch is guarded by an AbortController whose `aborted`
 * flag is checked before setState. Effects clean up on unmount.
 */

const FIXED_SLOTS = ['slot1', 'slot2', 'slot3'] as const;

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

const DAY_OF_WEEK_KO: Record<SaveSummary['time']['dayOfWeek'], string> = {
  MON: '월',
  TUE: '화',
  WED: '수',
  THU: '목',
  FRI: '금',
  SAT: '토',
  SUN: '일',
};

function formatSavedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString('ko-KR', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

function formatGameTime(time: SaveSummary['time']): string {
  const hh = String(time.hour).padStart(2, '0');
  const mm = String(time.minute).padStart(2, '0');
  return `${time.day}일차 (${DAY_OF_WEEK_KO[time.dayOfWeek]}) ${hh}:${mm} · ${time.phaseLabel}`;
}

/** Map a thrown SaveError / APIError into a one-line Korean message. */
function errorMessage(err: unknown): string {
  // Unwrap a SaveError that wraps an APIError so the user sees a useful
  // status-code-derived message rather than the generic SaveSystem string.
  const apiErr =
    err instanceof APIError
      ? err
      : err instanceof SaveError && err.cause instanceof APIError
        ? err.cause
        : null;
  if (apiErr) {
    if (apiErr.status === 0) return '서버에 연결할 수 없습니다.';
    if (apiErr.status === 404) return '해당 슬롯이 존재하지 않습니다.';
    if (apiErr.status === 400) return '저장 데이터가 올바르지 않습니다.';
    return `서버 오류 (HTTP ${apiErr.status}).`;
  }
  if (err instanceof Error) return err.message;
  return '알 수 없는 오류';
}

export interface SaveSlotsPanelProps {
  open: boolean;
  saveSystem: SaveSystem | null;
  onClose: () => void;
}

export function SaveSlotsPanel({ open, saveSystem, onClose }: SaveSlotsPanelProps) {
  const [slots, setSlots] = useState<SaveSummary[]>([]);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // Refresh the slot list whenever the panel opens or after a mutation.
  // The refreshKey increments to force a re-fetch; using an effect rather
  // than imperative reloads keeps the AbortController lifecycle clean.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!open || !saveSystem) return;
    const ctrl = new AbortController();
    setListLoading(true);
    saveSystem
      .list()
      .then((list) => {
        if (ctrl.signal.aborted) return;
        setSlots(list);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setStatus({ kind: 'error', message: errorMessage(err) });
      })
      .finally(() => {
        if (ctrl.signal.aborted) return;
        setListLoading(false);
      });
    return () => ctrl.abort();
  }, [open, saveSystem, refreshKey]);

  // Escape closes the panel — mirrors DialogBox's UX.
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

  // Merge fixed slots with discovered ones; fixed slots always appear first
  // even when empty so the user has a stable target to save into.
  const rows = useMemo(() => {
    const bySlotId = new Map<string, SaveSummary>();
    for (const s of slots) bySlotId.set(s.slotId, s);
    type Row =
      | { slotId: string; isFixed: true; summary: SaveSummary | null }
      | { slotId: string; isFixed: false; summary: SaveSummary };
    const fixed: Row[] = FIXED_SLOTS.map((id) => ({
      slotId: id,
      isFixed: true,
      summary: bySlotId.get(id) ?? null,
    }));
    const extra: Row[] = slots
      .filter((s) => !FIXED_SLOTS.includes(s.slotId as (typeof FIXED_SLOTS)[number]))
      .map((s) => ({ slotId: s.slotId, isFixed: false, summary: s }));
    return [...fixed, ...extra];
  }, [slots]);

  const handleSave = useCallback(
    async (slotId: string) => {
      if (!saveSystem) return;
      setBusySlot(slotId);
      setStatus({ kind: 'idle' });
      try {
        await saveSystem.save(slotId);
        setStatus({ kind: 'success', message: `${slotId}에 저장했습니다.` });
        refresh();
      } catch (err) {
        setStatus({ kind: 'error', message: errorMessage(err) });
      } finally {
        setBusySlot(null);
      }
    },
    [saveSystem, refresh],
  );

  const handleLoad = useCallback(
    async (slotId: string) => {
      if (!saveSystem) return;
      setBusySlot(slotId);
      setStatus({ kind: 'idle' });
      try {
        await saveSystem.load(slotId);
        setStatus({ kind: 'success', message: `${slotId}에서 불러왔습니다.` });
      } catch (err) {
        setStatus({ kind: 'error', message: errorMessage(err) });
      } finally {
        setBusySlot(null);
      }
    },
    [saveSystem],
  );

  const handleDelete = useCallback(
    async (slotId: string) => {
      if (!saveSystem) return;
      // Avoid window.confirm during dialog interactions — friends-only
      // deployment, low risk if mis-clicked, and undoable by re-saving.
      setBusySlot(slotId);
      setStatus({ kind: 'idle' });
      try {
        await saveSystem.delete(slotId);
        setStatus({ kind: 'success', message: `${slotId}을(를) 삭제했습니다.` });
        refresh();
      } catch (err) {
        setStatus({ kind: 'error', message: errorMessage(err) });
      } finally {
        setBusySlot(null);
      }
    },
    [saveSystem, refresh],
  );

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-label="세이브 슬롯"
      onClick={(e) => {
        // Click on the dim backdrop closes the panel; clicks inside the
        // card bubble up to here but stop at the inner stopPropagation.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-gray-800/95 border-2 border-orange-primary rounded-lg shadow-2xl backdrop-blur-sm p-5 w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-orange-primary">세이브 / 로드</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-300 hover:text-white text-xl leading-none px-2"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {status.kind === 'success' && (
          <div
            className="mb-3 px-3 py-2 rounded bg-green-900/60 border border-green-500 text-green-100 text-xs"
            role="status"
          >
            {status.message}
          </div>
        )}
        {status.kind === 'error' && (
          <div
            className="mb-3 px-3 py-2 rounded bg-red-900/60 border border-red-500 text-red-100 text-xs"
            role="alert"
          >
            {status.message}
          </div>
        )}

        {listLoading && (
          <p className="text-xs text-gray-400 mb-2">슬롯 목록 불러오는 중...</p>
        )}

        <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {rows.map((row) => {
            const isBusy = busySlot === row.slotId;
            const summary = row.summary;
            return (
              <li
                key={row.slotId}
                className="bg-gray-900/60 border border-gray-700 rounded p-3 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-100">{row.slotId}</span>
                  {summary ? (
                    <span className="text-xs text-gray-400">
                      {formatSavedAt(summary.savedAt)}
                    </span>
                  ) : (
                    <span className="text-xs italic text-gray-500">비어 있음</span>
                  )}
                </div>
                {summary && (
                  <p className="text-xs text-gray-300">{formatGameTime(summary.time)}</p>
                )}
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleSave(row.slotId)}
                    disabled={isBusy || !saveSystem}
                    className="btn-game text-sm px-3 py-1"
                  >
                    {isBusy ? '저장 중...' : '저장'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoad(row.slotId)}
                    disabled={isBusy || !saveSystem || !summary}
                    className="btn-game text-sm px-3 py-1"
                  >
                    {isBusy ? '불러오는 중...' : '불러오기'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(row.slotId)}
                    disabled={isBusy || !saveSystem || !summary}
                    className="btn-game text-sm px-3 py-1"
                  >
                    삭제
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
