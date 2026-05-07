import { memo, useMemo } from 'react';
import type { Emotion } from '@/store/gameStore';
import {
  getAppearance,
  type HairStyle,
  type NPCAppearance,
} from '@/data/appearance';

/**
 * NpcPortrait — Phase B-3 (#22) Doukyusei-style dialog portrait.
 *
 * Renders an inline SVG bust of an NPC sized for the dialog panel
 * (~140 px). The geometry mirrors the in-world `NPC` PixiJS sprite (head +
 * hair back/front + face features + optional glasses) so that the
 * conversation portrait visually matches the character standing in the
 * scene. We expand the head ratio to give the portrait a recognisable face
 * even at small sizes — the in-world sprite optimises for distinguishing
 * silhouettes at 24×36 px, which is too small to read emotion from. Here
 * the face fills most of the canvas.
 *
 * The portrait is purely decorative — `aria-hidden` is set on the root SVG
 * because the AffinityIndicator already announces emotion + name in text.
 *
 * Performance: the entire render is a function of `(npcId, emotion, size)`,
 * so we wrap the component in `React.memo` and memoise the appearance lookup.
 * No effects, no store reads — the parent (DialogBox / StoryOverlay) feeds
 * the props down from its own store selectors.
 */
export interface NpcPortraitProps {
  /** Stable npc id (matches gameStore key). */
  npcId: string | null;
  /** Current emotion of the NPC. */
  emotion: Emotion;
  /** Pixel size of the rendered SVG (square). Defaults to 140. */
  size?: number;
  /** Optional className to layer on the SVG root (e.g. `rounded-full`). */
  className?: string;
}

// All geometry is authored on a 100×100 viewBox so we can scale via the
// parent `width` / `height` without re-tuning numbers per call site. The
// face origin is at (50, 48) — slightly above center to leave room for a
// small shoulder/neck slice at the bottom.
const VB = 100;

/** Convert a numeric color (0xRRGGBB) into an SVG-friendly `#rrggbb` string. */
function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** Lighten an 0xRRGGBB color toward white by `t∈[0,1]`. Used for highlights. */
function lighten(n: number, t: number): string {
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const lr = Math.round(r + (255 - r) * t);
  const lg = Math.round(g + (255 - g) * t);
  const lb = Math.round(b + (255 - b) * t);
  return `#${((lr << 16) | (lg << 8) | lb).toString(16).padStart(6, '0')}`;
}

/** Darken an 0xRRGGBB color toward black by `t∈[0,1]`. Used for outlines. */
function darken(n: number, t: number): string {
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const dr = Math.round(r * (1 - t));
  const dg = Math.round(g * (1 - t));
  const db = Math.round(b * (1 - t));
  return `#${((dr << 16) | (dg << 8) | db).toString(16).padStart(6, '0')}`;
}

const OUTLINE = '#1a1a2e';

/**
 * Hair "back" silhouette — the volume of hair behind the head. Mirrors the
 * shapes in `NPC.drawHairBack` but scaled up + repositioned for the 100×100
 * portrait viewBox.
 */
