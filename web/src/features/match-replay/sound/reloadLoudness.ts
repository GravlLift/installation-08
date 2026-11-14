/**
 * reloadLoudness.ts — ONE LEVEL RULE FOR EVERY WEAPON'S RELOAD.
 *
 * The reload takes come from the user's game install (`build-sounds`, `internal/reloadsounds`),
 * and their files do not carry the game's mix: measured on the 183 takes of the installed game
 * (ffmpeg volumedetect, 2026-11-14), most peak at 0 dBFS whatever the gesture, while the
 * loudest moment of a reload goes from -13.3 dBFS RMS (SPNKr) to -21.7 (Sidekick), and the
 * one-step shell loads sit far lower (Heatwave -27.4, Cindershot -29.7). The game sets the
 * real level in its Wwise hierarchy, which the extraction does not read. Played as files, one
 * weapon's reload would sound 16 dB louder than another's.
 *
 * THE RULE: one gain per reload animation (weapon and stance), never per take, so the reload
 * keeps its own shape (a soft cloth rustle stays under the magazine's click). The gain brings
 * the reload's LOUDEST SOUND to `RELOAD_LEVEL_TARGET_DB`, measured as the power mean of its
 * takes' RMS (the level a draw lands on, on average), and leaves no take's peak above
 * `RELOAD_PEAK_CEILING_DB`. The levels are measured on the decoded takes at load
 * (`useReloadTrack.ts`): the build repacks Vorbis without decoding, so it cannot measure them.
 */

/** A take's measured level: RMS over all its samples and peak, both in dBFS. */
export interface TakeLevel {
  rmsDb: number
  peakDb: number
}

/**
 * The level a reload's loudest sound is brought to, in dBFS RMS: about 6 dB under the median
 * RMS of the 26 bundled weapon files (-18.3 dBFS, the same measurement). A reload is the
 * quieter gesture of a weapon, under its shots.
 */
export const RELOAD_LEVEL_TARGET_DB = -24

/** No take of a reload is left above this peak, in dBFS, whatever the target asks. */
export const RELOAD_PEAK_CEILING_DB = -1

/** The floor of a measured level: digital silence measures -Infinity, which no gain can use. */
const SILENCE_DB = -120

/** levelOf measures decoded samples (one array per channel). */
export function levelOf(channels: readonly Float32Array[]): TakeLevel {
  let sum = 0
  let count = 0
  let peak = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i]
      sum += v * v
      const a = Math.abs(v)
      if (a > peak) peak = a
    }
    count += ch.length
  }
  return { rmsDb: toDb(count > 0 ? Math.sqrt(sum / count) : 0), peakDb: toDb(peak) }
}

function toDb(amplitude: number): number {
  return amplitude > 0 ? Math.max(20 * Math.log10(amplitude), SILENCE_DB) : SILENCE_DB
}

/** soundLevelDb is the power mean of a sound's takes' RMS: the level one draw lands on, on average. */
export function soundLevelDb(takes: readonly TakeLevel[]): number {
  if (takes.length === 0) return SILENCE_DB
  const power = takes.reduce((s, t) => s + Math.pow(10, t.rmsDb / 10), 0) / takes.length
  return toDb(Math.sqrt(power))
}

/**
 * reloadGainDb is the gain of one reload animation, from the measured takes of each of its
 * sounds. A reload with nothing measured keeps its files' level (0 dB).
 */
export function reloadGainDb(sounds: readonly (readonly TakeLevel[])[]): number {
  const measured = sounds.filter((s) => s.length > 0)
  if (measured.length === 0) return 0
  const loudest = Math.max(...measured.map(soundLevelDb))
  const peak = Math.max(...measured.flatMap((s) => s.map((t) => t.peakDb)))
  return Math.min(RELOAD_LEVEL_TARGET_DB - loudest, RELOAD_PEAK_CEILING_DB - peak)
}
