/**
 * Relationship model — Phase 3.3 (FR-007).
 *
 * Reference: DESIGN.md §"NPCState" / `EmotionState` and §"RelationshipData".
 *
 * Plain types + a zod schema for the boundary. Kept deliberately small for
 * Phase 3.3 — affinity is a single 0-100 integer (clamped) and emotion is a
 * fixed enum. Richer fields (events, milestones, gift counters, etc.) belong
 * to a later phase.
 */

import { z } from 'zod';

/** Coarse emotion taxonomy for Phase 3.3. */
export const EMOTIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'shy',
  'flirty',
  'annoyed',
] as const;

export type Emotion = (typeof EMOTIONS)[number];

export const emotionSchema = z.enum(EMOTIONS);

/** Persistent per-NPC relationship state. */
export interface RelationshipData {
  npcId: string;
  /** Player → NPC affinity, 0-100 (clamped). Default 50 for "neutral acquaintance". */
  affinity: number;
  /** Current dominant emotion the NPC feels toward the player. */
  emotion: Emotion;
  /** Epoch ms of the most recent update (read at load + write at update). */
  lastUpdated: number;
}

export const relationshipDataSchema = z.object({
  npcId: z.string().min(1).max(64),
  affinity: z.number().int().min(0).max(100),
  emotion: emotionSchema,
  lastUpdated: z.number().int().nonnegative(),
});

/** Default state used whenever no persisted file exists yet. */
export function defaultRelationship(npcId: string, now: number = Date.now()): RelationshipData {
  return {
    npcId,
    affinity: 50,
    emotion: 'neutral',
    lastUpdated: now,
  };
}

/** Clamp affinity to [0, 100] and round to integer. */
export function clampAffinity(v: number): number {
  if (!Number.isFinite(v)) return 50;
  const n = Math.round(v);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}
