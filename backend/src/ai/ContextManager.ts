/**
 * ContextManager — per-NPC conversation history with simple file persistence.
 *
 * Reference: DESIGN.md §"NPCContext" and FR-001 (NPCs remember past
 * conversation). This is an MVP stand-in for the real save system that lands
 * in Phase 3.2 — saves are written as one JSON file per NPC under the repo's
 * top-level `saves/npc-context/` directory.
 *
 * Persistence strategy: write through on every append. Volume is low (one
 * write per dialog turn) so this is acceptable for Phase 2.2. The Phase 3.2
 * SaveStorage will subsume this.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type HistoryRole = 'user' | 'assistant';

export interface NPCHistoryEntry {
  role: HistoryRole;
  content: string;
  ts: number;
}

export interface NPCContext {
  id: string;
  history: NPCHistoryEntry[];
}

export interface ContextManagerOptions {
  /** Directory that will hold one `${id}.json` per NPC. */
  saveDir: string;
}

export class ContextManager {
  private readonly saveDir: string;
  private readonly cache = new Map<string, NPCContext>();
  /** Per-id mutex: chains writes for the same NPC so concurrent appends are serialized. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(opts?: Partial<ContextManagerOptions>) {
    // Default to a `saves/npc-context` directory at the repo root regardless
    // of where bun is launched from. The repo root is two levels above this
    // file (`backend/src/ai/ContextManager.ts` → `<repo>/`).
    const def = resolve(import.meta.dir, '..', '..', '..', 'saves', 'npc-context');
    this.saveDir = opts?.saveDir ?? def;
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    // Run fn whether prev fulfilled or rejected; we don't want one op's failure
    // to deadlock the queue for a particular id.
    const next = prev.then(fn, fn);
    // Store a swallowed copy so the entry's identity is stable for the
    // cleanup check below.
    const tracked: Promise<unknown> = next.catch(() => undefined);
    this.locks.set(id, tracked);
    try {
      return await next;
    } finally {
      // Only drop the entry if no later op chained on top of `tracked`.
      if (this.locks.get(id) === tracked) {
        this.locks.delete(id);
      }
    }
  }

  private filePath(id: string): string {
    return resolve(this.saveDir, `${id}.json`);
  }

  async load(id: string): Promise<NPCContext> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const path = this.filePath(id);
    const file = Bun.file(path);
    if (await file.exists()) {
      try {
        const parsed = (await file.json()) as NPCContext;
        if (parsed && Array.isArray(parsed.history)) {
          this.cache.set(id, parsed);
          return parsed;
        }
      } catch (err) {
        console.warn(`[ContextManager] failed to parse ${path}, starting fresh:`, err);
      }
    }

    const fresh: NPCContext = { id, history: [] };
    this.cache.set(id, fresh);
    return fresh;
  }

  async append(id: string, role: HistoryRole, content: string): Promise<NPCContext> {
    return this.withLock(id, async () => {
      const ctx = await this.load(id);
      ctx.history.push({ role, content, ts: Date.now() });
      await this.persist(ctx);
      return ctx;
    });
  }

  /**
   * Append a user turn and an assistant turn together with one persist call.
   * Avoids leaving an orphan user message on a partial-failure between two
   * separate appends.
   */
  async appendTurn(
    id: string,
    userContent: string,
    assistantContent: string,
  ): Promise<NPCContext> {
    return this.withLock(id, async () => {
      const ctx = await this.load(id);
      const ts = Date.now();
      ctx.history.push({ role: 'user', content: userContent, ts });
      ctx.history.push({ role: 'assistant', content: assistantContent, ts: ts + 1 });
      await this.persist(ctx);
      return ctx;
    });
  }

  async clear(id: string): Promise<void> {
    return this.withLock(id, async () => {
      this.cache.delete(id);
      const path = this.filePath(id);
      const file = Bun.file(path);
      if (await file.exists()) {
        // Bun.file has no unlink; use Node's fs.
        const { unlink } = await import('node:fs/promises');
        await unlink(path).catch(() => undefined);
      }
    });
  }

  async recent(id: string, n: number): Promise<NPCHistoryEntry[]> {
    const ctx = await this.load(id);
    if (n <= 0) return [];
    return ctx.history.slice(-n);
  }

  private async persist(ctx: NPCContext): Promise<void> {
    const path = this.filePath(ctx.id);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, JSON.stringify(ctx, null, 2));
  }
}
