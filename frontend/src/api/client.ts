/**
 * Backend API client (FR-002, FR-003) — Phase 2.3.
 *
 * Tiny typed wrapper around `fetch` that talks to the Hono backend's NPC
 * routes. Reads `VITE_API_URL` (default http://localhost:3001) at module
 * load time so the rest of the codebase stays decoupled from the URL.
 *
 * Errors:
 * - Network/parse failures throw {@link APIError} with `status: 0`.
 * - Non-2xx responses throw {@link APIError} with the HTTP status, the
 *   server-provided `error` slug (when JSON), and a human-readable message.
 *   In particular, LM Studio downtime surfaces as `status === 503` with
 *   `error === 'llm_unavailable'` so the UI can show a friendly banner
 *   instead of crashing.
 */

const RAW_API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
// Strip a trailing slash so callers can safely template `${API_URL}/npc/...`.
export const API_URL = RAW_API_URL.replace(/\/+$/, '');

/** Default per-call timeout (ms). LLM responses can be slow but Hono should
 *  always reply within ~30s — beyond that we fail fast and surface to UI. */
const DEFAULT_TIMEOUT_MS = 30_000;

export type HistoryRole = 'user' | 'assistant';

export interface HistoryEntry {
  role: HistoryRole;
  content: string;
  ts?: number;
}

/**
 * Phase 3.3 emotion taxonomy — must match
 * `backend/src/models/Relationship.ts` and `gameStore.Emotion`.
 */
export type APIEmotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'shy'
  | 'flirty'
  | 'annoyed';

/** Wire shape for backend RelationshipData. */
export interface RelationshipPayload {
  npcId: string;
  affinity: number;
  emotion: APIEmotion;
  lastUpdated: number;
}

export interface TalkResult {
  npcId: string;
  response: string;
  history: HistoryEntry[];
  /** Phase 3.3 — present when the backend ran the relationship update. */
  emotionUpdate?: APIEmotion;
  /** Phase 3.3 — signed delta applied this turn (clamped). */
  affinityChange?: number;
  /** Phase 3.3 — full relationship state after the turn, for client sync. */
  relationship?: RelationshipPayload;
}

export interface NPCContextResult {
  npcId: string;
  history: HistoryEntry[];
}

/** Typed error thrown by every client function on failure. */
export class APIError extends Error {
  /** HTTP status. `0` for network/parse failures (no response received). */
  readonly status: number;
  /** Server-provided machine-readable code (e.g. `llm_unavailable`). */
  readonly error: string;
  /** Optional extra payload from the server (e.g. `kind` for LLM errors). */
  readonly details?: unknown;

  constructor(status: number, error: string, message: string, details?: unknown) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.error = error;
    this.details = details;
  }
}

interface FetchJSONOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Fetch + parse JSON with timeout + uniform error mapping.
 *
 * Splits the user's `signal` from our own timeout `AbortController` and
 * combines them so callers can still cancel externally. On any non-2xx,
 * the server's JSON body (if any) is forwarded into the thrown APIError
 * so the UI can branch on `error.status` / `error.error`.
 */
async function fetchJSON<T>(path: string, opts: FetchJSONOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternalAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    // Network failure / abort. Surface aborts as a distinct error code so
    // the UI can decide whether to retry vs. show "offline".
    const aborted = (err as { name?: string }).name === 'AbortError';
    throw new APIError(
      0,
      aborted ? 'request_aborted' : 'network_error',
      aborted
        ? 'Request was aborted (timeout or cancellation).'
        : `Network error: ${(err as Error).message}`,
    );
  } finally {
    window.clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }

  // Tolerate empty bodies (e.g. 204) — but our backend always returns JSON.
  let payload: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new APIError(
        res.status,
        'invalid_response',
        `Server returned non-JSON response (status ${res.status}).`,
      );
    }
  }

  if (!res.ok) {
    const obj = (payload ?? {}) as { error?: string; message?: string; kind?: string };
    throw new APIError(
      res.status,
      obj.error ?? 'http_error',
      obj.message ?? `HTTP ${res.status}`,
      obj,
    );
  }

  return payload as T;
}

/**
 * Send a player message to an NPC and get the AI response.
 *
 * Throws {@link APIError}. Notably:
 * - 503 `llm_unavailable` — LM Studio is offline. UI should surface as a
 *   non-fatal banner ("LM Studio가 오프라인입니다").
 * - 404 `npc_not_found` — id mismatch (programming error).
 * - 400 `invalid_request` — message empty or too long.
 */
