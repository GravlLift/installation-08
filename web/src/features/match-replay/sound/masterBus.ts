// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * masterBus.ts — THE GAME'S MASTER COMPRESSOR, in front of the volume control.
 *
 * Read from the install (2026-11-19, `docs/design/zone-reverb.md`, "Mix buses"): both of the
 * game's master audio buses (`44148a3c`, the world, third-person weapons and foley; `624ab2d3`,
 * the player's own first-person sounds and more) carry the same effect share set `480f6a5a`, a
 * Wwise Compressor (plugin `0x006C0003`): threshold -17 dB, ratio 7:1, attack 0 s, release 0.5 s,
 * output level +0.5 dB. The values are read; the plugin's identity is inferred from its parameter
 * block, 22 bytes, the exact size of the compressor's (five floats and two flags).
 *
 * It evens the mix: a near shot over the threshold is pulled down 6 dB in 7, a far one under it
 * passes whole, so the distant fire keeps its body against the loud close sounds. Without it the
 * viewer played the raw levels (Jordan, 0.1.1-test.7: "other players' bandits still sound kinda
 * weak").
 *
 * LEVEL CALIBRATION. The threshold acts on the game's level at the master. The gains the viewer
 * plays leave out the bus chain the game routes the sound through, which is -5 dB for nearly every
 * sound (master -2, category bus -3; 18,689 of the sounds sit on one such chain, and the large
 * shot, foley and first-person buses all sum to -5): the viewer's mix sits 5 dB above the game's,
 * so the threshold moves up by the same 5 dB.
 *
 * One compressor on the viewer's single master stands in for the game's two, one per master bus
 * (inferred close: the own shot and the world then compress together, where the game keeps them
 * apart).
 *
 * CHROMIUM'S MAKE-UP GAIN. The Web Audio compressor of Chromium (and so of WebView2) raises its
 * output by a fixed make-up gain the specification derives from the curve: (1 / gain at full
 * scale) ^ 0.6. Wwise adds none beyond its output level, so the trim after the compressor takes
 * that make-up back out.
 */

/** The game's master compressor (`480f6a5a`), as read. */
export const GAME_MASTER_COMPRESSOR = {
  thresholdDb: -17,
  ratio: 7,
  attackS: 0,
  releaseS: 0.5,
  outputDb: 0.5,
} as const

/** The bus chain the viewer's gains leave out, nearly every sound's (see the header). */
export const GAME_BUS_CHAIN_DB = -5

/** The threshold in the viewer's level domain. */
export const MASTER_THRESHOLD_DB = GAME_MASTER_COMPRESSOR.thresholdDb - GAME_BUS_CHAIN_DB

/**
 * chromiumMakeupDb is the make-up gain Chromium's compressor applies for a hard-knee curve of this
 * threshold and ratio: 0.6 x the reduction at full scale (0 dBFS in), in dB.
 */
export function chromiumMakeupDb(thresholdDb: number, ratio: number): number {
  const reductionAtFullScale = -thresholdDb * (1 - 1 / ratio)
  return 0.6 * reductionAtFullScale
}

/** The trim after the compressor: Wwise's output level, without Chromium's make-up. */
export const MASTER_TRIM_DB = GAME_MASTER_COMPRESSOR.outputDb - chromiumMakeupDb(MASTER_THRESHOLD_DB, GAME_MASTER_COMPRESSOR.ratio)

/**
 * masterCompressor wires the game's master compressor into `ctx` and returns its input and its
 * output: input -> compressor -> trim -> output. A context without a compressor (a test double)
 * gets one gain node as both, the mix passing unprocessed.
 */
export function masterCompressor(ctx: BaseAudioContext): { input: AudioNode; output: AudioNode } {
  const trim = ctx.createGain()
  if (typeof (ctx as Partial<BaseAudioContext>).createDynamicsCompressor !== 'function') return { input: trim, output: trim }
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = MASTER_THRESHOLD_DB
  comp.knee.value = 0
  comp.ratio.value = GAME_MASTER_COMPRESSOR.ratio
  comp.attack.value = GAME_MASTER_COMPRESSOR.attackS
  comp.release.value = GAME_MASTER_COMPRESSOR.releaseS
  trim.gain.value = 10 ** (MASTER_TRIM_DB / 20)
  comp.connect(trim)
  return { input: comp, output: trim }
}
