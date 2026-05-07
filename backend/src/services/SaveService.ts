/**
 * SaveService — Phase 3.2 (FR-008 세이브/로드).
 *
 * Reference: DESIGN.md §"Backend Structure" `services/SaveService.ts` and
 * §"GameState" data model.
 *
 * Responsibilities:
 *  - Validate save payloads with zod at the API boundary.
 *  - Delegate raw I/O to SaveStorage.
 *  - Surface typed errors so the route layer can map to 400/404.
 *
 * Versioning:
 *  - This phase persists `version: 1` only. We reject any other version
 *    explicitly with `SaveValidationError` so a future v2 schema can land
 *    behind a real migration path. NO in-place migrations here — when v2
 *    arrives we'll add a dedicated migrator stage in front of `load()`.
 *
 * Scope notes:
 *  - NPC dialog histories are persisted per-NPC by ContextManager (Phase
 *    2.2). SaveService stores only the player-visible game state needed
 *    for a clean restore: time, player position, NPC positions/locations,
 *    and the current location id. NPC histories are intentionally NOT
 *    duplicated here.
 *  - No save-game encryption (NFR-005 baseline: friends-only deployment).
 */

import { z, ZodError } from 'zod';
import type { SaveStorage, SaveSlotInfo } from '@/storage/SaveStorage';
import { relationshipDataSchema } from '@/models/Relationship';

// --- Schema -----------------------------------------------------------------

const SLOT_ID_RE = /^[a-z0-9_-]{1,32}$/;

export const slotIdSchema = z
  .string()
  .regex(SLOT_ID_RE, 'slotId must match /^[a-z0-9_-]{1,32}$/');

const dayOfWeekSchema = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

const timeSchema = z.object({
  day: z.number().int().min(1),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  dayOfWeek: dayOfWeekSchema,
  phaseLabel: z.string().min(1).max(64),
});

const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const npcEntrySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  locationId: z.string().min(1).max(64).nullable(),
  position: positionSchema,
});

/**
 * Versioned save envelope. `version` is a literal `1` — adding a new shape
 * later means bumping this and writing a migrator, not extending in-place.
 *
 * Phase 3.3 note: `relationships` is OPTIONAL on v1 so existing v1 saves from
 * Phase 3.2 still load cleanly. New saves include the field; the loader on
 * the frontend defaults missing entries to `{ affinity: 50, emotion: 'neutral' }`.
 *
 * Phase 4.1 note: `flags` and `story` are also optional on v1 so saves written
 * before the story system existed keep loading. Missing slices default to
 * empty (no flags set, no events fired).
 */
/**
 * Phase C (Issue #23) — discriminated union schema for the active scene.
 * `outdoor` means the player is on the town map; `indoor` means inside one
 * of the indoor scenes (sceneId matches both the indoor scene id and the
 * outdoor location rect id). Optional on v1 saves (defaults to outdoor on
 * load); always present in v2.
 */
const currentSceneSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('outdoor') }),
  z.object({ kind: z.literal('indoor'), sceneId: z.string().min(1).max(64) }),
]);

export const gameSaveV1Schema = z.object({
  /**
   * v1 — saves written before Issue #23 (no `currentScene`).
   * v2 — saves written from Issue #23 onward; carries the active scene.
   * Both versions share every other field; the only schema delta is the
   * presence of `currentScene` (which is also accepted on v1 for clients
   * that pre-emptively emit it). `parsePayload` uses the literal version
   * value, not the field's presence, to decide migration.
   */
  version: z.union([z.literal(1), z.literal(2)]),
  /** Epoch ms when the save was created. */
  savedAt: z.number().int().nonnegative(),
  /** Optional user-supplied label shown in the slot list. */
  label: z.string().max(64).optional(),
  /** Frontend phase string at save time — debug aid only. */
  phase: z.string().min(1).max(32),
  time: timeSchema,
  playerPosition: positionSchema,
  /** Map of NPC id → store-shape entry. */
  npcs: z.record(z.string(), npcEntrySchema),
  currentLocationId: z.string().min(1).max(64).nullable(),
  /**
   * Phase 3.3 — per-NPC relationship state. Optional for backward-compat
   * with v1 saves written before this phase.
   */
  relationships: z.record(z.string(), relationshipDataSchema).optional(),
  /**
   * Phase 4.1 — story flags. Open value type so authors can use booleans,
   * counters, or short strings as needed. Optional for backward-compat.
   */
  flags: z
    .record(z.string(), z.union([z.boolean(), z.string(), z.number()]))
    .optional(),
  /**
   * Phase 4.1 — fired-events history (event ids that have already played
   * for this save; used to gate `once: true` events). Optional for v1
   * backward-compat.
   */
  story: z
    .object({
      fireHistory: z.array(z.string().min(1).max(64)).max(1024),
    })
    .optional(),
  /**
   * Phase 5.2 — user audio mixer settings (Issue #15). Optional for v1
   * backward-compat with saves written before sound was added. All numeric
   * fields are clamped to 0..1 by the schema; the FE further clamps on
   * apply so a corrupted slider value can't blow the bus.
   */
  audio: z
    .object({
      musicVolume: z.number().min(0).max(1),
      sfxVolume: z.number().min(0).max(1),
      muted: z.boolean(),
      bgmEnabled: z.boolean(),
    })
    .optional(),
  /**
   * Phase C (Issue #23) — active top-level scene at save time. Optional on
   * v1 (frontend defaults missing → outdoor on load); v2 always emits it.
   */
  currentScene: currentSceneSchema.optional(),
});

