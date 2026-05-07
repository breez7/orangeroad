/**
 * SaveStorage — file-system persistence for game save slots (FR-008, NFR-006).
 *
 * Reference: DESIGN.md §"Backend Structure" — `storage/SaveStorage.ts`.
 *
 * Saves are written as one JSON file per slot under `<repo>/saves/slots/`,
 * resolved relative to this file (matches ContextManager's pattern). The
 * slot id is the filename (without `.json`); callers must validate the id
 * before calling. We keep the on-disk shape opaque here: this layer only
 * stores `unknown` payloads — schema validation lives in SaveService.
 *
 * Atomic write strategy:
 *   - Write the full payload to `<slotId>.json.tmp`
 *   - `rename()` over the final path
 *
 * `rename()` is atomic on POSIX, so a crash mid-write leaves either the
 * old file intact or the new one fully present, never a half-written
 * `<slotId>.json`. The `.tmp` file may linger after a crash; `read()` and
 * `list()` ignore it.
 */

import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface SaveStorageOptions {
  /** Directory holding `${slotId}.json` files. */
  saveDir: string;
}

export interface SaveSlotInfo {
  slotId: string;
  /** mtime in epoch ms. */
  mtime: number;
  /** File size in bytes. */
  size: number;
}

export class SaveStorage {
  private readonly saveDir: string;

  constructor(opts?: Partial<SaveStorageOptions>) {
    // Default points at `<repo>/saves/slots/`. The repo root is three
    // directories above this file: `backend/src/storage/SaveStorage.ts` →
    // `<repo>/`. Matches ContextManager's resolution strategy so that
    // `<repo>/saves/` houses both `npc-context/` and `slots/`.
    const def = resolve(import.meta.dir, '..', '..', '..', 'saves', 'slots');
    this.saveDir = opts?.saveDir ?? def;
  }

  /** Slot file path. Caller is responsible for validating slotId. */
  private filePath(slotId: string): string {
    return resolve(this.saveDir, `${slotId}.json`);
  }

  private tmpPath(slotId: string): string {
    return resolve(this.saveDir, `${slotId}.json.tmp`);
  }

  /**
   * Atomic-ish write: serialize payload, write to a `.tmp` sibling, then
   * `rename()` over the final path.
   */
  async write(slotId: string, payload: unknown): Promise<void> {
    await mkdir(this.saveDir, { recursive: true });
    const json = JSON.stringify(payload, null, 2);
    const tmp = this.tmpPath(slotId);
    const final = this.filePath(slotId);
    await writeFile(tmp, json, { encoding: 'utf-8' });
    try {
      await rename(tmp, final);
    } catch (err) {
      // Best-effort cleanup of the orphaned tmp file before rethrowing.
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  /** Returns the parsed JSON payload or `null` if the slot doesn't exist. */
  async read(slotId: string): Promise<unknown | null> {
    const path = this.filePath(slotId);
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    try {
      return (await file.json()) as unknown;
    } catch (err) {
      console.warn(`[SaveStorage] failed to parse ${path}:`, err);
      return null;
    }
  }

  /**
   * Directory listing sorted by mtime descending. Skips any non-`.json`
   * file (notably `.json.tmp` orphans from a crashed write).
   */
  async list(): Promise<SaveSlotInfo[]> {
    let entries: string[];
    try {
      entries = await readdir(this.saveDir);
    } catch (err) {
      // Missing dir == empty list. Surface other errors.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const slots: SaveSlotInfo[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json') || name.endsWith('.tmp')) continue;
      const slotId = name.replace(/\.json$/, '');
      const path = resolve(this.saveDir, name);
      try {
        const st = await stat(path);
        slots.push({
          slotId,
          mtime: st.mtimeMs,
          size: st.size,
        });
      } catch (err) {
        // Skip files we can't stat — listing must not fail because one
        // file disappeared between readdir and stat.
        console.warn(`[SaveStorage] stat failed for ${path}:`, err);
      }
    }

    slots.sort((a, b) => b.mtime - a.mtime);
    return slots;
  }

  async exists(slotId: string): Promise<boolean> {
    return Bun.file(this.filePath(slotId)).exists();
  }

  /** Returns true if the file existed and was removed; false if it didn't exist. */
  async delete(slotId: string): Promise<boolean> {
    const path = this.filePath(slotId);
    try {
      await unlink(path);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }
}