function HairBack({ style, color }: { style: HairStyle; color: string }) {
  const stroke = OUTLINE;
  const sw = 1.2;
  switch (style) {
    case 'short':
      return (
        <ellipse cx="50" cy="38" rx="28" ry="24" fill={color} stroke={stroke} strokeWidth={sw} />
      );
    case 'medium':
      return (
        <path
          d="M 22 32 Q 22 18 50 18 Q 78 18 78 32 L 78 62 Q 78 70 70 70 L 30 70 Q 22 70 22 62 Z"
          fill={color}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    case 'long':
      return (
        <path
          d="M 20 32 Q 20 16 50 16 Q 80 16 80 32 L 82 92 Q 82 98 76 98 L 24 98 Q 18 98 18 92 Z"
          fill={color}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    case 'ponytail':
      return (
        <>
          {/* skull cap */}
          <ellipse cx="50" cy="38" rx="28" ry="24" fill={color} stroke={stroke} strokeWidth={sw} />
          {/* tail trailing behind right shoulder */}
          <ellipse
            cx="74"
            cy="62"
            rx="9"
            ry="22"
            fill={color}
            stroke={stroke}
            strokeWidth={sw}
            transform="rotate(8 74 62)"
          />
        </>
      );
    case 'twintails':
      return (
        <>
          <ellipse cx="50" cy="38" rx="28" ry="24" fill={color} stroke={stroke} strokeWidth={sw} />
          <ellipse cx="20" cy="58" rx="9" ry="20" fill={color} stroke={stroke} strokeWidth={sw} />
          <ellipse cx="80" cy="58" rx="9" ry="20" fill={color} stroke={stroke} strokeWidth={sw} />
        </>
      );
    case 'bob':
      return (
        <path
          d="M 22 32 Q 22 16 50 16 Q 78 16 78 32 L 80 70 Q 80 76 74 76 L 26 76 Q 20 76 20 70 Z"
          fill={color}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
  }
}

/** Hair "front" — bangs/fringe drawn over the face. */
function HairFront({ style, color }: { style: HairStyle; color: string }) {
  switch (style) {
    case 'short':
      return (
        <path
          d="M 22 30 Q 32 18 52 22 Q 70 26 76 36 Q 64 32 50 36 Q 36 38 28 42 Z"
          fill={color}
        />
      );
    case 'medium':
      return (
        <path
          d="M 24 24 Q 36 14 50 18 Q 64 14 76 24 Q 70 38 58 36 Q 50 30 42 36 Q 30 38 24 24 Z"
          fill={color}
        />
      );
    case 'long':
      // Heavy straight bangs that frame the eyes — a wide rectangle with a
      // subtle peak in the middle so the silhouette doesn't read as a helmet.
      return (
        <path
          d="M 22 22 L 78 22 L 78 38 Q 70 36 60 40 Q 56 32 50 40 Q 44 32 40 40 Q 30 36 22 38 Z"
          fill={color}
        />
      );
    case 'ponytail':
      return (
        <path d="M 24 26 Q 38 18 56 24 Q 70 30 76 36 Q 60 30 46 38 Q 34 38 24 26 Z" fill={color} />
      );
    case 'twintails':
      return (
        <path
          d="M 26 24 Q 50 14 74 24 Q 70 36 58 38 Q 50 32 42 38 Q 30 36 26 24 Z"
          fill={color}
        />
      );
    case 'bob':
      // Blunt fringe straight across.
      return <rect x="22" y="22" width="56" height="14" fill={color} />;
  }
}

/**
 * Eyes + mouth + blush for the given emotion. Mirrors `NPC.repaintFace()` in
 * the in-world sprite but positioned for the 100×100 viewBox. Coordinates
 * picked so the features sit inside the head ellipse (cx=50, cy=48, rx=24,
 * ry=27) with hair-front overlapping the brow.
 */
function FaceFeatures({ emotion }: { emotion: Emotion }) {
  // Eye anchor positions inside the head ellipse.
  const eyeY = 50;
  const eyeLX = 40;
  const eyeRX = 60;
  const mouthY = 64;

  const eyeColor = OUTLINE;
  const mouthColor = '#5a2e2e';
  const blushColor = '#ff9aa2';

  switch (emotion) {
    case 'happy':
      return (
        <g>
          {/* Smiling crescent eyes (∪) */}
          <path
            d={`M ${eyeLX - 5} ${eyeY + 1} Q ${eyeLX} ${eyeY - 4} ${eyeLX + 5} ${eyeY + 1}`}
            fill="none"
            stroke={eyeColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d={`M ${eyeRX - 5} ${eyeY + 1} Q ${eyeRX} ${eyeY - 4} ${eyeRX + 5} ${eyeY + 1}`}
            fill="none"
            stroke={eyeColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Open smile */}
          <path
            d={`M ${50 - 6} ${mouthY} Q 50 ${mouthY + 5} ${50 + 6} ${mouthY}`}
            fill="none"
            stroke={mouthColor}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>
      );

    case 'sad':
      return (
        <g>
          <circle cx={eyeLX} cy={eyeY} r="2" fill={eyeColor} />
          <circle cx={eyeRX} cy={eyeY} r="2" fill={eyeColor} />
          {/* Small tear glint under right eye */}
          <path
            d={`M ${eyeRX + 2} ${eyeY + 4} q 1 4 -2 5`}
            fill="#9ec5ff"
            stroke="#4a8ad6"
            strokeWidth="0.6"
          />
          {/* Downturned mouth */}
          <path
            d={`M ${50 - 6} ${mouthY + 1} Q 50 ${mouthY - 4} ${50 + 6} ${mouthY + 1}`}
            fill="none"
            stroke={mouthColor}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>
      );

    case 'angry':
      return (
        <g>
          {/* Angled eyebrows */}
          <line
            x1={eyeLX - 6}
            y1={eyeY - 8}
            x2={eyeLX + 5}
            y2={eyeY - 5}
            stroke={eyeColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <line
            x1={eyeRX + 6}
            y1={eyeY - 8}
            x2={eyeRX - 5}
            y2={eyeY - 5}
            stroke={eyeColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx={eyeLX} cy={eyeY} r="2.2" fill={eyeColor} />
          <circle cx={eyeRX} cy={eyeY} r="2.2" fill={eyeColor} />
          {/* Tight mouth */}
          <line
            x1="44"
            y1={mouthY}
            x2="56"
            y2={mouthY}
            stroke={mouthColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      );

    case 'shy':
      return (
        <g>
          {/* Squinty closed eyes (small horizontal lines) */}
          <line
            x1={eyeLX - 4}
            y1={eyeY}
            x2={eyeLX + 4}
            y2={eyeY}
            stroke={eyeColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <line
            x1={eyeRX - 4}
            y1={eyeY}
            x2={eyeRX + 4}
            y2={eyeY}
            stroke={eyeColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="50" cy={mouthY} r="1.4" fill={mouthColor} />
          {/* Cheek blush */}
          <ellipse cx="32" cy="58" rx="5" ry="3" fill={blushColor} opacity="0.75" />
          <ellipse cx="68" cy="58" rx="5" ry="3" fill={blushColor} opacity="0.75" />
        </g>
      );

    case 'flirty':
      return (
        <g>
          {/* Half-closed lidded eyes (∩) */}
          <path
            d={`M ${eyeLX - 5} ${eyeY - 1} Q ${eyeLX} ${eyeY + 4} ${eyeLX + 5} ${eyeY - 1}`}
            fill="none"
            stroke={eyeColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d={`M ${eyeRX - 5} ${eyeY - 1} Q ${eyeRX} ${eyeY + 4} ${eyeRX + 5} ${eyeY - 1}`}
            fill="none"
            stroke={eyeColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Soft asymmetric smile */}
          <path
            d={`M 44 ${mouthY} Q 50 ${mouthY + 4} 56 ${mouthY - 1}`}
            fill="none"
            stroke={mouthColor}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <ellipse cx="32" cy="58" rx="5" ry="3" fill={blushColor} opacity="0.65" />
          <ellipse cx="68" cy="58" rx="5" ry="3" fill={blushColor} opacity="0.65" />
        </g>
      );

    case 'annoyed':
      return (
        <g>
          {/* Slightly downward eyebrows */}
          <line
            x1={eyeLX - 6}
            y1={eyeY - 7}
            x2={eyeLX + 5}
            y2={eyeY - 5}
            stroke={eyeColor}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <line
            x1={eyeRX + 6}
            y1={eyeY - 7}
            x2={eyeRX - 5}
            y2={eyeY - 5}
            stroke={eyeColor}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          {/* Lidded ∩ eyes */}
          <path
            d={`M ${eyeLX - 5} ${eyeY - 1} Q ${eyeLX} ${eyeY + 3} ${eyeLX + 5} ${eyeY - 1}`}
            fill="none"
            stroke={eyeColor}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d={`M ${eyeRX - 5} ${eyeY - 1} Q ${eyeRX} ${eyeY + 3} ${eyeRX + 5} ${eyeY - 1}`}
            fill="none"
            stroke={eyeColor}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          {/* Slanted flat mouth */}
          <line
            x1="44"
            y1={mouthY}
            x2="56"
            y2={mouthY + 1.5}
            stroke={mouthColor}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </g>
      );

    case 'neutral':
    default:
      return (
        <g>
          <circle cx={eyeLX} cy={eyeY} r="2" fill={eyeColor} />
          <circle cx={eyeRX} cy={eyeY} r="2" fill={eyeColor} />
          <line
            x1="46"
            y1={mouthY}
            x2="54"
            y2={mouthY}
            stroke={mouthColor}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
      );
  }
}

/** Render the optional accessory layer (currently glasses only). */
function Accessory({ kind }: { kind: NPCAppearance['accessory'] }) {
  if (kind !== 'glasses') return null;
  return (
    <g>
      <circle cx="40" cy="50" r="6" fill="none" stroke={OUTLINE} strokeWidth="1.5" />
      <circle cx="60" cy="50" r="6" fill="none" stroke={OUTLINE} strokeWidth="1.5" />
      <line x1="46" y1="50" x2="54" y2="50" stroke={OUTLINE} strokeWidth="1.2" />
    </g>
  );
}

/**
 * The actual portrait body. Memoised so swapping the affinity slider value
 * doesn't trigger an SVG re-render — only an emotion change does.
 */
function NpcPortraitInner({ npcId, emotion, size = 140, className = '' }: NpcPortraitProps) {
  // Memoise on (npcId) so we don't re-resolve the appearance on every parent
  // re-render. Cheap, but the lookup is in the dialog hot path.
  const appearance = useMemo<NPCAppearance>(
    () => getAppearance(npcId ?? '__unknown__'),
    [npcId],
  );

  const skin = hex(appearance.skinColor);
  const skinShadow = darken(appearance.skinColor, 0.18);
  const hair = hex(appearance.hairColor);
  const hairHighlight = lighten(appearance.hairColor, 0.18);
  const shirt = hex(appearance.shirtColor);
  const shirtShadow = darken(appearance.shirtColor, 0.22);

  // Background plate uses a soft warm gradient that nods to Orange Road
  // without overwhelming the sprite. id is randomised by npcId so multiple
  // portraits on the page don't share the same gradient definition (which
  // could leak hair color between them at the same time React swaps DOM).
  const gradId = `npc-portrait-bg-${npcId ?? 'unknown'}`;

  return (
    <svg
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      role="presentation"
      data-testid="npc-portrait"
      data-npc-id={npcId ?? 'unknown'}
      data-emotion={emotion}
    >
      <defs>
        <radialGradient id={gradId} cx="50%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#fff3e0" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#ffd9a8" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#7a4a1a" stopOpacity="0.35" />
        </radialGradient>
      </defs>

      {/* Plate / vignette */}
      <rect x="0" y="0" width={VB} height={VB} fill={`url(#${gradId})`} rx="8" ry="8" />

      {/* Shoulders / shirt slice — the bottom of the bust. Rounded square so
          it tucks under the rounded background plate cleanly. */}
      <path
        d="M 8 86 Q 8 76 22 74 L 78 74 Q 92 76 92 86 L 92 100 L 8 100 Z"
        fill={shirt}
        stroke={OUTLINE}
        strokeWidth="1"
      />
      {/* Subtle shirt fold shadow */}
      <path d="M 30 78 L 50 92 L 70 78 Z" fill={shirtShadow} opacity="0.55" />

      {/* Neck + jaw */}
      <rect x="44" y="68" width="12" height="10" fill={skin} stroke={OUTLINE} strokeWidth="1" />
      {/* Subtle neck shadow under jaw */}
      <path d="M 42 70 Q 50 76 58 70 L 58 74 Q 50 78 42 74 Z" fill={skinShadow} opacity="0.45" />

      {/* Hair back layer (drawn behind head) */}
      <HairBack style={appearance.hairStyle} color={hair} />

      {/* Head — slightly oval. */}
      <ellipse
        cx="50"
        cy="48"
        rx="24"
        ry="27"
        fill={skin}
        stroke={OUTLINE}
        strokeWidth="1.2"
      />

      {/* Soft cheek/jaw shading on the right side for depth */}
      <path
        d="M 50 70 Q 64 70 70 56 Q 72 64 66 72 Q 58 76 50 74 Z"
        fill={skinShadow}
        opacity="0.35"
      />

      {/* Face features (eyes / mouth / blush) */}
      <FaceFeatures emotion={emotion} />

      {/* Hair front (bangs) — drawn over the forehead so eyes peek through */}
      <HairFront style={appearance.hairStyle} color={hair} />
      {/* Tiny hair highlight stroke for shine */}
      <path
        d="M 32 26 Q 40 22 50 24"
        stroke={hairHighlight}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* Optional accessory (glasses) — drawn last so it sits on top. */}
      <Accessory kind={appearance.accessory} />
    </svg>
  );
}

/**
 * Public, memoised export. Re-renders only when (npcId, emotion, size,
 * className) change — so a sibling component bumping the affinity value
 * does not cause an SVG repaint.
 */
export const NpcPortrait = memo(NpcPortraitInner);
NpcPortrait.displayName = 'NpcPortrait';
