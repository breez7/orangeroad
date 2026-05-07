/**
 * RelationshipManager — Phase 3.3 (FR-007).
 *
 * Reference: DESIGN.md §"RelationshipData" and §"NPC Interaction Flow".
 *
 * Mirrors {@link ContextManager}: per-NPC JSON file under
 * `<repo>/saves/relationships/<id>.json`, in-memory cache, per-id mutex
 * (`withLock`) so two concurrent talk turns for the same NPC can't clobber
 * each other's affinity write.
 *
 * Persistence strategy: write through on every update. Volume is at most one
 * write per dialog turn so the cost is negligible. The whole-state save in
 * SaveService.list/save (FR-008) reads the JSON snapshot we maintain here so
 * nothing else needs to know about the on-disk layout.
 *
 * Why a separate file from ContextManager? Two reasons:
 *  1. Different lifecycles — clearing dialog history shouldn't reset affinity.
 *  2. Different fanout — the SaveService.list payload includes relationships
 *     but NOT dialog history (which is potentially thousands of turns).
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  defaultRelationship,
  relationshipDataSchema,
  type Emotion,
  type RelationshipData,
} from '@/models/Relationship';

export interface RelationshipManagerOptions {
  /** Directory that will hold one `${id}.json` per NPC. */
  saveDir: string;
}

/** Patch shape for {@link RelationshipManager.update}. All fields optional. */
export interface RelationshipPatch {
  /** Replace affinity directly (clamped by caller — manager does NOT clamp). */
  affinity?: number;
  /** Set the current emotion. */
  emotion?: Emotion;
  /** Override lastUpdated (defaults to Date.now()). */
  lastUpdated?: number;
}

export class RelationshipManager {
  private readonly saveDir: string;
  private readonly cache = new Map<string, RelationshipData>();
  /** Per-id mutex: chains writes for the same NPC. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(opts?: Partial<RelationshipManagerOptions>) {
    // Default to `<repo>/saves/relationships/`. Resolve relative to this file
    // so the path is stable regardless of bun's cwd.
    // backend/src/ai/RelationshipManager.ts → <repo>/saves/relationships
    const def = resolve(import.meta.dir, '..', '..', '..', 'saves', 'relationships');
    this.saveDir = opts?.saveDir ?? def;
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tracked: Promise<unknown> = next.catch(() => undefined);
    this.locks.set(id, tracked);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === tracked) {
        this.locks.delete(id);
      }
    }
  }

  private filePath(id: string): string {
    return resolve(this.saveDir, `${id}.json`);
  }

  /** Load — returns cached value, falls back to disk, then to default. */
  async load(id: string): Promise<RelationshipData> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const path = this.filePath(id);
    const file = Bun.file(path);
    if (await file.exists()) {
      try {
        const raw = (await file.json()) as unknown;
        const parsed = relationshipDataSchema.safeParse(raw);
        if (parsed.success) {
          // Trust the on-disk npcId only insofar as it matches the requested
          // id; otherwise rebuild defaults. Avoids a renamed file leaking the
          // wrong id into responses.
          const data: RelationshipData =
            parsed.data.npcId === id ? parsed.data : { ...parsed.data, npcId: id };
          this.cache.set(id, data);
          return data;
        }
        console.warn(
          `[RelationshipManager] invalid payload at ${path}, resetting to default:`,
          parsed.error.issues,
        );
      } catch (err) {
        console.warn(
          `[RelationshipManager] failed to parse ${path}, resetting to default:`,
          err,
        );
      }
    }

    const fresh = defaultRelationship(id);
    this.cache.set(id, fresh);
    return fresh;
  }

  /**
   * Apply a patch (lock-protected) and persist. Returns the new state.
   *
   * NOTE: this does NOT clamp affinity — callers (e.g. NPCService) are
   * responsible for clamping with `clampAffinity` before passing in. Keeping
   * the manager dumb avoids hiding bugs where unclamped values get
   * accidentally written.
   */
  async update(id: string, patch: RelationshipPatch): Promise<RelationshipData> {
    return this.withLock(id, async () => {
      const cur = await this.load(id);
      const next: RelationshipData = {
        npcId: id,
        affinity: patch.affinity ?? cur.affinity,
        emotion: patch.emotion ?? cur.emotion,
        lastUpdated: patch.lastUpdated ?? Date.now(),
      };
      this.cache.set(id, next);
      await this.persist(next);
      return next;
    });
  }

  /** Reset to default (lock-protected, deletes the file). */
  async clear(id: string): Promise<RelationshipData> {
    return this.withLock(id, async () => {
      this.cache.delete(id);
      const path = this.filePath(id);
      const file = Bun.file(path);
      if (await file.exists()) {
        const { unlink } = await import('node:fs/promises');
        await unlink(path).catch(() => undefined);
      }
      const fresh = defaultRelationship(id);
      this.cache.set(id, fresh);
      return fresh;
    });
  }

  /**
   * Read-through snapshot of every relationship currently on disk.
   * Used by SaveService payload assembly — does not lock individual ids
   * because the result is a copy and callers don't write through it.
   */
  async getAll(): Promise<Map<string, RelationshipData>> {
    const out = new Map<string, RelationshipData>();
    const { readdir } = await import('node:fs/promises');
    let entries: string[] = [];
    try {
      entries = await readdir(this.saveDir);
    } catch {
      // Directory not yet created — no relationships to report.
      return out;
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const id = name.replace(/\.json$/, '');
      try {
        const data = await this.load(id);
        out.set(id, data);
      } catch (err) {
        console.warn(`[RelationshipManager] failed to load ${id}:`, err);
      }
    }
    return out;
  }

  private async persist(data: RelationshipData): Promise<void> {
    const path = this.filePath(data.npcId);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, JSON.stringify(data, null, 2));
  }
}
