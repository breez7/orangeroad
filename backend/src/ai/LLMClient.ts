/**
 * LLMClient — OpenAI-compatible chat completions client for LM Studio.
 *
 * LM Studio exposes /v1/chat/completions on a local port and does not require
 * any auth header. This client wraps fetch with a configurable timeout and
 * surfaces a typed LLMError so the route layer can map failures to a clean
 * 503 ("llm_unavailable") response.
 *
 * Reference: requirements.md FR-002 (NPC AI system), NFR-001 (3s response
 * budget — the timeout here is a safety ceiling much larger than that target).
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatResult {
  content: string;
  tokensUsed?: number;
}

export interface LLMClientOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  temperature: number;
}

export type LLMErrorKind =
  | 'network'
  | 'timeout'
  | 'http_status'
  | 'parse'
  | 'empty_response';

export class LLMError extends Error {
  readonly kind: LLMErrorKind;
  readonly status?: number;

  constructor(kind: LLMErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'LLMError';
    this.kind = kind;
    this.status = status;
  }
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: { total_tokens?: number };
}

export class LLMClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly temperature: number;

  constructor(opts: Partial<LLMClientOptions> = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.LM_STUDIO_URL ?? 'http://localhost:1234/v1').replace(/\/+$/, '');
    this.model = opts.model ?? process.env.LM_STUDIO_MODEL ?? 'local-model';
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.LM_STUDIO_TIMEOUT_MS ?? 30000);
    this.temperature = opts.temperature ?? 0.8;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model: this.model,
      messages,
      temperature: this.temperature,
      stream: false,
    });

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new LLMError('timeout', `LM Studio request timed out after ${this.timeoutMs}ms`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMError('network', `LM Studio unreachable: ${msg}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LLMError(
        'http_status',
        `LM Studio returned HTTP ${res.status}: ${text.slice(0, 200)}`,
        res.status,
      );
    }

    let data: OpenAIChatResponse;
    try {
      data = (await res.json()) as OpenAIChatResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMError('parse', `Failed to parse LM Studio response: ${msg}`);
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new LLMError('empty_response', 'LM Studio returned no content');
    }

    return {
      content,
      tokensUsed: data.usage?.total_tokens,
    };
  }
}
