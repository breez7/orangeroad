/**
 * NPCService — orchestrates a "talk" turn for an NPC.
 *
 * Flow per DESIGN.md §"NPC Interaction Flow":
 *   1. load character profile
 *   2. load conversation context AND relationship state (Phase 3.3)
 *   3. build prompt — including current emotion + affinity (Phase 3.3)
 *   4. call LM Studio (LLMClient)
 *   5. append user msg + AI response to context
 *   6. derive affinityChange + new emotion via AffinityHeuristic (Phase 3.3)
 *   7. persist updated relationship
 *   8. return response + recent history + emotionUpdate + affinityChange + relationship
 *
 * Phase 3.3 changes (from 2.2):
 *  - Pulls current relationship via RelationshipManager and feeds emotion +
 *    affinity into the prompt (FR-002 emotional response).
 *  - After the LLM call, runs deterministic keyword heuristic on the turn
 *    and persists the new affinity/emotion.
 *  - Surfaces emotionUpdate / affinityChange / relationship to the client so
 *    UI can render without a follow-up fetch.
 */

import { resolve } from 'node:path';
import type { LLMClient } from '@/ai/LLMClient';
import type { ContextManager, NPCHistoryEntry } from '@/ai/ContextManager';
import type { RelationshipManager } from '@/ai/RelationshipManager';
import { buildPrompt, type CharacterProfile } from '@/ai/PromptBuilder';
import { deriveAffinityChange } from '@/ai/AffinityHeuristic';
import {
  clampAffinity,
  type Emotion,
  type RelationshipData,
} from '@/models/Relationship';

export class NPCNotFoundError extends Error {
  constructor(npcId: string) {
    super(`NPC not found: ${npcId}`);
    this.name = 'NPCNotFoundError';
  }
}

export interface TalkArgs {
  npcId: string;
  message: string;
}

export interface TalkResult {
  npcId: string;
  response: string;
  history: NPCHistoryEntry[];
  /** Phase 3.3 — current dominant emotion AFTER this turn. */
  emotionUpdate: Emotion;
  /** Phase 3.3 — signed delta applied this turn (already clamped). */
  affinityChange: number;
  /** Phase 3.3 — full relationship state after the update, for client sync. */
  relationship: RelationshipData;
}

export interface NPCServiceOptions {
  /** Directory containing `${id}.json` character profile files. */
  charactersDir: string;
  /** How many history entries to return in the response payload. */
  recentHistorySize: number;
}

export class NPCService {
  private readonly charactersDir: string;
  private readonly recentHistorySize: number;
  private readonly profileCache = new Map<string, CharacterProfile>();
  private idsCache: string[] | null = null;

  constructor(
    private readonly llm: LLMClient,
    private readonly context: ContextManager,
    private readonly relationships: RelationshipManager,
    opts?: Partial<NPCServiceOptions>,
  ) {
    // Default points at the bundled `backend/src/data/characters/` directory.
    const defaultDir = resolve(import.meta.dir, '..', 'data', 'characters');
    this.charactersDir = opts?.charactersDir ?? defaultDir;
    this.recentHistorySize = opts?.recentHistorySize ?? 10;
  }

  async loadProfile(npcId: string): Promise<CharacterProfile> {
    const cached = this.profileCache.get(npcId);
    if (cached) return cached;

    const path = resolve(this.charactersDir, `${npcId}.json`);
    const file = Bun.file(path);
    if (!(await file.exists())) {
      throw new NPCNotFoundError(npcId);
    }
    let profile: CharacterProfile;
    try {
      profile = (await file.json()) as CharacterProfile;
    } catch (err) {
      // Corrupt or unreadable JSON — surface as 404 so callers don't 500.
      console.warn(`[NPCService] failed to parse profile ${path}:`, err);
      throw new NPCNotFoundError(npcId);
    }
    if (!profile?.id || !profile?.name || !profile?.personality) {
      throw new NPCNotFoundError(npcId);
    }
    this.profileCache.set(npcId, profile);
    return profile;
  }

  async listIds(): Promise<string[]> {
    if (this.idsCache) return this.idsCache;
    const { readdir } = await import('node:fs/promises');
    try {
      const entries = await readdir(this.charactersDir);
      const ids = entries
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort();
      this.idsCache = ids;
      return ids;
    } catch (err) {
      console.warn('[NPCService] failed to list characters dir:', err);
      return [];
    }
  }

  async getRecentHistory(npcId: string): Promise<NPCHistoryEntry[]> {
    return this.context.recent(npcId, this.recentHistorySize);
  }

  async clearContext(npcId: string): Promise<void> {
    await this.context.clear(npcId);
  }

  // --- Phase 3.3 relationship surface -------------------------------------

  /**
   * Get current relationship state, creating a default if missing. Throws
   * NPCNotFoundError if the npcId doesn't correspond to a known profile.
   */
  async getRelationship(npcId: string): Promise<RelationshipData> {
    await this.loadProfile(npcId);
    return this.relationships.load(npcId);
  }

  /** Reset relationship to default. Throws NPCNotFoundError on unknown id. */
  async clearRelationship(npcId: string): Promise<RelationshipData> {
    await this.loadProfile(npcId);
    return this.relationships.clear(npcId);
  }

  /** Snapshot of every persisted relationship (used by SaveService). */
  async getAllRelationships(): Promise<Map<string, RelationshipData>> {
    return this.relationships.getAll();
  }

  // --- talk ---------------------------------------------------------------

  async talk({ npcId, message }: TalkArgs): Promise<TalkResult> {
    const profile = await this.loadProfile(npcId);
    const ctx = await this.context.load(npcId);
    const rel = await this.relationships.load(npcId);

    const messages = buildPrompt({
      npc: profile,
      history: ctx.history,
      userMessage: message,
      emotion: rel.emotion,
      affinity: rel.affinity,
    });

    // Throws LLMError on failure — caller maps to 503. We deliberately
    // do NOT update relationship state on LLM failure; affinity should
    // only move on successful turns.
    const result = await this.llm.chat(messages);

    // Persist both turns in a single locked write so a disk hiccup can never
    // leave an orphan user turn without its matching assistant reply.
    await this.context.appendTurn(npcId, message, result.content);

    // Derive deterministic affinity delta + new emotion from the turn.
    const { affinityChange, emotion } = deriveAffinityChange({
      userMessage: message,
      npcResponse: result.content,
      currentEmotion: rel.emotion,
    });

    const newAffinity = clampAffinity(rel.affinity + affinityChange);
    // Re-derive the actual signed delta after clamping so the UI sees the
    // visible movement, not the pre-clamp value (e.g. 99 + 3 → 100, delta=1).
    const visibleChange = newAffinity - rel.affinity;

    const updated = await this.relationships.update(npcId, {
      affinity: newAffinity,
      emotion,
    });

    const recent = await this.context.recent(npcId, this.recentHistorySize);
    return {
      npcId,
      response: result.content,
      history: recent,
      emotionUpdate: updated.emotion,
      affinityChange: visibleChange,
      relationship: updated,
    };
  }
}
