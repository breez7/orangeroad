import type { LocationDef } from '@/entities/Location';

export const TOWN_BOUNDS = { width: 1280, height: 720 } as const;

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
