/**
 * AffinityHeuristic — Phase 3.3 (FR-007).
 *
 * Deterministic, LLM-free derivation of (affinityChange, emotion) from a
 * dialog turn. The rules are intentionally simple — Phase 3.3 only needs to
 * prove "talking to an NPC nudges affinity in a believable direction"; a
 * richer model (e.g. embedding-based sentiment) is a Phase 4.x polish item.
 *
 * Why no LLM call? Three reasons:
 *  1. Cost — RPi4 already runs LM Studio for the dialog; a second pass would
 *     double latency.
 *  2. Reproducibility — saves should produce identical state on replay.
 *  3. Graceful degradation — affinity still moves even if the LLM is offline.
 *
 * Algorithm:
 *  - Combined text = userMessage + " " + npcResponse, lowercased.
 *  - Scan for Korean keyword groups, each with a weight in [-4, +3].
 *  - Sum the weights. Cap the per-turn delta at ±5 so a wall of "사랑사랑사랑"
 *    can't yo-yo affinity 0→100 in one message.
 *  - Emotion derived from which keyword group "wins" (highest absolute hits),
 *    falling back to the previous emotion when no keyword matched.
 */

import type { Emotion } from '@/models/Relationship';

export interface AffinityKeywordGroup {
  /** Tag used to map to an emotion. */
  tag: 'positive' | 'negative' | 'shy' | 'flirty' | 'sad';
  /** Per-hit affinity delta. */
  weight: number;
  /** Plain-text keyword fragments. Korean does not lowercase, so stored as-is. */
  keywords: string[];
}

/**
 * Keyword table. Order matters only for the emotion tiebreak below — within a
 * group, multiple hits each contribute `weight`. Substring matching is
 * deliberate (e.g. "사랑해" matches "사랑").
 */
export const KEYWORD_GROUPS: AffinityKeywordGroup[] = [
  // Positive — generic kindness, gratitude, agreement
  {
    tag: 'positive',
    weight: 2,
    keywords: ['좋아', '고마워', '고맙', '감사', '기뻐', '행복', '재밌', '재미있'],
  },
  // Flirty — romantic / complimentary
  {
    tag: 'flirty',
    weight: 3,
    keywords: ['사랑', '예뻐', '예쁘', '귀여', '멋', '좋아해'],
  },
  // Shy — greetings, polite hellos. Smallest positive delta.
  {
    tag: 'shy',
    weight: 1,
    keywords: ['안녕', '반가', '잘 지내'],
  },
  // Negative — insults, disagreement
  {
    tag: 'negative',
    weight: -3,
    keywords: ['싫어', '미워', '짜증', '바보', '멍청', '꺼져', '닥쳐'],
  },
  // Sad — sadness expressed by either party. Mild affinity drop because a
  // gloomy turn shouldn't be neutral, but it shouldn't tank affinity either.
  {
    tag: 'sad',
    weight: -1,
    keywords: ['슬퍼', '울', '미안', '죄송'],
  },
];

/** Hard cap on per-turn affinity delta. Keep below the manager's clamp window. */
export const MAX_DELTA = 5;

export interface DeriveArgs {
  userMessage: string;
  npcResponse: string;
  /** Current emotion to fall back to when no keyword matched. */
  currentEmotion: Emotion;
  /**
   * Phase 4.3 — per-character keyword overrides. When a token from `likes`
   * appears in the combined turn, it adds an extra positive bump on top of
   * the global `KEYWORD_GROUPS` matches. `dislikes` adds a negative bump.
   * The extras are still capped by {@link MAX_DELTA} so per-character data
   * cannot break Phase 3.3 invariants.
   *
   * Substring matching is intentional, mirroring the global table — Korean
   * substrings like "농구" inside "농구공" still count.
   */
  likes?: string[];
  dislikes?: string[];
}

/** Per-hit weight for character-specific likes (positive) / dislikes (negative). */
export const PER_CHARACTER_LIKE_WEIGHT = 2;
export const PER_CHARACTER_DISLIKE_WEIGHT = -2;

export interface DeriveResult {
  affinityChange: number;
  /** New dominant emotion (may equal currentEmotion if no keyword fired). */
  emotion: Emotion;
}

/** Map a winning keyword tag to an Emotion. */
function tagToEmotion(tag: AffinityKeywordGroup['tag']): Emotion {
  switch (tag) {
    case 'positive':
      return 'happy';
    case 'flirty':
      return 'flirty';
    case 'shy':
      return 'shy';
    case 'negative':
      return 'angry';
    case 'sad':
      return 'sad';
  }
}

/**
 * Count substring hits for a keyword in a haystack. We use a simple
 * non-overlapping scan so "사랑사랑" yields 2 hits — slight bias toward
 * intensity, but capped overall by MAX_DELTA.
 */
function countHits(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    count += 1;
    from = i + needle.length;
  }
  return count;
}

export function deriveAffinityChange({
  userMessage,
  npcResponse,
  currentEmotion,
  likes,
  dislikes,
}: DeriveArgs): DeriveResult {
  // Combine both sides of the turn — the NPC's *response* is also a clue.
  const combined = `${userMessage} ${npcResponse}`;

  let totalDelta = 0;
  let bestTag: AffinityKeywordGroup['tag'] | null = null;
  let bestScore = 0;

  for (const group of KEYWORD_GROUPS) {
    let groupHits = 0;
    for (const kw of group.keywords) {
      groupHits += countHits(combined, kw);
    }
    if (groupHits > 0) {
      totalDelta += groupHits * group.weight;
      // Tiebreak: keep the group with the most hits as the emotion driver.
      // Equal hits → first group in the table wins (stable for replay).
      if (groupHits > bestScore) {
        bestScore = groupHits;
        bestTag = group.tag;
      }
    }
  }

  // Phase 4.3 — per-character likes / dislikes layered on top of the global
  // groups. They contribute affinity but DO NOT override the dominant emotion
  // tiebreak (a "likes" hit on a generic positive turn keeps emotion=happy;
  // a "dislikes" hit on a generic positive turn shouldn't flip emotion to
  // angry on its own — emotion still follows the global table).
  if (likes && likes.length > 0) {
    let likeHits = 0;
    for (const kw of likes) {
      likeHits += countHits(combined, kw);
    }
    if (likeHits > 0) {
      totalDelta += likeHits * PER_CHARACTER_LIKE_WEIGHT;
    }
  }
  if (dislikes && dislikes.length > 0) {
    let dislikeHits = 0;
    for (const kw of dislikes) {
      dislikeHits += countHits(combined, kw);
    }
    if (dislikeHits > 0) {
      totalDelta += dislikeHits * PER_CHARACTER_DISLIKE_WEIGHT;
    }
  }

  // Cap per-turn movement.
  if (totalDelta > MAX_DELTA) totalDelta = MAX_DELTA;
  if (totalDelta < -MAX_DELTA) totalDelta = -MAX_DELTA;

  const emotion: Emotion = bestTag ? tagToEmotion(bestTag) : currentEmotion;

  return { affinityChange: totalDelta, emotion };
}
