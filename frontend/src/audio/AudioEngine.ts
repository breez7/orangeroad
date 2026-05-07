/**
 * AudioEngine — Phase 5.2 (Issue #15 사운드/이펙트).
 *
 * Reference: requirements.md NFR-002 (web platform, RPi4 deploy), Quality
 * Standards (살아있는 NPC AI / 매끄러운 60fps), DESIGN.md UX layer.
 *
 * Why synthesis (no asset files)?
 * --------------------------------
 *   - We have NO licensed audio assets and won't bundle copyrighted music
 *     from the Orange Road IP. Shipping silence would fail the issue's
 *     "사운드 추가" criterion.
 *   - The Web Audio API can synthesise short SFX (oscillator + ADSR
 *     envelope) and a soft procedural ambient pad cheaply at runtime, with
 *     no asset bundle, no copyright concerns, and deterministic timing.
 *   - The whole engine is replaceable later: every public method takes a
 *     `kind` enum, so when sampled SFX land we just swap the synthesis
 *     implementation without touching call sites.
 *
 * Browser autoplay policy
 * -----------------------
 *   Browsers refuse to start an `AudioContext` until the user has
 *   interacted with the page (click/tap/key press). We expose `init()` and
 *   require it to be called from a user-gesture handler. App.tsx wires a
 *   one-time document `pointerdown` listener that calls `init()` then
 *   removes itself. After that, every subsequent SFX is fine.
 *
 * Volume defaults
 * ---------------
 *   Music: 0.30 (BGM should sit well under SFX so dialog reads clean)
 *   SFX:   0.60 (perceived equal-loudness with BGM at 0.30)
 *   These mirror typical JRPG mix levels.
 */

export type SfxKind =
  | 'click'
  | 'dialog-open'
  | 'dialog-send'
  | 'npc-reply'
  | 'affinity-up'
  | 'affinity-down'
  | 'story-step'
  | 'save';

export interface AudioEngineOptions {
  musicVolume?: number;
  sfxVolume?: number;
  muted?: boolean;
}

/** A note in C major used by the procedural ambient pad. Hz values rounded. */
const PAD_FREQS = [130.81, 196.0, 261.63, 329.63] as const; // C3, G3, C4, E4

export class AudioEngine {
  private ctx: AudioContext | null = null;

  /** Master gain feeds into ctx.destination. */
  private master: GainNode | null = null;
  /** Music bus (BGM only) → master. */
  private musicBus: GainNode | null = null;
  /** SFX bus → master. */
  private sfxBus: GainNode | null = null;

  /** Active BGM oscillators + their per-osc gains for fade-in/out. */
  private bgmNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  /** LFO that modulates BGM gain to give the pad a slow tremolo. */
  private bgmLfo: { osc: OscillatorNode; gain: GainNode } | null = null;
  /** Whether BGM has been requested by the caller (so volume changes can
   *  resume it after a mute toggle). */
  private bgmRequested = false;

  // Stored settings — applied to gain nodes when ctx is alive.
  private musicVolume: number;
  private sfxVolume: number;
  private muted: boolean;

  constructor(opts: AudioEngineOptions = {}) {
    this.musicVolume = clamp01(opts.musicVolume ?? 0.3);
    this.sfxVolume = clamp01(opts.sfxVolume ?? 0.6);
    this.muted = opts.muted ?? false;
  }

  /** True after init() has succeeded. */
  get ready(): boolean {
    return this.ctx !== null;
  }

  /**
   * Lazy-initialise the AudioContext. Safe to call multiple times — only the
   * first call creates the context. MUST be called from a user-gesture
   * handler (click/tap/keydown) per the autoplay policy.
   */
  init(): void {
    if (this.ctx) return;
    type WebkitWindow = typeof window & { webkitAudioContext?: typeof AudioContext };
    const w = window as WebkitWindow;
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      // No Web Audio support — silently no-op so the rest of the game
      // continues working. Older browsers / RPi headless sessions.
      console.warn('[AudioEngine] Web Audio API not available; running silent.');
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch (err) {
      console.warn('[AudioEngine] failed to construct AudioContext:', err);
      return;
    }

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 1;
    master.connect(ctx.destination);

    const musicBus = ctx.createGain();
    musicBus.gain.value = this.musicVolume;
    musicBus.connect(master);

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = this.sfxVolume;
    sfxBus.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;

    // Some browsers start the context in 'suspended' state even after a user
    // gesture — explicitly resume so the first SFX is audible.
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }

