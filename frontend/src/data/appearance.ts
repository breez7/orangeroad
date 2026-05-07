/**
 * Phase B-1 (#20) — per-NPC visual appearance config.
 *
 * Pure-Graphics SD-style sprites are built from these descriptors at NPC
 * construction time. Keeping the config separate from {@link NPCDef} so
 * gameplay data (id / name / spawn / locationId) stays small and the visual
 * layer can be swapped wholesale (e.g. for sprite art) without touching the
 * roster.
 *
 * Color picks are canonical-feeling rather than slavishly accurate to the
 * manga — distinguishing the seven NPCs at ~24×36 logical pixels is the
 * design constraint, not photo-real reproduction.
 */

export type HairStyle =
  | 'short'
  | 'medium'
  | 'long'
  | 'ponytail'
  | 'twintails'
  | 'bob';

export type BottomKind = 'pants' | 'skirt';

export type Accessory = 'glasses' | null;

export interface NPCAppearance {
  hairColor: number;
  hairStyle: HairStyle;
  /** Default warm-skin tone; can be overridden per NPC. */
  skinColor: number;
  shirtColor: number;
  bottomColor: number;
  bottomKind: BottomKind;
  accessory: Accessory;
}

const DEFAULT_SKIN = 0xffd6a5;

/**
 * id → appearance lookup. Every NPC in `data/npcs.ts` MUST have an entry here
 * — `getAppearance()` falls back to a neutral preset for safety, but the
 * roster is small enough that any miss is a bug.
 */
export const NPC_APPEARANCE: Record<string, NPCAppearance> = {
  // 마도카 — main heroine. Long brown hair + blue uniform.
  madoka: {
    hairColor: 0x6b4423,
    hairStyle: 'long',
    skinColor: DEFAULT_SKIN,
    shirtColor: 0x4a6fa5,
    bottomColor: 0x2c3e62,
    bottomKind: 'skirt',
    accessory: null,
  },
  // 히카루 — energetic, athletic. Red short hair + bright top.
  hikaru: {
    hairColor: 0xc23a2a,
    hairStyle: 'short',
    skinColor: DEFAULT_SKIN,
    shirtColor: 0xff6b6b,
    bottomColor: 0xb84a4a,
    bottomKind: 'pants',
    accessory: null,
  },
  // 쿠루미 — younger twin. Blonde twintails + pink dress.
  kurumi: {
    hairColor: 0xf6c453,
    hairStyle: 'twintails',
    skinColor: DEFAULT_SKIN,
    shirtColor: 0xffb3c6,
    bottomColor: 0xff8fa3,
    bottomKind: 'skirt',
    accessory: null,
  },
  // 만타 — bookish twin. Black short hair + glasses.
  manta: {
    hairColor: 0x222232,
    hairStyle: 'short',
    skinColor: DEFAULT_SKIN,
    shirtColor: 0x6f4e7c,
    bottomColor: 0x3d3052,
    bottomKind: 'pants',
    accessory: 'glasses',
  },
  // 유사카 — best friend, casual. Brown short hair + tank top.
  yusaku: {
    hairColor: 0x8b5a2b,
    hairStyle: 'short',
    skinColor: DEFAULT_SKIN,
    shirtColor: 0xeae0c8,
    bottomColor: 0x3a5a40,
    bottomKind: 'pants',
    accessory: null,
  },
  // 세이코 — outgoing friend. Pink long hair + apron.
  seiko: {
    hairColor: 0xff7aa2,
    hairStyle: 'long',
    skinColor: DEFAULT_SKIN,
    shirtColor: 0xfffbe6,
    bottomColor: 0xffb703,
    bottomKind: 'skirt',
    accessory: null,
  },
  // 마스미 — easy-going friend. Black long hair + casual.
  masumi: {
    hairColor: 0x1a1a2a,
    hairStyle: 'bob',
    skinColor: DEFAULT_SKIN,
    shirtColor: 0x5fb0c7,
    bottomColor: 0x274757,
    bottomKind: 'pants',
    accessory: null,
  },
};

/** Safe fallback used when an id has no entry in the table. */
const FALLBACK: NPCAppearance = {
  hairColor: 0x3d2b1f,
  hairStyle: 'short',
  skinColor: DEFAULT_SKIN,
  shirtColor: 0x888888,
  bottomColor: 0x444444,
  bottomKind: 'pants',
  accessory: null,
};

/** Read an NPC's appearance, with a neutral preset for unknown ids. */
export function getAppearance(id: string): NPCAppearance {
  return NPC_APPEARANCE[id] ?? FALLBACK;
}
