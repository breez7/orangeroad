import type { Player } from '@/entities/Player';
import type { EntityManager } from '@/entities/EntityManager';
import { APIError, getNPCContext, getRelationship, talkToNPC } from '@/api/client';
import { useGameStore } from '@/store/gameStore';

export interface DialogSystemOptions {
  player: Player;
  entityManager: EntityManager;
  /** Click radius (town-coords) within which an NPC click opens dialog. */
  interactRadius?: number;
}

/** Default interaction radius — Player.RADIUS (16) + NPC.RADIUS (16) + 48 px slack. */
const DEFAULT_INTERACT_RADIUS = 80;

/**
 * DialogSystem — bridges PixiJS world (player, NPCs) and the React dialog UI
 * (FR-003, FR-005 same-location dialog rule).
 *
 * Design choices:
 * - Interaction trigger: a "click NPC while within INTERACT_RADIUS" model.
 *   GameScene asks `tryOpenAtPoint(localX, localY)` on every pointer-down; if
 *   the click lands on an NPC AND that NPC is within range of the player, we
 *   open the dialog and report `{ handled: true }` so the MovementSystem
 *   skips its walk-to. If the NPC is far, we return `{ handled: false }`,
 *   letting the existing click-to-walk run. Proximity-stop is intentionally
 *   NOT used here — it would surprise the player by opening the box every
 *   time they wander past someone. Click-to-talk is the standard JRPG idiom.
 * - State ownership: the DialogSystem is stateless w.r.t. UI state — all
 *   dialog state (open, history, waiting, error) lives in the Zustand store
 *   so React components can subscribe with primitive selectors. The system
 *   owns only the in-flight `AbortController` (transient).
 * - Error UX: APIError 503 ("llm_unavailable") is surfaced as a friendly
 *   Korean message in `dialog.error`; the user message is preserved in
 *   history so they can see what they sent. Other errors get a generic
 *   message but never tear down the dialog.
 */
export class DialogSystem {
  private readonly player: Player;
  private readonly entityManager: EntityManager;
  private readonly interactRadius: number;
  private inflight: AbortController | null = null;
  private destroyed = false;

  constructor(opts: DialogSystemOptions) {
    this.player = opts.player;
    this.entityManager = opts.entityManager;
    this.interactRadius = opts.interactRadius ?? DEFAULT_INTERACT_RADIUS;
  }

  /** Whether the dialog is currently open (mirrors store). */
  get isOpen(): boolean {
    return useGameStore.getState().dialog.open;
  }

  /** Find the NPC closest to a given point, within the interact radius. */
  getNearestNPC(
    point: { x: number; y: number },
  ): { id: string; distance: number } | null {
    let best: { id: string; distance: number } | null = null;
    for (const npc of this.entityManager.all()) {
      const dx = npc.x - point.x;
      const dy = npc.y - point.y;
      const d = Math.hypot(dx, dy);
      if (d > this.interactRadius) continue;
      if (!best || d < best.distance) best = { id: npc.id, distance: d };
    }
    return best;
  }

  /**
   * If the click hits an NPC sprite AND that NPC is within INTERACT_RADIUS
   * of the player, open the dialog and stop player movement. Returns true
   * iff the click was consumed (caller should skip click-to-walk).
   */
  tryOpenAtPoint(localX: number, localY: number): boolean {
    if (this.destroyed) return false;

    // 1. Find NPC under the click — generous radius so small sprites still
    //    feel clickable. NPC.RADIUS is 16; we use 22 to forgive imprecision.
    const CLICK_RADIUS = 22;
    let clicked: { id: string; distance: number } | null = null;
    for (const npc of this.entityManager.all()) {
      const dx = npc.x - localX;
      const dy = npc.y - localY;
      const d = Math.hypot(dx, dy);
      if (d > CLICK_RADIUS) continue;
      if (!clicked || d < clicked.distance) clicked = { id: npc.id, distance: d };
    }
    if (!clicked) return false;

    // 2. Check player proximity to the clicked NPC. If far, fall through to
    //    walk so the player can approach. (Walk-to-then-talk is implicit:
    //    next click after arrival will open the dialog.)
    const npc = this.entityManager.getNPC(clicked.id);
    if (!npc) return false;
    const playerDist = Math.hypot(npc.x - this.player.x, npc.y - this.player.y);
    if (playerDist > this.interactRadius) return false;

    // 3. In-range click: open dialog, stop walking.
    this.player.stop();
    this.openWith(clicked.id);
    return true;
  }

  /** Open the dialog with a specific NPC. Idempotent for the same id. */
  openWith(npcId: string): void {
    if (this.destroyed) return;
    const store = useGameStore.getState();
    if (store.dialog.open && store.dialog.npcId === npcId) return;
    // Cancel any in-flight request from a previous NPC. Switching mid-flight
    // would otherwise race the response into the new conversation.
    this.cancelInflight();
    store.openDialog(npcId);
    // Fire-and-forget: load any persisted backend history so re-opening a
    // conversation shows prior turns (FR-003 "감정 상태는 지속된다 — 세션
    // 간 유지"). Failures are silent — the dialog still functions with an
    // empty in-session history if the backend is offline.
    void this.loadPriorContext(npcId);
    // Phase 3.3 — also pull current relationship state so the affinity
    // indicator shows the persisted value, not the in-memory default.
    void this.loadRelationship(npcId);
  }

