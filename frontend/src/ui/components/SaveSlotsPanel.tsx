import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SaveSummary } from '@/api/client';
import { APIError } from '@/api/client';
import type { SaveSystem } from '@/systems/SaveSystem';
import { SaveError } from '@/systems/SaveSystem';
import type { EffectSystem } from '@/systems/EffectSystem';
import type { AudioEngine } from '@/audio/AudioEngine';
import { useToast } from '@/ui/components/Toast';
import { TOWN_BOUNDS } from '@/data/locations';

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

// Inline status now only carries list-fetch errors (per-action success /
// error feedback flows through the toast system in Phase 5.1).
type Status = { kind: 'idle' } | { kind: 'error'; message: string };

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
  /** Phase 5.2 — sparkle burst on save success. Optional so the panel still
   *  works in tests without the visual layer. */
  effectSystem?: EffectSystem | null;
  /** Phase 5.2 — confirmation SFX + click SFX on actions. */
  audioEngine?: AudioEngine | null;
  onClose: () => void;
}

export function SaveSlotsPanel({
  open,
  saveSystem,
  effectSystem,
  audioEngine,
  onClose,
}: SaveSlotsPanelProps) {
  const toast = useToast();
  const [slots, setSlots] = useState<SaveSummary[]>([]);
  // `busyAction` distinguishes save / load / delete so the corresponding
  // button can show a per-action spinner instead of all three going dim.
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'save' | 'load' | 'delete' | null>(null);
  const [listLoading, setListLoading] = useState(false);
  // Local status is now reserved for transient list-fetch errors (the
  // panel can't toast something for an issue it surfaces inline at the
  // top); per-action success/failure goes through the toast system so
  // the user sees feedback even after closing the panel.
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
      // Phase 5.2 — UI click SFX (subtle). Fired immediately so the user
      // gets feedback before the network round-trip completes.
      audioEngine?.playSfx('click');
      setBusySlot(slotId);
      setBusyAction('save');
      setStatus({ kind: 'idle' });
      try {
        await saveSystem.save(slotId);
        toast.success(`${slotId}에 저장했습니다.`);
        // Phase 5.2 — celebrate the save with a sparkle burst at stage
        // center + confirmation chime. Town-local center is fine because
        // the effects layer is inside the scene root which is scaled by
        // GameScene.fitTo — burst visually centers on the playfield.
        audioEngine?.playSfx('save');
        if (effectSystem) {
          effectSystem.spawnSparkles(TOWN_BOUNDS.width / 2, TOWN_BOUNDS.height / 2);
        }
        refresh();
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusySlot(null);
        setBusyAction(null);
      }
    },
    [saveSystem, refresh, toast, audioEngine, effectSystem],
  );

  const handleLoad = useCallback(
    async (slotId: string) => {
      if (!saveSystem) return;
      audioEngine?.playSfx('click');
      setBusySlot(slotId);
      setBusyAction('load');
      setStatus({ kind: 'idle' });
      try {
        await saveSystem.load(slotId);
        toast.success(`${slotId}에서 불러왔습니다.`);
        // Auto-close on successful load so the player sees the restored
        // game state instead of staying behind the modal.
        onClose();
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusySlot(null);
        setBusyAction(null);
      }
    },
    [saveSystem, toast, onClose, audioEngine],
  );

  const handleDelete = useCallback(
    async (slotId: string) => {
      if (!saveSystem) return;
      // Avoid window.confirm during dialog interactions — friends-only
      // deployment, low risk if mis-clicked, and undoable by re-saving.
      audioEngine?.playSfx('click');
      setBusySlot(slotId);
      setBusyAction('delete');
      setStatus({ kind: 'idle' });
      try {
        await saveSystem.delete(slotId);
        toast.success(`${slotId}을(를) 삭제했습니다.`);
        refresh();
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusySlot(null);
        setBusyAction(null);
      }
    },
    [saveSystem, refresh, toast, audioEngine],
  );

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 flex sm:items-center sm:justify-center items-stretch justify-stretch bg-black/60 pointer-events-auto animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="세이브 슬롯"
      data-testid="save-panel"
      onClick={(e) => {
        // Click on the dim backdrop closes the panel; clicks inside the
        // card bubble up to here but stop at the inner stopPropagation.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="panel sm:max-w-lg sm:mx-4 sm:rounded-lg w-full sm:w-auto p-5 flex flex-col sm:max-h-[85vh] max-h-screen sm:my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h2 className="text-lg font-bold text-orange-primary">세이브 / 로드</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon"
            aria-label="닫기"
            data-testid="save-panel-close"
          >
            <span aria-hidden>×</span>
          </button>
        </div>

        {/* List-fetch error stays inline — toast would lose context. */}
        {status.kind === 'error' && (
          <div
            className="mb-3 px-3 py-2 rounded bg-red-900/60 border border-red-500 text-red-100 text-xs animate-shake"
            role="alert"
          >
            {status.message}
          </div>
        )}

        {listLoading && (
          <p className="text-xs text-gray-400 mb-2 flex items-center gap-2">
            <span className="inline-block w-3 h-3 spinner" aria-hidden />
            슬롯 목록 불러오는 중...
          </p>
        )}

        <ul className="space-y-2 overflow-y-auto pr-1 flex-1">
          {rows.map((row) => {
            const isBusy = busySlot === row.slotId;
            const summary = row.summary;
            return (
              <li
                key={row.slotId}
                className="bg-gray-900/60 border border-gray-700 rounded p-3 flex flex-col gap-2 animate-fade-in"
                data-testid={`save-slot-${row.slotId}`}
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
                    className="btn-game text-sm px-3 py-1 inline-flex items-center gap-1.5"
                    aria-label={`${row.slotId}에 저장`}
                    data-testid={`save-action-${row.slotId}`}
                  >
                    {isBusy && busyAction === 'save' && (
                      <span className="inline-block w-3 h-3 spinner" aria-hidden />
                    )}
                    {isBusy && busyAction === 'save' ? '저장 중...' : '저장'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoad(row.slotId)}
                    disabled={isBusy || !saveSystem || !summary}
                    className="btn-game text-sm px-3 py-1 inline-flex items-center gap-1.5"
                    aria-label={`${row.slotId} 불러오기`}
                    data-testid={`load-action-${row.slotId}`}
                  >
                    {isBusy && busyAction === 'load' && (
                      <span className="inline-block w-3 h-3 spinner" aria-hidden />
                    )}
                    {isBusy && busyAction === 'load' ? '불러오는 중...' : '불러오기'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(row.slotId)}
                    disabled={isBusy || !saveSystem || !summary}
                    className="btn-game-ghost text-sm"
                    aria-label={`${row.slotId} 삭제`}
                    data-testid={`delete-action-${row.slotId}`}
                  >
                    {isBusy && busyAction === 'delete' ? '삭제 중...' : '삭제'}
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
