import type { LocationDef } from '@/entities/Location';

export const TOWN_BOUNDS = { width: 1280, height: 720 } as const;

/**
 * Phase 4.1 — coarse "which location rect is this point inside?" helper used
 * by the StorySystem to derive a `playerLocationId` for ON_LOCATION_ENTER
 * triggers. Returns null when the point is on grass between buildings.
 *
 * Note: Phase 4.1 movement softly nudges the player OUT of location rects, so
 * in practice this returns null for the player position most of the time.
 * Story authors should generally use ON_FLAG / ON_AFFINITY / ON_START for
 * Phase 4.1 events; ON_LOCATION_ENTER is wired up here so a future "doors"
 * pass can light up without further plumbing changes.
 */
export function findLocationAt(x: number, y: number, locs: readonly LocationDef[] = LOCATIONS): string | null {
  for (const l of locs) {
    if (x >= l.x && x <= l.x + l.width && y >= l.y && y <= l.y + l.height) {
      return l.id;
    }
  }
  return null;
}

/**
 * Phase 4.2 — return the geometric center of a location rect, used by the
 * ScheduleSystem to teleport NPCs to a default-but-distinct point inside
 * each building. Returns null when the location id is unknown so callers
 * can decide whether to no-op (the typical choice — leave the NPC where it
 * was rather than warping to a wrong spot).
 */
export function centerOf(
  locationId: string,
  locs: readonly LocationDef[] = LOCATIONS,
): { x: number; y: number } | null {
  for (const l of locs) {
    if (l.id === locationId) {
      return { x: l.x + l.width / 2, y: l.y + l.height / 2 };
    }
  }
  return null;
}

export const LOCATIONS: LocationDef[] = [
  {
    id: 'school',
    name: '학교',
    color: 0xf4a261,
    x: 80,
    y: 80,
    width: 360,
    height: 200,
  },
  {
    id: 'kyousuke-home',
    name: '쿄우스케 집',
    color: 0xe76f51,
    x: 540,
    y: 100,
    width: 220,
    height: 160,
  },
  {
    id: 'madoka-home',
    name: '마도카 집',
    color: 0xe9c46a,
    x: 860,
    y: 100,
    width: 220,
    height: 160,
  },
  {
    id: 'hikaru-home',
    name: '히카루 집',
    color: 0x2a9d8f,
    x: 80,
    y: 440,
    width: 220,
    height: 160,
  },
  {
    id: 'cafe',
    name: '카페 ABCB',
    color: 0xe07a5f,
    x: 460,
    y: 440,
    width: 240,
    height: 160,
  },
  {
    id: 'park',
    name: '공원',
    color: 0x6a994e,
    x: 820,
    y: 420,
    width: 360,
    height: 220,
  },
];