    // Phase 5.3 bug fix: if the caller requested BGM BEFORE the user gesture
    // (e.g. a save with bgmEnabled:true loads, then App's audio-sync effect
    // calls playBgm() while ctx is still null), `playBgm()` recorded the
    // intent in `bgmRequested` but couldn't start the oscillators. Now that
    // the context is alive, honour the deferred request so the user hears
    // BGM as soon as they grant the gesture instead of having to toggle the
    // checkbox off-and-on to nudge it.
    if (this.bgmRequested && this.bgmNodes.length === 0) {
      this.playBgm();
    }
  }

  /** Apply current music volume to the bus (no-op if context not ready). */
  setMusicVolume(v: number): void {
    this.musicVolume = clamp01(v);
    if (this.musicBus) {
      this.musicBus.gain.setTargetAtTime(this.musicVolume, this.now(), 0.01);
    }
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = clamp01(v);
    if (this.sfxBus) {
      this.sfxBus.gain.setTargetAtTime(this.sfxVolume, this.now(), 0.01);
    }
  }

  /** Mute mutes the master bus (still leaves BGM oscillators running so
   *  unmute is instant). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.now(), 0.01);
    }
  }

  /**
   * Play a one-shot SFX. Falls back to a no-op if ctx isn't initialised yet
   * (e.g. an SFX fires before any user gesture happened — rare, but safe).
   */
  playSfx(kind: SfxKind): void {
    if (!this.ctx || !this.sfxBus) return;
    if (this.muted) return;
    const ctx = this.ctx;
    const dest = this.sfxBus;
    const now = ctx.currentTime;
    switch (kind) {
      case 'click':
        playBlip(ctx, dest, now, { freq: 880, dur: 0.06, type: 'square', vol: 0.18 });
        break;
      case 'dialog-open':
        // Soft ascending two-note chime (fifth interval).
        playBlip(ctx, dest, now, { freq: 523.25, dur: 0.18, type: 'sine', vol: 0.22 });
        playBlip(ctx, dest, now + 0.06, { freq: 783.99, dur: 0.22, type: 'sine', vol: 0.18 });
        break;
      case 'dialog-send':
        playBlip(ctx, dest, now, { freq: 660, dur: 0.08, type: 'triangle', vol: 0.18 });
        break;
      case 'npc-reply':
        // Two-note ping (perfect fourth) — distinct from dialog-send.
        playBlip(ctx, dest, now, { freq: 587.33, dur: 0.12, type: 'sine', vol: 0.2 });
        playBlip(ctx, dest, now + 0.08, { freq: 783.99, dur: 0.16, type: 'sine', vol: 0.16 });
        break;
      case 'affinity-up':
        // Bright ascending arpeggio: C5 - E5 - G5.
        playBlip(ctx, dest, now, { freq: 523.25, dur: 0.12, type: 'triangle', vol: 0.22 });
        playBlip(ctx, dest, now + 0.08, { freq: 659.25, dur: 0.12, type: 'triangle', vol: 0.22 });
        playBlip(ctx, dest, now + 0.16, { freq: 783.99, dur: 0.18, type: 'triangle', vol: 0.22 });
        break;
      case 'affinity-down':
        // Descending minor third — soft, mournful.
        playBlip(ctx, dest, now, { freq: 392.0, dur: 0.18, type: 'sine', vol: 0.2 });
        playBlip(ctx, dest, now + 0.12, { freq: 311.13, dur: 0.28, type: 'sine', vol: 0.18 });
        break;
      case 'story-step':
        // Whoosh — short noise burst with a low-pass sweep.
        playWhoosh(ctx, dest, now);
        break;
      case 'save':
        // Confirmation blip — bright ascending pair.
        playBlip(ctx, dest, now, { freq: 740, dur: 0.1, type: 'sine', vol: 0.22 });
        playBlip(ctx, dest, now + 0.07, { freq: 988, dur: 0.14, type: 'sine', vol: 0.2 });
        break;
    }
  }

  /**
   * Start the procedural ambient pad. Idempotent — calling twice while BGM
   * is active is a no-op. Safe to call before init() (just records the
   * intent; the pad will start when init() completes if BGM is still
   * requested at that point). For Phase 5.2 we don't auto-start; App.tsx
   * decides when to call this.
   */
  playBgm(): void {
    this.bgmRequested = true;
    if (!this.ctx || !this.musicBus) return;
    if (this.bgmNodes.length > 0) return;
    const ctx = this.ctx;
    const dest = this.musicBus;

    // Slow tremolo via an LFO modulating a "pad gain" node that all the
    // partials feed into. This gives the static pad some movement without
    // copying any specific melody.
    const padGain = ctx.createGain();
    padGain.gain.value = 0;
    padGain.connect(dest);

    // Fade in over 1.5s.
    const targetGain = 0.55; // perceptual headroom under the music bus volume.
    padGain.gain.setValueAtTime(0, ctx.currentTime);
    padGain.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + 1.5);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.18; // very slow drift (~5.5s period)
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.12; // tremolo depth
    lfo.connect(lfoGain);
    lfoGain.connect(padGain.gain);
    lfo.start();
    this.bgmLfo = { osc: lfo, gain: lfoGain };

    // Build the pad partials — sine oscillators tuned to a C major triad
    // plus an octave below for a soft bed. Detuned slightly so the pad
    // beats gently rather than sounding sterile.
    for (let i = 0; i < PAD_FREQS.length; i++) {
      const freq = PAD_FREQS[i]!;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = (i - 1.5) * 4; // cents
      const g = ctx.createGain();
      // Top notes a bit quieter than the bass for a balanced pad.
      g.gain.value = 1 / (i + 2);
      osc.connect(g);
      g.connect(padGain);
      osc.start();
      this.bgmNodes.push({ osc, gain: g });
    }
  }

  /**
   * Stop the BGM with a 1s linear fade-out, then disconnect oscillators.
   * Safe to call when BGM isn't playing.
   */
  stopBgm(): void {
    this.bgmRequested = false;
    if (!this.ctx || this.bgmNodes.length === 0) return;
    const ctx = this.ctx;
    const stopAt = ctx.currentTime + 1.0;
    for (const node of this.bgmNodes) {
      // Schedule a linear fade to 0 then stop the oscillator just after.
      try {
        node.gain.gain.setValueAtTime(node.gain.gain.value, ctx.currentTime);
        node.gain.gain.linearRampToValueAtTime(0.0001, stopAt);
        node.osc.stop(stopAt + 0.05);
      } catch {
        // Oscillator already stopped — ignore.
      }
    }
    if (this.bgmLfo) {
      try {
        this.bgmLfo.osc.stop(stopAt + 0.05);
      } catch {
        // ignore
      }
    }
    // Clear the local refs immediately; the audio nodes finish naturally.
    this.bgmNodes = [];
    this.bgmLfo = null;
  }

  /** True if BGM is currently scheduled to play. */
  get isBgmPlaying(): boolean {
    return this.bgmNodes.length > 0;
  }

  /** Whether the caller has requested BGM (vs. actually playing). */
  get isBgmRequested(): boolean {
    return this.bgmRequested;
  }

  /** Tear down the AudioContext. After destroy() the engine is unusable. */
  destroy(): void {
    this.stopBgm();
    if (this.ctx) {
      try {
        void this.ctx.close().catch(() => undefined);
      } catch {
        // ignore
      }
    }
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
  }

  // --- internals ----------------------------------------------------------

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }
}