  private async loadRelationship(npcId: string): Promise<void> {
    if (this.destroyed) return;
    try {
      const rel = await getRelationship(npcId);
      if (this.destroyed) return;
      const post = useGameStore.getState();
      // Only commit if the user is still on this NPC. Avoids overwriting
      // a relationship that just got updated by a concurrent talk turn.
      if (!post.dialog.open || post.dialog.npcId !== npcId) return;
      post.setRelationship(npcId, {
        npcId: rel.npcId,
        affinity: rel.affinity,
        emotion: rel.emotion,
        lastUpdated: rel.lastUpdated,
      });
    } catch {
      // Backend offline / 404 — keep current store defaults.
    }
  }

  private async loadPriorContext(npcId: string): Promise<void> {
    if (this.destroyed) return;
    const ctrl = new AbortController();
    this.inflight = ctrl;
    try {
      const ctx = await getNPCContext(npcId, { signal: ctrl.signal });
      if (this.destroyed) return;
      const post = useGameStore.getState();
      // Only commit if the user is still looking at this NPC AND the local
      // history hasn't grown (don't clobber an optimistic send that landed
      // while the context fetch was in flight).
      if (!post.dialog.open || post.dialog.npcId !== npcId) return;
      if (post.dialog.history.length > 0) return;
      post.setDialogHistory(ctx.history);
    } catch {
      // Backend offline / aborted / 404 — silently leave history empty.
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
    }
  }

  /** Close the dialog and cancel any in-flight request. */
  close(): void {
    if (this.destroyed) return;
    this.cancelInflight();
    useGameStore.getState().closeDialog();
  }

  /**
   * Send a message to the currently-open NPC. Updates the store optimistically
   * (user message appears immediately), then awaits the backend.
   *
   * Concurrency: if a previous send is still in-flight, it is aborted — the
   * UI disables the input while waiting, so this only fires if the user
   * closed-and-reopened or the network stalled.
   */
  async send(message: string): Promise<void> {
    if (this.destroyed) return;
    const trimmed = message.trim();
    if (!trimmed) return;

    const store = useGameStore.getState();
    const npcId = store.dialog.npcId;
    if (!npcId || !store.dialog.open) return;
    if (store.dialog.isWaiting) return; // UI should also gate this.

    // Optimistic user-turn append + waiting state.
    store.appendDialogTurn('user', trimmed);
    store.setDialogWaiting(true);
    store.setDialogError(null);

    this.cancelInflight();
    const ctrl = new AbortController();
    this.inflight = ctrl;

    try {
      const result = await talkToNPC(npcId, trimmed, { signal: ctrl.signal });
      if (this.destroyed) return;
      // Guard against the user closing or switching NPCs mid-flight.
      const post = useGameStore.getState();
      if (!post.dialog.open || post.dialog.npcId !== npcId) return;

      // Backend returns the canonical recent history (includes the turn we
      // just appended). Replace local history with the server's truth so
      // timestamps + ordering match the persisted context.
      post.setDialogHistory(result.history);

      // Phase 3.3 — sync relationship slice from the server's authoritative
      // post-turn state. The field is optional on the wire (older Phase 2.2
      // backend wouldn't send it) so guard against undefined.
      if (result.relationship) {
        post.setRelationship(npcId, {
          npcId: result.relationship.npcId,
          affinity: result.relationship.affinity,
          emotion: result.relationship.emotion,
          lastUpdated: result.relationship.lastUpdated,
        });
      }
    } catch (err) {
      if (this.destroyed) return;
      const post = useGameStore.getState();
      if (!post.dialog.open || post.dialog.npcId !== npcId) return;

      const friendly = formatErrorMessage(err);
      post.setDialogError(friendly);
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
      if (!this.destroyed) {
        const post = useGameStore.getState();
        if (post.dialog.open && post.dialog.npcId === npcId) {
          post.setDialogWaiting(false);
        }
      }
    }
  }

  /** Tear down — abort in-flight request, mark destroyed. */
  destroy(): void {
    this.destroyed = true;
    this.cancelInflight();
  }

  private cancelInflight(): void {
    if (this.inflight) {
      this.inflight.abort();
      this.inflight = null;
    }
  }
}

/** Map an APIError / unknown error into a Korean user-facing string. */
function formatErrorMessage(err: unknown): string {
  if (err instanceof APIError) {
    if (err.status === 503 && err.error === 'llm_unavailable') {
      return 'LM Studio가 오프라인입니다 — NPC 응답을 받을 수 없습니다. (503)';
    }
    if (err.status === 0 && err.error === 'request_aborted') {
      return '요청이 취소되었습니다.';
    }
    if (err.status === 0) {
      return '백엔드 서버에 연결할 수 없습니다.';
    }
    if (err.status === 400) {
      return '메시지 형식이 올바르지 않습니다.';
    }
    if (err.status === 404) {
      return '해당 NPC를 찾을 수 없습니다.';
    }
    return `오류가 발생했습니다 (${err.status} ${err.error}).`;
  }
  return '알 수 없는 오류가 발생했습니다.';
}
