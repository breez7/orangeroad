import type { NPCDef } from '@/entities/NPC';

/**
 * Phase 2.1 NPC roster (FR-001 / FR-010).
 *
 * Spawn points sit inside each character's "home" location rect so the visual
 * tells the player at-a-glance who lives where. The player is soft-snapped
 * out of building rects by MovementSystem, so co-locating NPCs there does
 * not create movement conflicts.
 *
 * Colors are chosen to be distinct from each other AND from the player's
 * orange (0xff6b35). Tints will be replaced by sprite art in a later phase.
 */
export const NPCS: NPCDef[] = [
  // 마도카 — main heroine, at her home (top-right of town)
  {
    id: 'madoka',
    name: '마도카',
    color: 0x6c8cff, // soft blue — the cool, mysterious heroine
    spawn: { x: 970, y: 180 },
    locationId: 'madoka-home',
  },
  // 히카루 — the energetic heroine, at her home (bottom-left)
  {
    id: 'hikaru',
    name: '히카루',
    color: 0xff5d8f, // warm pink
    spawn: { x: 190, y: 520 },
    locationId: 'hikaru-home',
  },
  // 쿠루미 — Kyousuke's twin sister, at the Kasuga residence
  {
    id: 'kurumi',
    name: '쿠루미',
    color: 0xc77dff, // lavender (twin Manami also placed here below)
    spawn: { x: 615, y: 175 },
    locationId: 'kyousuke-home',
  },
  // 만타 — the other twin sister, at the Kasuga residence
  {
    id: 'manta',
    name: '만타',
    color: 0x9d4edd, // deeper purple to distinguish from her twin
    spawn: { x: 685, y: 175 },
    locationId: 'kyousuke-home',
  },
  // 유사카 — Kyousuke's classmate, hanging around school
  {
    id: 'yusaku',
    name: '유사카',
    color: 0x52b788, // green — kendo-club friend energy
    spawn: { x: 200, y: 180 },
    locationId: 'school',
  },
  // 세이코 — Madoka's friend, often at the cafe
  {
    id: 'seiko',
    name: '세이코',
    color: 0xffb703, // bright yellow — outgoing personality
    spawn: { x: 580, y: 520 },
    locationId: 'cafe',
  },
  // 마스미 — friend, usually at the park
  {
    id: 'masumi',
    name: '마스미',
    color: 0x00b4d8, // teal/cyan
    spawn: { x: 1000, y: 530 },
    locationId: 'park',
  },
];
