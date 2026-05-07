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

export interface TalkResult {
  npcId: string;
  response: string;
  history: HistoryEntry[];
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