export async function talkToNPC(
  npcId: string,
  message: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<TalkResult> {
  return fetchJSON<TalkResult>(`/npc/${encodeURIComponent(npcId)}/talk`, {
    method: 'POST',
    body: { message },
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  });
}

/** Fetch the most recent N messages of an NPC's conversation history. */
export async function getNPCContext(
  npcId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<NPCContextResult> {
  return fetchJSON<NPCContextResult>(`/npc/${encodeURIComponent(npcId)}/context`, {
    method: 'GET',
    signal: opts.signal,
  });
}

/** Reset an NPC's conversation history. Currently unused by the UI but kept
 *  for parity with the backend surface (debug / Phase 3.2 reset flow). */
export async function clearNPCContext(
  npcId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ npcId: string; cleared: true }> {
  return fetchJSON<{ npcId: string; cleared: true }>(
    `/npc/${encodeURIComponent(npcId)}/context`,
    { method: 'DELETE', signal: opts.signal },
  );
}

// ---- Phase 3.3 Relationship (FR-007) -------------------------------------

/** Fetch the current relationship state for an NPC. Backend creates a
 *  default `{ affinity: 50, emotion: 'neutral' }` when no file exists. */
export async function getRelationship(
  npcId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<RelationshipPayload> {
  return fetchJSON<RelationshipPayload>(
    `/npc/${encodeURIComponent(npcId)}/relationship`,
    { method: 'GET', signal: opts.signal },
  );
}

/** Reset an NPC's relationship to the default. Debug-only; the UI does NOT
 *  expose this directly to players. */
export async function clearRelationship(
  npcId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ npcId: string; cleared: true; relationship: RelationshipPayload }> {
  return fetchJSON<{ npcId: string; cleared: true; relationship: RelationshipPayload }>(
    `/npc/${encodeURIComponent(npcId)}/relationship`,
    { method: 'DELETE', signal: opts.signal },
  );
}

// ---- Phase 3.2 Save/Load (FR-008) -----------------------------------------

/**
 * Save list summary entry — mirrors backend SaveListEntry. Kept structurally
 * compatible with `GameSavePayload['time']` so the slot-list UI can render
 * the saved time without a separate type.
 */
export interface SaveSummary {
  slotId: string;
  savedAt: number;
  label?: string;
  phase: string;
  time: {
    day: number;
    hour: number;
    minute: number;
    dayOfWeek: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
    phaseLabel: string;
  };
}

export interface SaveNPCEntry {
  id: string;
  name: string;
  locationId: string | null;
  position: { x: number; y: number };
}

/**
 * Versioned save payload — must match `gameSaveV1Schema` on the backend.
 * The frontend `SaveSystem` builds this from the Zustand store and submits
 * it to POST /save/:slotId.
 *
 * Phase 3.3: `relationships` is an optional field. New saves include it;
 * loading an older v1 save without it is supported (defaults applied).
 */
/** Open value type for story flags (mirrors backend `FlagValue`). */
export type FlagValue = boolean | string | number;

export interface GameSavePayload {
  version: 1;
  savedAt: number;
  label?: string;
  phase: string;
  time: SaveSummary['time'];
  playerPosition: { x: number; y: number };
  npcs: Record<string, SaveNPCEntry>;
  currentLocationId: string | null;
  relationships?: Record<string, RelationshipPayload>;
  /** Phase 4.1 — story flags (optional for v1 backward-compat). */
  flags?: Record<string, FlagValue>;
  /** Phase 4.1 — fired-events history (optional for v1 backward-compat). */
  story?: { fireHistory: string[] };
  /**
   * Phase 5.2 — user audio mixer settings (Issue #15). Optional for v1
   * backward-compat with pre-Phase-5.2 saves; missing fields fall back to
   * the in-store defaults on load.
   */
  audio?: {
    musicVolume: number;
    sfxVolume: number;
    muted: boolean;
    bgmEnabled: boolean;
  };
}

export interface SaveListResult {
  slots: SaveSummary[];
}

export interface SaveCreateResult {
  slotId: string;
  savedAt: number;
}

export async function listSaves(
  opts: { signal?: AbortSignal } = {},
): Promise<SaveListResult> {
  return fetchJSON<SaveListResult>('/save', {
    method: 'GET',
    signal: opts.signal,
  });
}

export async function createSave(
  slotId: string,
  payload: GameSavePayload,
  opts: { signal?: AbortSignal } = {},
): Promise<SaveCreateResult> {
  return fetchJSON<SaveCreateResult>(`/save/${encodeURIComponent(slotId)}`, {
    method: 'POST',
    body: payload,
    signal: opts.signal,
  });
}

export async function loadSave(
  slotId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<GameSavePayload> {
  return fetchJSON<GameSavePayload>(`/save/${encodeURIComponent(slotId)}`, {
    method: 'GET',
    signal: opts.signal,
  });
}

export async function deleteSave(
  slotId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ slotId: string; deleted: true }> {
  return fetchJSON<{ slotId: string; deleted: true }>(
    `/save/${encodeURIComponent(slotId)}`,
    { method: 'DELETE', signal: opts.signal },
  );
}

// ---- Phase 4.1 Story Events (FR-006) --------------------------------------

export type EventTrigger =
  | { type: 'ON_START' }
  | { type: 'ON_LOCATION_ENTER'; locationId: string }
  | { type: 'ON_FLAG'; flag: string; value?: FlagValue }
  | {
      type: 'ON_TIME';
      hourStart: number;
      hourEnd: number;
      dayOfWeek?: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
    }
  | { type: 'ON_AFFINITY'; npcId: string; threshold: number };

export type EventRequire =
  | { type: 'FLAG_SET'; flag: string }
  | { type: 'FLAG_NOT_SET'; flag: string }
  | { type: 'AFFINITY_GTE'; npcId: string; value: number }
  | { type: 'AFFINITY_LT'; npcId: string; value: number }
  | { type: 'TIME_BETWEEN'; hourStart: number; hourEnd: number };

export type APIEventEmotion = APIEmotion;

export type EventStep =
  | { type: 'narration'; text: string }
  | { type: 'dialog'; speaker: string; text: string }
  | { type: 'set_flag'; flag: string; value?: FlagValue }
  | { type: 'clear_flag'; flag: string }
  | { type: 'set_affinity'; npcId: string; delta: number }
  | { type: 'set_emotion'; npcId: string; emotion: APIEventEmotion }
  | { type: 'teleport_player'; x: number; y: number };

export interface StoryEvent {
  id: string;
  title: string;
  description?: string;
  trigger: EventTrigger;
  requires?: EventRequire[];
  once: boolean;
  steps: EventStep[];
}

export interface EventMetadata {
  id: string;
  title: string;
  trigger: EventTrigger;
  once: boolean;
  description?: string;
}

export interface EventListResult {
  count: number;
  events: EventMetadata[];
}

export interface EligibilityState {
  flags: Record<string, FlagValue>;
  fireHistory: string[];
  time: SaveSummary['time'] | null;
  location: string | null;
  affinities: Record<string, number>;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export async function listEvents(
  opts: { signal?: AbortSignal } = {},
): Promise<EventListResult> {
  return fetchJSON<EventListResult>('/event', {
    method: 'GET',
    signal: opts.signal,
  });
}

export async function getEvent(
  eventId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<StoryEvent> {
  return fetchJSON<StoryEvent>(`/event/${encodeURIComponent(eventId)}`, {
    method: 'GET',
    signal: opts.signal,
  });
}

export async function checkEventEligible(
  eventId: string,
  state: EligibilityState,
  opts: { signal?: AbortSignal } = {},
): Promise<EligibilityResult> {
  return fetchJSON<EligibilityResult>(
    `/event/${encodeURIComponent(eventId)}/eligible`,
    { method: 'POST', body: state, signal: opts.signal },
  );
}

// ---- Phase 4.2 Schedule (FR-009 일과 시스템) ------------------------------

export type APIDayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface ScheduleEntry {
  days: APIDayOfWeek[];
  /** Inclusive start in minute-of-day (0..1440). */
  fromMinute: number;
  /** Exclusive end in minute-of-day (0..1440). */
  toMinute: number;
  locationId: string;
  activity: string;
}

export interface NPCScheduleResult {
  id: string;
  weekly: ScheduleEntry[];
}

export interface ScheduleListResult {
  count: number;
  npcs: string[];
}

export interface CurrentScheduleEntry {
  locationId: string;
  activity: string;
}

export interface CurrentSchedulesResult {
  schedules: Record<string, CurrentScheduleEntry>;
}

export async function listSchedules(
  opts: { signal?: AbortSignal } = {},
): Promise<ScheduleListResult> {
  return fetchJSON<ScheduleListResult>('/schedule', {
    method: 'GET',
    signal: opts.signal,
  });
}

export async function getNPCSchedule(
  npcId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<NPCScheduleResult> {
  return fetchJSON<NPCScheduleResult>(
    `/schedule/${encodeURIComponent(npcId)}`,
    { method: 'GET', signal: opts.signal },
  );
}

export async function getCurrentSchedules(
  time: { hour: number; minute: number },
  dayOfWeek: APIDayOfWeek,
  opts: { signal?: AbortSignal } = {},
): Promise<CurrentSchedulesResult> {
  return fetchJSON<CurrentSchedulesResult>('/schedule/current', {
    method: 'POST',
    body: { time, dayOfWeek },
    signal: opts.signal,
  });
}
