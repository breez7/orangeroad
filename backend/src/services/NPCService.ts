/**
 * NPCService — orchestrates a "talk" turn for an NPC.
 *
 * Flow per DESIGN.md §"NPC Interaction Flow":
 *   1. load character profile
 *   2. load conversation context
 *   3. build prompt
 *   4. call LM Studio (LLMClient)
 *   5. append user msg + AI response to context
 *   6. return response + recent history
 *
 * Phase 2.2 deliberately does NOT compute emotion/affinity deltas — those
 * land in Phase 3.3. The response is plain text only.
 */

import { resolve } from 'node:path';
import type { LLMClient } from '@/ai/LLMClient';
import type { ContextManager, NPCHistoryEntry } from '@/ai/ContextManager';
import { buildPrompt, type CharacterProfile } from '@/ai/PromptBuilder';

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

  async talk({ npcId, message }: TalkArgs): Promise<TalkResult> {
    const profile = await this.loadProfile(npcId);
    const ctx = await this.context.load(npcId);

    const messages = buildPrompt({
      npc: profile,
      history: ctx.history,
      userMessage: message,
    });

    // Throws LLMError on failure — caller maps to 503.
    const result = await this.llm.chat(messages);

    // Persist both turns in a single locked write so a disk hiccup can never
    // leave an orphan user turn without its matching assistant reply.
    await this.context.appendTurn(npcId, message, result.content);

    const recent = await this.context.recent(npcId, this.recentHistorySize);
    return {
      npcId,
      response: result.content,
      history: recent,
    };
  }
}
