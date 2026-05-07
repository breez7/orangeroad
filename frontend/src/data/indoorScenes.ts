/**
 * Indoor scene definitions (Issue #23 Phase C).
 *
 * Each entry maps a single outdoor `LocationDef.id` → an indoor "room" the
 * player can step into via a doorway. The art is built procedurally per
 * scene in `scenes/IndoorScene.ts`; this file only carries the
 * scene-coordinate metadata that both the renderer and the scene-switcher
 * need.
 *
 *   id            — matches the outdoor `locationId` so the schedule system's
 *                   data round-trips (NPCs whose schedule.locationId === id
 *                   show up in this room).
 *   displayName   — Korean label drawn as the scene banner.
 *   bounds        — indoor canvas size in indoor coords. We pick 1280×720 to
 *                   match the outdoor canvas so MovementSystem.fitTo()
 *                   letterboxes identically across scene swaps.
 *   doorReturn    — coords *inside* the indoor scene where the player spawns
 *                   on entry and where the indoor doorway tile is drawn. A
 *                   few pixels in from the bottom edge so the exit feels like
 *                   "walk down to leave".
 *   outdoorReturn — coords *outside* the location's outdoor rect, on the
 *                   side that faces the town center, where the player
 *                   materialises after exiting. Picked manually per location
 *                   to land the player on the connecting footpath.
 *
 * The park is intentionally absent — it stays an outdoor-only location.
 */

export interface IndoorSceneDef {
  id: string;
  displayName: string;
  bounds: { width: number; height: number };
  doorReturn: { x: number; y: number };
  outdoorReturn: { x: number; y: number };
}

const INDOOR_W = 1280;
const INDOOR_H = 720;

/**
 * Outdoor anchors used to compute `outdoorReturn`. Mirrors the GameScene
 * connecting-paths logic: anchor a few pixels outside the rect on whichever
 * edge faces the town center.
 *
 *   school        (80, 80) 360×200, center y < townCy  → return below rect
 *   kyousuke-home (540, 100) 220×160, center y < townCy → return below rect
 *   madoka-home   (860, 100) 220×160, center y < townCy → return below rect
 *   hikaru-home   (80, 440) 220×160, center y > townCy  → return above rect
 *   cafe          (460, 440) 240×160, center y > townCy → return above rect
 *
 * Coordinates are in town-local pixel space (TOWN_BOUNDS = 1280×720).
 */
export const INDOOR_SCENES: IndoorSceneDef[] = [
  {
    id: 'school',
    displayName: '학교 교실',
    bounds: { width: INDOOR_W, height: INDOOR_H },
    doorReturn: { x: INDOOR_W / 2, y: INDOOR_H - 80 },
    outdoorReturn: { x: 260, y: 300 }, // below the school rect's bottom edge
  },
  {
    id: 'cafe',
    displayName: '카페 ABCB',
    bounds: { width: INDOOR_W, height: INDOOR_H },
    doorReturn: { x: INDOOR_W / 2, y: INDOOR_H - 80 },
    outdoorReturn: { x: 580, y: 420 }, // above the cafe rect's top edge
  },
  {
    id: 'kyousuke-home',
    displayName: '쿄우스케의 집',
    bounds: { width: INDOOR_W, height: INDOOR_H },
    doorReturn: { x: INDOOR_W / 2, y: INDOOR_H - 80 },
    outdoorReturn: { x: 650, y: 280 }, // below the kyousuke-home rect's bottom edge
  },
  {
    id: 'madoka-home',
    displayName: '마도카의 집',
    bounds: { width: INDOOR_W, height: INDOOR_H },
    doorReturn: { x: INDOOR_W / 2, y: INDOOR_H - 80 },
    outdoorReturn: { x: 970, y: 280 }, // below the madoka-home rect's bottom edge
  },
  {
    id: 'hikaru-home',
    displayName: '히카루의 집',
    bounds: { width: INDOOR_W, height: INDOOR_H },
    doorReturn: { x: INDOOR_W / 2, y: INDOOR_H - 80 },
    outdoorReturn: { x: 190, y: 420 }, // above the hikaru-home rect's top edge
  },
];

/** Lookup by scene id. Returns null on unknown ids (e.g. 'park'). */
export function getIndoorScene(id: string): IndoorSceneDef | null {
  return INDOOR_SCENES.find((s) => s.id === id) ?? null;
}

/** True if the given location id has an enterable indoor scene. */
export function hasIndoorScene(id: string): boolean {
  return INDOOR_SCENES.some((s) => s.id === id);
}