export type GameSaveV1 = z.infer<typeof gameSaveV1Schema>;

// --- Errors -----------------------------------------------------------------

export class SaveValidationError extends Error {
  readonly issues: ZodError['issues'];
  constructor(message: string, issues: ZodError['issues']) {
    super(message);
    this.name = 'SaveValidationError';
    this.issues = issues;
  }
}

export class SaveNotFoundError extends Error {
  readonly slotId: string;
  constructor(slotId: string) {
    super(`Save not found: ${slotId}`);
    this.name = 'SaveNotFoundError';
    this.slotId = slotId;
  }
}

// --- Service ----------------------------------------------------------------

export interface SaveServiceDeps {
  storage: SaveStorage;
}

export interface SaveListEntry {
  slotId: string;
  savedAt: number;
  label?: string;
  phase: string;
  time: GameSaveV1['time'];
}

export class SaveService {
  private readonly storage: SaveStorage;

  constructor({ storage }: SaveServiceDeps) {
    this.storage = storage;
  }

  /** Validate and persist a save payload. Returns the canonical payload. */
  async save(slotId: string, raw: unknown): Promise<GameSaveV1> {
    this.assertSlotId(slotId);
    const parsed = this.parsePayload(raw);
    await this.storage.write(slotId, parsed);
    return parsed;
  }

  /** Load a save payload by slot id. Throws SaveNotFoundError on missing. */
  async load(slotId: string): Promise<GameSaveV1> {
    this.assertSlotId(slotId);
    const raw = await this.storage.read(slotId);
    if (raw === null) throw new SaveNotFoundError(slotId);
    return this.parsePayload(raw);
  }

  /**
   * Enumerate all valid saves with summary metadata. Slots whose payload
   * fails validation (corrupt / wrong version) are omitted from the list
   * rather than failing the whole call.
   */
  async list(): Promise<SaveListEntry[]> {
    const infos: SaveSlotInfo[] = await this.storage.list();
    const out: SaveListEntry[] = [];
    for (const info of infos) {
      const raw = await this.storage.read(info.slotId);
      if (raw === null) continue;
      const result = gameSaveV1Schema.safeParse(raw);
      if (!result.success) {
        console.warn(
          `[SaveService] skipping malformed slot ${info.slotId} in list:`,
          result.error.issues,
        );
        continue;
      }
      const payload = result.data;
      const entry: SaveListEntry = {
        slotId: info.slotId,
        savedAt: payload.savedAt,
        phase: payload.phase,
        time: payload.time,
      };
      if (payload.label !== undefined) entry.label = payload.label;
      out.push(entry);
    }
    // Newest-first by savedAt (storage.list already sorts by mtime, but
    // savedAt is the user-facing timestamp; trust the in-payload value).
    out.sort((a, b) => b.savedAt - a.savedAt);
    return out;
  }

  async del(slotId: string): Promise<void> {
    this.assertSlotId(slotId);
    const removed = await this.storage.delete(slotId);
    if (!removed) throw new SaveNotFoundError(slotId);
  }

  // --- internals ------------------------------------------------------------

  private assertSlotId(slotId: string): void {
    const result = slotIdSchema.safeParse(slotId);
    if (!result.success) {
      throw new SaveValidationError('invalid slotId', result.error.issues);
    }
  }

  private parsePayload(raw: unknown): GameSaveV1 {
    const result = gameSaveV1Schema.safeParse(raw);
    if (!result.success) {
      throw new SaveValidationError('save payload validation failed', result.error.issues);
    }
    return result.data;
  }
}
