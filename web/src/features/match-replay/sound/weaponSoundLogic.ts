// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * weaponSoundLogic.ts — THE COMPUTATION OF THE WEAPON SOUNDS OF THE REPLAY, WITHOUT WEBAUDIO.
 *
 * The `.wav` extracted from the game are PURE: a file, always the same. Two effects that the
 * game engine applies at each shot are therefore replayed here, on the app side:
 *
 * - VARIATION: the game moves volume and pitch at each reading, in a range
 *   declared by the bank (RANGED package, exported by `cmd/weapon-sounds`). Without it, a
 *   burst is the same sample repeated identically, which is immediately heard.
 * - DISTANCE: a distant shot is quieter AND duller. Two settings, not one.
 *
 * Everything that is computable without a browser lives here, in tested pure functions: the
 * drawing, the conversion of the units and the mapping of the distance cursor. The WebAudio
 * playback (replayAudio.ts) only assembles nodes from these values; the ranges
 * per weapon live in `weaponSoundVariations.ts` (generated with the sounds, same delivery).
 *
 * UNITS. The ranges of the manifest are OFFSETS around the nominal value of
 * the file: decibels for the volume, hundredths of a semitone for the pitch. A gain in dB
 * becomes a linear factor by 10^(dB/20); hundredths become a `playbackRate`
 * by 2^(cents/1200) — the accelerated reading raises the pitch, it is the same effect as a
 * pitch shift on a sample, and that is what the engine does.
 */

/** A range of the manifest: signed offsets, `bas <= haut`. */
export interface SoundRange {
  bas: number
  haut: number
}

/** What the game varies at each reading. The two fields are optional. */
export interface SoundVariation {
  volume_db?: SoundRange
  pitch_cents?: SoundRange
}

/** What a reading applies to the pure file. Neutral = `{ gainDb: 0, playbackRate: 1 }`. */
export interface SoundDraw {
  gainDb: number
  playbackRate: number
}

/**
 * Distance chain. `null` = ABSOLUTE NEUTRAL: the player must then insert NO node
 * in the signal path, not even a gain at 1 (requirement of the plan — a "neutral" filter
 * is still a filter, and its response is never perfectly flat).
 */
export interface DistanceChain {
  gainDb: number
  cutoffHz: number
}

/** Attenuation at 100% of distance. A shot at the other end of the map stays audible. */
const DISTANCE_MAX_ATTENUATION_DB = -24
/** Cut of the low-pass at 100%. Below, the shot becomes an unidentifiable dull noise. */
const DISTANCE_MIN_CUTOFF_HZ = 500
/** Cut at zero distance: above the audible band, therefore without effect. */
const DISTANCE_MAX_CUTOFF_HZ = 20_000

/** Bounds of the `playbackRate` accepted by WebAudio in practice (± 2 octaves suffice). */
const MIN_PLAYBACK_RATE = 0.25
const MAX_PLAYBACK_RATE = 4

/** clampPercent brings a 0-100 setting back within its bounds, 0 for an unreadable value. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 100) return 100
  return value
}

/**
 * normalizeRange returns an usable range, or `null`.
 *
 * A non-finite bound, or the two at zero, means absence: the sound plays pure. The bounds
 * are reordered — the manifest delivers them already sorted, but a file edited by hand must
 * not produce an empty drawing.
 */
export function normalizeRange(range: SoundRange | undefined | null): SoundRange | null {
  if (!range) return null
  const { bas, haut } = range
  if (!Number.isFinite(bas) || !Number.isFinite(haut)) return null
  if (bas === 0 && haut === 0) return null
  return bas <= haut ? { bas, haut } : { bas: haut, haut: bas }
}

/**
 * drawRange draws uniformly in the range reduced by `ratio` (0..1).
 *
 * The setting is not a switch: at 50%, the game varies half as much. The ratio
 * is therefore applied to the BOUNDS, not to the result — otherwise a low setting would always
 * shift in the same direction.
 */
export function drawRange(range: SoundRange | null, ratio: number, random: () => number): number {
  if (!range || ratio <= 0) return 0
  const bas = range.bas * ratio
  const haut = range.haut * ratio
  return bas + (haut - bas) * random()
}

/**
 * drawVariation returns the gain and the playback rate of ONE reading.
 *
 * Without a range (manifest absent, weapon not covered, setting at 0), it returns the exact neutral:
 * no error, no silence — the sound plays as is.
 */
export function drawVariation(
  variation: SoundVariation | undefined | null,
  variationPercent: number,
  random: () => number = Math.random,
): SoundDraw {
  const ratio = clampPercent(variationPercent) / 100
  if (!variation || ratio <= 0) return { gainDb: 0, playbackRate: 1 }
  const gainDb = drawRange(normalizeRange(variation.volume_db), ratio, random)
  const cents = drawRange(normalizeRange(variation.pitch_cents), ratio, random)
  return { gainDb, playbackRate: playbackRateFromCents(cents) }
}

/** withEventGain adds an event's own level gain (`ReplaySoundEvent.gainDb`) to a playback's draw. */
export function withEventGain(draw: SoundDraw, event: { gainDb?: number }): SoundDraw {
  return event.gainDb ? { ...draw, gainDb: draw.gainDb + event.gainDb } : draw
}

/** gainFromDb converts decibels to a linear factor (that of a GainNode). */
export function gainFromDb(db: number): number {
  if (!Number.isFinite(db)) return 1
  return Math.pow(10, db / 20)
}

/**
 * playbackRateFromCents converts hundredths of a semitone to a playback rate.
 * Bounded: an aberrant range must not render an inaudible or infinite sound.
 */
export function playbackRateFromCents(cents: number): number {
  if (!Number.isFinite(cents) || cents === 0) return 1
  const rate = Math.pow(2, cents / 1200)
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate))
}

/**
 * distanceChain returns the attenuation and the low-pass cut for a 0-100 setting.
 *
 * At 0: `null`, and the player plugs the source DIRECTLY on the output. The gain decays
 * linearly in decibels (the ear hears dB, not factors) and the cut
 * decays GEOMETRICALLY (an octave is a ratio, not a difference): without that, the
 * first half of the cursor would barely be heard and the second all at once.
 */
export function distanceChain(distancePercent: number): DistanceChain | null {
  const d = clampPercent(distancePercent) / 100
  if (d <= 0) return null
  const rapport = DISTANCE_MIN_CUTOFF_HZ / DISTANCE_MAX_CUTOFF_HZ
  return {
    gainDb: DISTANCE_MAX_ATTENUATION_DB * d,
    cutoffHz: DISTANCE_MAX_CUTOFF_HZ * Math.pow(rapport, d),
  }
}