// --- one-shot synthesis helpers ------------------------------------------

interface BlipOpts {
  freq: number;
  dur: number;
  type: OscillatorType;
  vol: number;
}

/**
 * Single oscillator with an exponential-attack / linear-decay envelope.
 * Self-disconnects when the envelope finishes so we don't leak nodes.
 */
function playBlip(
  ctx: AudioContext,
  dest: AudioNode,
  startAt: number,
  { freq, dur, type, vol }: BlipOpts,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  // Quick attack (5ms) → decay to silence over `dur`.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(vol, startAt + 0.005);
  gain.gain.linearRampToValueAtTime(0.0001, startAt + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
  osc.onended = () => {
    try {
      gain.disconnect();
      osc.disconnect();
    } catch {
      // ignore
    }
  };
}

/**
 * Whoosh — short white-noise burst through a downward-sweeping low-pass
 * filter. Used for `story-step` so page transitions feel tactile.
 */
function playWhoosh(ctx: AudioContext, dest: AudioNode, startAt: number): void {
  const dur = 0.35;
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, startAt);
  filter.frequency.linearRampToValueAtTime(400, startAt + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(0.18, startAt + 0.04);
  gain.gain.linearRampToValueAtTime(0.0001, startAt + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(startAt);
  src.stop(startAt + dur + 0.02);
  src.onended = () => {
    try {
      gain.disconnect();
      filter.disconnect();
      src.disconnect();
    } catch {
      // ignore
    }
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
