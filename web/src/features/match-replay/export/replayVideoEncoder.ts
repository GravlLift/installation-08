// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayVideoEncoder.ts — THE EXPORT'S VIDEO ENCODING, and nothing else.
 *
 * # WHY NOT `MediaRecorder`, WHICH ALREADY EXISTS IN THIS FOLDER
 *
 * `replayRecording.ts` films the canvas WHILE it plays: it is a screen recorder, and it
 * timestamps on the wall clock. It cannot therefore be fed faster than real time — pushing
 * thirty frames in one second would produce one second of video, not one second of match.
 * That is exactly what the export refuses: it RECOMPUTES the film frame by frame, as fast as
 * the machine keeps up, and the clip's duration must stay the MATCH's.
 *
 * WebCodecs is the only path where the timestamp is a PARAMETER and not a consequence. Each
 * `VideoFrame` carries its own instant (in microseconds of match); the muxer puts them back
 * in the file's order. Compute time enters the result nowhere.
 *
 * # WHY `mediabunny` AND NOT `mp4-muxer` ANY LONGER (2026-08-28)
 *
 * Both come from the same author, and the second is the successor of the first. The switch is
 * not a preference: `mp4-muxer` declares `audio?:` IN THE SINGULAR — one video track, one
 * audio track, no more. The user wants their sound effects, voices, and music SEPARATE for
 * re-editing; `mediabunny` accepts an unlimited number of audio tracks in MP4 (verified:
 * `Mp4OutputFormat.getSupportedTrackCounts()` returns `audio.max = 2^32-1`).
 *
 * WHAT DID NOT CHANGE, AND THAT IS DELIBERATE: VIDEO encoding stays ours — `VideoEncoder`, our
 * config, our backpressure, our timestamps. `mediabunny` can encode by itself, but all of this
 * is already measured and tested, and a rewrite would have put back in play the one part of
 * the project verified end to end in a browser. Only the MUXING layer changes, through
 * `EncodedVideoPacketSource`, which takes our packets as is.
 *
 * AUDIO, however, goes through `AudioBufferSource`: a rendered buffer is handed over, the
 * library encodes it. That is what removes our own `encodeAudioInto` and, with it, the whole
 * family of pitfalls it carried (AAC configuration refused asynchronously, `flush()` on a
 * closed encoder, a track declared but empty).
 *
 * # WHAT THIS MODULE DOES NOT DO
 *
 * It draws nothing, knows neither the replay's document nor React, and writes no file: it
 * returns a `Blob`. The loop that sets the frames lives in `useReplayExport.ts`, the sound
 * track in `replayAudioMix.ts`, the download in `replayCapture.ts`. Here, only: which codec,
 * at what rate, and how the encoder is kept from drowning.
 *
 * # THE THREE DECISIONS THAT ARE NOT ARBITRARY
 *
 * 1. DIMENSIONS ARE EVEN. H.264 samples chrominance at 4:2:0, meaning half a pixel on each
 *    axis: an odd width has no representation, and the encoder refuses it. Since 2026-09-16
 *    the export only requests even formats (`exportFormats.ts`); the rounding stays the
 *    safeguard for any caller that would pass a raw canvas size. Rounding is DOWNWARD —
 *    trimming a column of pixels is invisible, stretching it is not.
 * 2. THE H.264 LEVEL IS COMPUTED, it is not picked by eye. A level declared too low produces
 *    a file strict players refuse; too high, it shuts the door on older players for nothing
 *    gained. `avcLevelFor` takes the LOWEST level that accepts both the requested surface AND
 *    rate.
 * 3. BACKPRESSURE IS NOT AN OPTIMIZATION. `encoder.encode()` never blocks: on a ten-minute
 *    match, a loop that does not watch `encodeQueueSize` stacks eighteen thousand frames in
 *    the queue before the encoder has produced half of them, and the tab dies. The loop waits
 *    for the queue to drain (see `shouldDrain`).
 */
import {
  AudioBufferSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
} from 'mediabunny'
import type { StreamTargetChunk } from 'mediabunny'

import { repairAvcDescription } from './avcDescription'
import { ExportFileTarget } from './replayExportFileTarget'
import { yieldToEvents } from './eventLoopYield'

/**
 * The codec-specific sub-objects WebCodecs accepts on `VideoEncoderConfig` and
 * `VideoEncoderEncodeOptions`. `lib.dom` types only `avc`; `hevc` and `av1` are real WebCodecs
 * fields (each carries a `quantizer` in the encode options) that the lib does not follow yet.
 * We extend the DOM types here to build well-typed configs for those codecs, without forcing
 * them into the module's public API.
 */
interface ExportCodecFields {
  hevc?: { quantizer?: number | null }
  av1?: { quantizer?: number | null }
}

/** `VideoEncoderConfig` + the `hevc`/`av1` fields lib.dom does not type. */
type ExportVideoEncoderConfig = VideoEncoderConfig & ExportCodecFields
/** `VideoEncoderEncodeOptions` + the `hevc`/`av1` fields lib.dom does not type. */
type ExportVideoEncoderEncodeOptions = VideoEncoderEncodeOptions & ExportCodecFields

/**
 * THE EXPORT'S RATE, in frames per second.
 *
 * DELIBERATELY DISTINCT from `CAPTURE_FPS` (`replayRecording.ts`), which has the same value
 * for a different reason: there it is a RATE REQUESTED of a canvas stream, served best-effort
 * by the browser; here it is the very definition of the file's time axis — one frame every
 * 1/30 of a second of MATCH, no more, no less. Merging them would suggest that a setting on
 * one applies to the other.
 *
 * This is the 2D MAP export's rate: points sliding on a map gain nothing visible past 30, and
 * doubling the rate would double the file weight and the compute time. The 3D export has its
 * own rate (`EXPORT_FPS_3D`).
 */
export const EXPORT_FPS = 30

/**
 * THE 3D EXPORT'S RATE: 60 frames per second of MATCH, guaranteed by construction. The export is
 * offline: each frame is posed at an exact 1/60 s step of match time, rendered to completion,
 * and stamped `index / 60` s, so the rate never depends on how fast the machine renders.
 *
 * 60 and not 30 because the 3D view is a first/third-person camera on players whose motion is
 * recorded at ~60 Hz (`tr.fullRate`, `fineTracks3d`); at 30 a camera pan judders, and the clips
 * are cut into videos played at 60. The film's own frame grid (~30 Hz) is not a ceiling: the
 * scene poses fractional frames and interpolates, as on screen at the monitor's refresh rate.
 *
 * If the browser cannot encode 60 at the chosen size, the export falls back to `EXPORT_FPS` and
 * SAYS so (`VideoExportSink.fpsFallback`): never a silent 30.
 */
export const EXPORT_FPS_3D = 60

/**
 * One keyframe every 2 seconds of match. That is what makes the clip SEEKABLE: without a
 * regular keyframe, dragging the scrubber in the file forces the player to replay everything
 * from the start. Tighter would bloat the file without helping anyone.
 */
export const KEYFRAME_SECONDS = 2

/** The keyframe interval at the 2D rate, in frames (kept for the 2D callers and tests). */
export const KEYFRAME_EVERY = EXPORT_FPS * KEYFRAME_SECONDS

/**
 * Queue depth beyond which the loop waits. Two frames of margin: enough that the encoder
 * never idles between two draws, little enough that the memory held stays that of a few
 * frames, not that of a whole match.
 */
export const ENCODE_QUEUE_MAX = 2

/**
 * THE QUANTIZER FOR CONSTANT-QUALITY ENCODING (`bitrateMode: 'quantizer'`), in H.264 QP
 * (0-51, lower is better). The browser's own rate control starves frames under a hard target:
 * a 1080p60 export asked for 31 Mb/s averaged 10.1 Mb/s, and its keyframes ranged from 12.7 KB
 * to 230 KB — a 12.7 KB 1080p keyframe is a screen of 16x16 blocks, and the user sees them
 * whenever another player moves or shoots. A fixed QP trades the opposite way: every frame
 * gets the quality asked for, and the rate floats. QP 20 is the classic "visually clean" point
 * for hardware H.264: at 1080p60 it lands near the 31 Mb/s the old target aimed at, and a
 * still frame stays small instead of burning its quota. Keyframes and other frames take the
 * SAME QP: a keyframe at QP 14 next to 20 P-frames made the step between them visible.
 */
export const EXPORT_QP = 20

/**
 * Bits per pixel per frame. At 0.1 a moving 3D camera smeared every textured wall into blocks
 * (1080p60 got 12.4 Mb/s): a still frame costs nothing, but a pan changes every pixel of stone
 * and foliage, and the browser's hardware H.264 needs more bits than x264 for the same picture.
 * 0.25 gives 1080p60 31 Mb/s, inside High 4.2's 62.5 Mb/s ceiling.
 */
const BITS_PER_PIXEL = 0.25
/** Floor and ceiling bitrate, in bits per second: below 2 Mb/s the HUD text smears. */
const BITRATE_MIN = 2_000_000
const BITRATE_MAX = 80_000_000

/**
 * The H.264 levels, lowest to highest, with what each accepts: `maxFS` in macroblocks per
 * frame, `maxMBps` in macroblocks per second (Table A-1 of the standard, the only levels a
 * replay export can reach). `hex` is the codec name's byte.
 */
const AVC_LEVELS: readonly { hex: string; maxFS: number; maxMBps: number }[] = [
  { hex: '1e', maxFS: 1620, maxMBps: 40_500 }, // 3.0
  { hex: '1f', maxFS: 3600, maxMBps: 108_000 }, // 3.1
  { hex: '20', maxFS: 5120, maxMBps: 216_000 }, // 3.2
  { hex: '28', maxFS: 8192, maxMBps: 245_760 }, // 4.0
  { hex: '2a', maxFS: 8704, maxMBps: 522_240 }, // 4.2
  { hex: '32', maxFS: 22_080, maxMBps: 589_824 }, // 5.0
  { hex: '33', maxFS: 36_864, maxMBps: 983_040 }, // 5.1
  { hex: '34', maxFS: 36_864, maxMBps: 2_073_600 }, // 5.2
  { hex: '3c', maxFS: 139_264, maxMBps: 4_177_920 }, // 6.0
]

/** HIGH profile (`6400`): the profile every hardware decoder of this decade handles. */
const AVC_PROFILE = 'avc1.6400'

/**
 * evenSize rounds DOWN to an even number, floored at 2 (see decision 1 of the header). A
 * zero or negative dimension makes no sense for an encoder: it is bumped up to 2, and the
 * caller that passed that has a different problem than rounding.
 */
export function evenSize(n: number): number {
  const floored = Math.floor(n)
  if (!Number.isFinite(floored) || floored < 2) return 2
  return floored - (floored % 2)
}

/** Surface in 16x16 macroblocks: the unit the H.264 standard counts everything in. */
function frameMacroblocks(width: number, height: number): number {
  return Math.ceil(width / 16) * Math.ceil(height / 16)
}

/**
 * avcLevelFor returns the full codec name for this picture and rate: the LOWEST level that
 * accepts the surface and the macroblock rate (see decision 2 of the header).
 *
 * Beyond the table's highest level (an oversized canvas), the last one is returned anyway: a
 * file at an under-declared level stays playable wherever the decoder does not check, where
 * refusing the export would serve no one. The case does not occur below 8K.
 */
export function avcLevelFor(width: number, height: number, fps: number): string {
  const fs = frameMacroblocks(width, height)
  const mbps = fs * fps
  const level = AVC_LEVELS.find((l) => fs <= l.maxFS && mbps <= l.maxMBps)
  return `${AVC_PROFILE}${level?.hex ?? AVC_LEVELS[AVC_LEVELS.length - 1].hex}`
}

/**
 * The HEVC levels, lowest to highest, with what each accepts: `maxLuma` in luma samples per
 * picture and `maxLumaRate` in samples per second (H.265 spec, Annex A, general tier and level
 * limits). `code` is the `L<level>` suffix of the codec name, and the level code IS the level
 * times 30: 4 = L120, 4.1 = L123, 5 = L150.
 */
const HEVC_LEVELS: readonly { code: string; maxLuma: number; maxLumaRate: number }[] = [
  { code: 'L30', maxLuma: 36_864, maxLumaRate: 552_960 }, // 1
  { code: 'L60', maxLuma: 122_880, maxLumaRate: 3_686_400 }, // 2
  { code: 'L63', maxLuma: 245_760, maxLumaRate: 7_372_800 }, // 2.1
  { code: 'L90', maxLuma: 552_960, maxLumaRate: 16_588_800 }, // 3
  { code: 'L93', maxLuma: 983_040, maxLumaRate: 33_177_600 }, // 3.1
  { code: 'L120', maxLuma: 2_228_224, maxLumaRate: 66_846_720 }, // 4
  { code: 'L123', maxLuma: 2_228_224, maxLumaRate: 133_693_440 }, // 4.1
  { code: 'L150', maxLuma: 8_912_896, maxLumaRate: 267_386_880 }, // 5
  { code: 'L153', maxLuma: 8_912_896, maxLumaRate: 534_773_760 }, // 5.1
  { code: 'L156', maxLuma: 8_912_896, maxLumaRate: 1_069_547_520 }, // 5.2
  { code: 'L180', maxLuma: 35_651_584, maxLumaRate: 1_069_547_520 }, // 6
  { code: 'L183', maxLuma: 35_651_584, maxLumaRate: 2_139_095_040 }, // 6.1
  { code: 'L186', maxLuma: 35_651_584, maxLumaRate: 4_278_190_080 }, // 6.2
]

/** Profile MAIN (`1`), generic profile type (`6`): what every decoder handles. */
const HEVC_PROFILE = 'hvc1.1.6'

/**
 * hevcLevelFor returns the HEVC codec name for this picture and rate: the LOWEST level that
 * accepts the surface and the sample rate, as `hvc1.1.6.L<level>.B0` (`B0` is the absent High
 * Tier, i.e. Main Tier). The surface counts the FULL picture's luma samples (`width * height`),
 * and the rate in samples per second (`width * height * fps`). Like `avcLevelFor`, beyond the
 * highest level it returns the last one rather than refusing the export.
 */
export function hevcLevelFor(width: number, height: number, fps: number): string {
  const luma = width * height
  const rate = luma * fps
  const level = HEVC_LEVELS.find((l) => luma <= l.maxLuma && rate <= l.maxLumaRate)
  return `${HEVC_PROFILE}.${level?.code ?? HEVC_LEVELS[HEVC_LEVELS.length - 1].code}.B0`
}

/**
 * The AV1 levels, lowest to highest, with `maxPic` (luma samples of the FULL picture per
 * picture) and `maxDisplayRate` (samples per second, AV1 spec, Annex A, Main tier). `ll` is the
 * two-digit `seq_level_idx` of the codec name: `(major - 2) * 4 + minor`, so 4.0 = 08,
 * 4.1 = 09, 5.0 = 12, 5.1 = 13. The tier is Main everywhere (`M`).
 */
const AV1_LEVELS: readonly { ll: string; maxPic: number; maxDisplayRate: number }[] = [
  { ll: '00', maxPic: 147_456, maxDisplayRate: 4_423_680 }, // 2.0
  { ll: '01', maxPic: 278_784, maxDisplayRate: 8_363_520 }, // 2.1
  { ll: '04', maxPic: 665_856, maxDisplayRate: 19_975_680 }, // 3.0
  { ll: '05', maxPic: 1_065_024, maxDisplayRate: 31_950_720 }, // 3.1
  { ll: '08', maxPic: 2_359_296, maxDisplayRate: 70_778_880 }, // 4.0
  { ll: '09', maxPic: 2_359_296, maxDisplayRate: 141_557_760 }, // 4.1
  { ll: '12', maxPic: 8_912_896, maxDisplayRate: 267_386_880 }, // 5.0
  { ll: '13', maxPic: 8_912_896, maxDisplayRate: 534_773_760 }, // 5.1
  { ll: '14', maxPic: 8_912_896, maxDisplayRate: 1_069_547_520 }, // 5.2
  { ll: '16', maxPic: 35_651_584, maxDisplayRate: 1_069_547_520 }, // 6.0
  { ll: '17', maxPic: 35_651_584, maxDisplayRate: 2_139_095_040 }, // 6.1
  { ll: '18', maxPic: 35_651_584, maxDisplayRate: 4_278_190_080 }, // 6.2
]

/** Profile MAIN (`0`), 8 bits (`.08`): the base AV1 codec name, followed by level and tier. */
const AV1_PREFIX = 'av01.0.'

/**
 * av1LevelFor returns the AV1 codec name for this picture and rate: the LOWEST level that
 * accepts the surface and the sample rate, as `av01.0.<LL>M.08` (Main Profile `0`, Main tier
 * `M`, 8 bits `.08`). The surface counts the full picture's luma samples (`width * height`),
 * and the rate in samples per second. Like `avcLevelFor`, beyond the highest level it returns
 * the last one rather than refusing the export.
 */
export function av1LevelFor(width: number, height: number, fps: number): string {
  const luma = width * height
  const rate = luma * fps
  const level = AV1_LEVELS.find((l) => luma <= l.maxPic && rate <= l.maxDisplayRate)
  const last = AV1_LEVELS[AV1_LEVELS.length - 1]
  return `${AV1_PREFIX}${level?.ll ?? last.ll}M.08`
}

/** videoBitrate: the target rate, bounded (cf. `BITRATE_MIN` / `BITRATE_MAX`), at `bitsPerPixel`. */
export function videoBitrate(width: number, height: number, fps: number, bitsPerPixel: number = BITS_PER_PIXEL): number {
  const raw = Math.round(width * height * fps * bitsPerPixel)
  return Math.min(BITRATE_MAX, Math.max(BITRATE_MIN, raw))
}

/**
 * THE RATE MODE OF THE FILE: constant quality (`'quantizer'`) first, then constant bitrate
 * (`'constant'`), then the browser's own rate control (`'variable'`). Decided by the probe in
 * `chooseExportRateMode`; `openVideoExport` records it where it records the fps fallback and
 * says it once at export start.
 */
export type ExportRateMode = 'quantizer' | 'constant' | 'variable'

/** The codec families the export knows how to encode. */
export type ExportVideoCodec = 'avc' | 'hevc' | 'av1'

/** The named video presets. */
export type ExportVideoPresetName =
  | 'h264-qp20'
  | 'h264-qp23'
  | 'h264-qp26'
  | 'h264-qp29'
  | 'hevc-qp26'
  | 'av1-q35'

/**
 * A named video preset. It is the ONLY thing changed to vary quality: point
 * `EXPORT_VIDEO_PRESET` at another name in this table.
 *
 * - `codec`: the codec family (`'avc'` = H.264, `'hevc'`, `'av1'`).
 * - `mode`: the rate mode to try first. All our presets are `'quantizer'`.
 * - `quantizer`: the quantizer on the codec's OWN scale (H.264 and HEVC: 0-51; AV1: 0-63).
 *   Present when `mode` is `'quantizer'`.
 * - `bitsPerPixel`: the bits per pixel for the rate modes, used when `'quantizer'` is not
 *   supported. H.264 keeps today's 0.25.
 * - `fallback`: the preset to try when the browser cannot encode this one. ONLY on HEVC and
 *   AV1: the chain stops at EVERY H.264 preset (the browser always encodes them), so never on
 *   an H.264 preset.
 */
export interface ExportVideoPreset {
  name: ExportVideoPresetName
  codec: ExportVideoCodec
  mode: ExportRateMode
  quantizer?: number
  bitsPerPixel?: number
  fallback?: ExportVideoPresetName
}

/**
 * THE PRESET TABLE. Each preset's fallback points to a safer preset, and EVERY chain ends on an
 * H.264 preset: the browser always encodes H.264, and its constant/variable rate-mode fallbacks
 * (today's 0.25) are always accepted. `hevc` and `av1` land on `h264-qp23` - starting values
 * for the upcoming measurement, not a final choice.
 */
export const EXPORT_VIDEO_PRESETS: Record<ExportVideoPresetName, ExportVideoPreset> = {
  'h264-qp20': { name: 'h264-qp20', codec: 'avc', mode: 'quantizer', quantizer: EXPORT_QP, bitsPerPixel: BITS_PER_PIXEL },
  'h264-qp23': { name: 'h264-qp23', codec: 'avc', mode: 'quantizer', quantizer: 23, bitsPerPixel: BITS_PER_PIXEL },
  'h264-qp26': { name: 'h264-qp26', codec: 'avc', mode: 'quantizer', quantizer: 26, bitsPerPixel: BITS_PER_PIXEL },
  'h264-qp29': { name: 'h264-qp29', codec: 'avc', mode: 'quantizer', quantizer: 29, bitsPerPixel: BITS_PER_PIXEL },
  'hevc-qp26': { name: 'hevc-qp26', codec: 'hevc', mode: 'quantizer', quantizer: 26, bitsPerPixel: BITS_PER_PIXEL, fallback: 'h264-qp23' },
  'av1-q35': { name: 'av1-q35', codec: 'av1', mode: 'quantizer', quantizer: 35, bitsPerPixel: BITS_PER_PIXEL, fallback: 'h264-qp23' },
}

/**
 * THE CURRENT PRESET: the one name to change to switch quality. `'h264-qp20'` is the old
 * default (H.264, QP 20). `'h264-qp26'` won the 2026-11-16 bake-off: a 30 s 1080p60 Outlook
 * clip was 45% of qp20's size at VMAF 95.8 against qp20. HEVC at QP 26 was the same size and
 * quality, and AV1 at 35 was larger than qp20, so H.264 stays (it plays everywhere).
 */
export const EXPORT_VIDEO_PRESET: ExportVideoPresetName = 'h264-qp26'

/**
 * exportPresetNameFromRaw maps a raw developer override (a localStorage value) to a preset
 * name, or `undefined` when it names nothing in the table. The caller turns `undefined` into
 * the one-line default `EXPORT_VIDEO_PRESET`, so an unknown or absent override provably keeps
 * today's preset. PURE over the table — this is the seam the test asserts on.
 */
export function exportPresetNameFromRaw(raw: string | null | undefined): ExportVideoPresetName | undefined {
  if (raw !== undefined && raw !== null && raw in EXPORT_VIDEO_PRESETS) return raw as ExportVideoPresetName
  return undefined
}

/**
 * codecStringFor returns the full codec name of the preset for this picture and rate: the
 * H.264 of `avcLevelFor`, or the HEVC/AV1 of `hevcLevelFor`/`av1LevelFor` depending on the codec.
 */
export function codecStringFor(preset: ExportVideoPreset, width: number, height: number, fps: number): string {
  const w = evenSize(width)
  const h = evenSize(height)
  switch (preset.codec) {
    case 'avc': return avcLevelFor(w, h, fps)
    case 'hevc': return hevcLevelFor(w, h, fps)
    case 'av1': return av1LevelFor(w, h, fps)
  }
}

/**
 * videoEncoderConfig assembles the complete configuration. PURE: it is this function that is
 * tested, and this is what gets passed to `VideoEncoder.isConfigSupported` before anything is
 * opened.
 *
 * The dimensions received are the CANVAS's; the ones returned are even.
 *
 * The MODE is chosen by the caller (`chooseExportRateMode`), which PROVED it with the same
 * function: `'quantizer'` encodes at constant quality (the preset's quantizer, no `bitrate`),
 * `'constant'` and `'variable'` target the bounded rate of `videoBitrate`.
 *
 * THE PRESET (`preset`) chooses the codec and the quantizer. By default it is today's preset:
 * H.264, QP 20 - the config rendered is then byte for byte the one from before.
 */
export function videoEncoderConfig(
  width: number,
  height: number,
  fps: number = EXPORT_FPS,
  mode: ExportRateMode = 'variable',
  preset: ExportVideoPreset = EXPORT_VIDEO_PRESETS[EXPORT_VIDEO_PRESET],
): ExportVideoEncoderConfig {
  const w = evenSize(width)
  const h = evenSize(height)
  const config: ExportVideoEncoderConfig = {
    codec: codecStringFor(preset, w, h, fps),
    width: w,
    height: h,
    framerate: fps,
  }
  if (preset.codec === 'avc') {
    // `avc` and not `annexb`: this is the form the MP4 container expects. HEVC/AV1 have no
    // config sub-object: their codec name already does the work.
    config.avc = { format: 'avc' }
  }
  if (mode === 'quantizer') {
    // No `bitrate`: in quantizer mode, quality IS the setting.
    config.bitrateMode = 'quantizer'
  } else {
    config.bitrate = videoBitrate(w, h, fps, preset.bitsPerPixel)
    config.bitrateMode = mode
  }
  return config
}

/**
 * chooseExportRateMode picks the rate mode, PURE over its probe (`VideoEncoder.isConfigSupported`
 * in the browser, a stub in tests): `'quantizer'` if the probe accepts a config in that mode at
 * this size and rate, else `'constant'` if it accepts that one, else `'variable'` — the mode the
 * browser always accepts. The probe answer decides; nothing is assumed.
 */
export async function chooseExportRateMode(
  width: number,
  height: number,
  fps: number,
  probe: (config: VideoEncoderConfig) => Promise<boolean>,
): Promise<ExportRateMode> {
  if (await probe(videoEncoderConfig(width, height, fps, 'quantizer'))) return 'quantizer'
  if (await probe(videoEncoderConfig(width, height, fps, 'constant'))) return 'constant'
  return 'variable'
}

/**
 * resolveExportPreset walks the preset fallback chain and returns the FIRST one this browser
 * can encode, in the rate mode the probe proved.
 *
 * - A NON-H.264 preset (HEVC/AV1) is tried only in its primary mode (`quantizer`); refused,
 *   the chain moves to its `fallback`.
 * - An H.264 preset is the end of the chain: its quantizer is tried, then today's constant then
 *   variable rate-mode fallbacks, always accepted by the browser. The walk therefore ALWAYS
 *   lands on an H.264 preset in a supported mode.
 *
 * `null` only if the table is malformed (unknown name or loop): with the well-formed table,
 * the walk always ends on H.264.
 */
export async function resolveExportPreset(
  presetName: ExportVideoPresetName,
  width: number,
  height: number,
  fps: number,
  probe: (config: VideoEncoderConfig) => Promise<boolean>,
): Promise<{ preset: ExportVideoPreset; mode: ExportRateMode } | null> {
  const seen = new Set<ExportVideoPresetName>()
  let name: ExportVideoPresetName = presetName
  for (;;) {
    const preset = EXPORT_VIDEO_PRESETS[name]
    if (!preset || seen.has(name)) return null
    seen.add(name)
    if (preset.codec === 'avc') {
      return { preset, mode: await rateModeForPreset(preset, width, height, fps, probe) }
    }
    if (await probe(videoEncoderConfig(width, height, fps, preset.mode, preset))) {
      return { preset, mode: preset.mode }
    }
    if (!preset.fallback) return null
    name = preset.fallback
  }
}

/** The H.264 rate mode the probe accepts for this preset: quantizer, then constant, then variable. */
async function rateModeForPreset(
  preset: ExportVideoPreset,
  width: number,
  height: number,
  fps: number,
  probe: (config: VideoEncoderConfig) => Promise<boolean>,
): Promise<ExportRateMode> {
  if (preset.mode === 'quantizer' && (await probe(videoEncoderConfig(width, height, fps, 'quantizer', preset)))) return 'quantizer'
  if (await probe(videoEncoderConfig(width, height, fps, 'constant', preset))) return 'constant'
  return 'variable'
}

/**
 * The encode options of one frame: the codec's `quantizer` in quantizer mode, and only there.
 * The quantizer travels under the codec's own key (`avc`/`hevc`/`av1`), on that codec's scale.
 */
export function encodeOptionsFor(
  mode: ExportRateMode,
  keyFrame: boolean,
  preset: ExportVideoPreset = EXPORT_VIDEO_PRESETS[EXPORT_VIDEO_PRESET],
): ExportVideoEncoderEncodeOptions {
  if (mode !== 'quantizer') return { keyFrame }
  const options: ExportVideoEncoderEncodeOptions = { keyFrame }
  switch (preset.codec) {
    case 'avc': options.avc = { quantizer: preset.quantizer }; break
    case 'hevc': options.hevc = { quantizer: preset.quantizer }; break
    case 'av1': options.av1 = { quantizer: preset.quantizer }; break
  }
  return options
}

/**
 * shouldDrain says whether the loop must wait before pushing the next frame (decision 3).
 * Kept apart from the loop so it is testable without an encoder.
 */
export function shouldDrain(queueSize: number): boolean {
  return queueSize > ENCODE_QUEUE_MAX
}

/**
 * isKeyFrame: does frame `index` (0 = the first) open a new entry point? Every
 * `KEYFRAME_SECONDS` of clip at the rate `fps`: a keyframe every 60 frames at 30, every 120 at 60.
 */
export function isKeyFrame(index: number, fps: number = EXPORT_FPS): boolean {
  return index % Math.max(1, Math.round(fps * KEYFRAME_SECONDS)) === 0
}

/**
 * frameTimestampUs: the file instant of frame `index` at the rate `fps`, in microseconds.
 * COMPUTED FROM THE INDEX, never accumulated from a rounded duration: `round(1e6 / 60)` is
 * 16667 us, and summing it drifted the video 1.2 ms per minute ahead of the sound.
 */
export function frameTimestampUs(index: number, fps: number): number {
  return Math.round((index * 1_000_000) / fps)
}

/** frameDurationUs: how long frame `index` lasts, so that consecutive frames tile exactly. */
export function frameDurationUs(index: number, fps: number): number {
  return frameTimestampUs(index + 1, fps) - frameTimestampUs(index, fps)
}

/**
 * chooseExportFps picks the encoding rate IN THE MODE ALREADY CHOSEN (`mode`): `wanted` if this
 * browser accepts the configuration at that rate in that mode, else `fallback` if it accepts
 * that one, else null. PURE over its probe, which is `VideoEncoder.isConfigSupported` in the
 * browser and a stub in tests. The mode is fixed first (`chooseExportRateMode`) so the fps
 * fallback probes the config that will actually be opened, not a variable-rate one.
 */
export async function chooseExportFps(
  width: number,
  height: number,
  wanted: number,
  fallback: number | undefined,
  probe: (config: VideoEncoderConfig) => Promise<boolean>,
  mode: ExportRateMode = 'variable',
  preset: ExportVideoPreset = EXPORT_VIDEO_PRESETS[EXPORT_VIDEO_PRESET],
): Promise<number | null> {
  if (await probe(videoEncoderConfig(width, height, wanted, mode, preset))) return wanted
  if (fallback === undefined || fallback === wanted) return null
  return (await probe(videoEncoderConfig(width, height, fallback, mode, preset))) ? fallback : null
}

/** The browser probe: a throw (invalid configuration) is an answer, not a failure. */
async function browserSupports(config: VideoEncoderConfig): Promise<boolean> {
  try {
    return (await VideoEncoder.isConfigSupported(config)).supported === true
  } catch {
    return false
  }
}

/**
 * canExportVideo says whether THIS browser can encode offline.
 *
 * The three conditions are inseparable: the encoder, the frame type pushed into it, and the
 * asynchronous reading of its capabilities. Missing one means no export is possible — and it
 * is the REAL-TIME recording button that takes over instead (fallback, plan decision D5).
 *
 * Returns `false` under jsdom, where none of this exists: that is what lets this module's
 * tests stay pure tests.
 */
export function canExportVideo(): boolean {
  if (typeof VideoEncoder === 'undefined') return false
  if (typeof VideoFrame === 'undefined') return false
  return typeof VideoEncoder.isConfigSupported === 'function'
}

/**
 * canExportAudio says whether this browser can encode a sound track.
 *
 * TESTED BEFORE THE CONTAINER OPENS, never after: the MP4 announces its tracks once and for
 * all. Declaring an AAC track and then discovering `AudioEncoder` is missing produced a file
 * carrying an EMPTY track — depending on the player: silent, a warning, or a refusal to open.
 */
export function canExportAudio(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined'
}

/**
 * The sound track's bitrate, in bits per second. 128 kb/s in stereo AAC: above the threshold
 * where the ear can still tell the encoding apart on short, dry sounds (gunshots,
 * explosions), and nowhere near the video bitrate — the track weighs nothing in the file.
 */
const AUDIO_BITRATE = 128_000

/**
 * The audio codecs of the clip, in order of preference: AAC-LC first, the profile every player
 * decodes; Opus where the browser has no AAC encoder. Firefox is that case (checked 2026-11-16 on
 * Firefox 142: `AudioEncoder.isConfigSupported` refuses `mp4a.40.2` and accepts `opus`); without
 * the Opus fallback its clips came out silent. Opus in MP4 is standard (ISO/IEC 14496-12 with the
 * Opus mapping) and plays in the browsers and VLC.
 */
export type ExportAudioCodec = 'aac' | 'opus'
const AUDIO_CODECS: readonly { codec: ExportAudioCodec; webCodec: string }[] = [
  { codec: 'aac', webCodec: 'mp4a.40.2' },
  { codec: 'opus', webCodec: 'opus' },
]

/** The configuration presented for a codec: AAC-LC by default. */
export function audioEncoderConfig(shape: AudioTrackShape, codec: ExportAudioCodec = 'aac'): AudioEncoderConfig {
  return {
    codec: AUDIO_CODECS.find((c) => c.codec === codec)?.webCodec ?? 'mp4a.40.2',
    sampleRate: shape.sampleRate,
    numberOfChannels: shape.numberOfChannels,
    bitrate: AUDIO_BITRATE,
  }
}

/**
 * chooseAudioCodec says which codec this browser can REALLY encode for this track, in the order
 * of `AUDIO_CODECS`, or `null` when it can encode none.
 *
 * `canExportAudio` only answers "does the API exist". It can exist and REFUSE the configuration,
 * and that refusal is ASYNCHRONOUS: `configure()` does not throw, it puts the encoder in error and
 * closes it, so the failure only shows at `flush()`, as the misleading "Encoder must be
 * configured first". That is exactly what happened in acceptance on 2026-08-28.
 *
 * So the question is asked BEFORE the container is opened, which declares its tracks once and for
 * all: an announced silent clip is better than a lost export.
 */
export async function chooseAudioCodec(
  shape: AudioTrackShape,
  probe: (config: AudioEncoderConfig) => Promise<boolean> = audioConfigSupported,
): Promise<ExportAudioCodec | null> {
  if (!canExportAudio()) return null
  for (const { codec } of AUDIO_CODECS) {
    if (await probe(audioEncoderConfig(shape, codec))) return codec
  }
  return null
}

/** The browser's answer for one audio configuration; a refusal that throws is a "no". */
async function audioConfigSupported(config: AudioEncoderConfig): Promise<boolean> {
  if (typeof AudioEncoder.isConfigSupported !== 'function') return false
  try {
    return (await AudioEncoder.isConfigSupported(config)).supported === true
  } catch {
    // A REFUSED configuration throws here (invalid config): that is an answer, not a failure.
    return false
  }
}

/** What the export loop receives: three gestures, and no state to hold on its own side. */
export interface VideoExportSink {
  /** Pushes the canvas AS IT IS at this instant. Waits if the queue is full. */
  addFrame: (canvas: HTMLCanvasElement, index: number) => Promise<void>
  /** Drains the queue, closes the container, returns the file. */
  finish: () => Promise<Blob>
  /**
   * `false` = the requested sound tracks could NOT be declared (no AAC encoder, or
   * configuration refused). The clip will come out silent, and the caller must SAY so.
   */
  audioEnabled: boolean
  /**
   * Hands back the rendered buffers, IN THE ORDER of the names declared at opening. Call ONLY
   * if `audioEnabled`, and only once.
   */
  addAudioTracks: (tracks: readonly AudioTrackInput[], progress?: (fraction: number) => void) => Promise<void>
  /** Closes everything without returning anything (cancellation, error). Never throws. */
  abort: () => void
  /** The rate the file is actually encoded at: the frame plan must be built at this rate. */
  fps: number
  /**
   * `true` = the requested rate was refused by this browser and the clip is encoded at
   * `VideoExportOptions.fallbackFps` instead. The caller must SAY it.
   */
  fpsFallback: boolean
  /**
   * The rate mode the file is encoded in, decided by the probe (`resolveExportPreset`).
   * `'quantizer'` = constant quality at the selected preset's quantizer; the others target
   * `videoBitrate`. Recorded next to the fps fallback; `openVideoExport` already said it at
   * export start.
   */
  rateMode: ExportRateMode
}

export interface VideoExportOptions {
  width: number
  height: number
  fps?: number
  /**
   * The rate to fall back to when `fps` is refused by this browser (`chooseExportFps`). Absent:
   * a refused `fps` is a refused export (`null`), as before.
   */
  fallbackFps?: number
  /**
   * The preset to encode with, when given: used instead of the one-line constant
   * `EXPORT_VIDEO_PRESET`. Absent: the constant. This is the seam a developer override
   * (localStorage) plugs into, so a comparison can be measured without editing code.
   */
  preset?: ExportVideoPresetName
  /**
   * HOW MANY sound tracks the clip will carry. Declared at opening or never: the container
   * writes its track table once and for all. `0` = silent clip, which is still a result.
   *
   * The names are given here because they are part of the DECLARATION; the buffers
   * themselves arrive later (`addAudioTracks`), once the mix is rendered.
   */
  audioTracks?: readonly string[]
}

/** A sound track's shape: what the container announces before the first byte. */
export interface AudioTrackShape {
  sampleRate: number
  numberOfChannels: number
}

/**
 * A sound track to write into the clip: its name, and the already-rendered buffer.
 *
 * TRACK ORDER IS NOT DECORATIVE. The FIRST one is the one any ordinary player plays — a
 * browser does not expose the others. The FULL MIX must therefore come first; the separate
 * families follow, for whoever opens the file in an editor. Delivering the families WITHOUT
 * the mix would make only the sound effects audible, with no music or voice: a regression for
 * everyone except the editor.
 */
export interface AudioTrackInput {
  /** The track's readable name ("Mix", "SFX", "Voice", "Music"). */
  name: string
  buffer: AudioBuffer
}

/**
 * openVideoExport opens the encoder and the container, and returns the loop's three gestures.
 *
 * `null` = this browser cannot encode THIS picture (configuration refused): the caller falls
 * back. No throw — an impossible export is not a failure, it is a missing capability, and the
 * plan (D5) wants it handled through another button.
 */
/**
 * The reference shape of the sound tracks: the one the offline mix renders (`replayAudioMix.ts`).
 * It only serves to PROVE that the encoder (AAC, or Opus) accepts it, BEFORE anything is declared
 * in the container: a track declared and then refused loses the whole export.
 */
const MIX_TRACK_SHAPE: AudioTrackShape = { sampleRate: 48_000, numberOfChannels: 2 }

export async function openVideoExport(o: VideoExportOptions): Promise<VideoExportSink | null> {
  if (!canExportVideo()) return null
  const wanted = o.fps ?? EXPORT_FPS
  // THE PRESET IS PROVED FIRST: it chooses the codec and the rate mode (and, if HEVC/AV1 are
  // refused, falls back to H.264). The rate probe (the 60->30 fallback) then probes the config
  // that will actually be opened. `preset`, when the caller gives one (developer override),
  // replaces the one-line `EXPORT_VIDEO_PRESET`.
  const resolved = await resolveExportPreset(o.preset ?? EXPORT_VIDEO_PRESET, o.width, o.height, wanted, browserSupports)
  if (resolved === null) return null
  const { preset, mode } = resolved
  const fps = await chooseExportFps(o.width, o.height, wanted, o.fallbackFps, browserSupports, mode, preset)
  if (fps === null) return null
  const fpsFallback = fps !== wanted
  if (fpsFallback) {
    // LOUD, NOT SILENT: the caller also shows it in the dialog (`ReplayExportState.fpsFallback`).
    console.warn(`[replay-export] ${o.width}x${o.height} at ${wanted} fps refused by this browser's encoder, encoding at ${fps} fps`)
  }
  const config = videoEncoderConfig(o.width, o.height, fps, mode, preset)
  // THE PRESET AND THE MODE ARE SAID ONCE, with the config: the reviewer checks in the console
  // what was asked of the encoder, without guessing what won the probe.
  console.info(`[replay-export] preset ${preset.name}, rate mode ${mode} —`, JSON.stringify(config))
  const names = o.audioTracks ?? []
  // THE SOUND TRACKS ARE PROVEN BEFORE THEY ARE DECLARED (see `chooseAudioCodec`): the container
  // writes its track table once and for all, and a declared track the encoder later refuses
  // loses THE WHOLE export.
  const audioCodec = names.length > 0 ? await chooseAudioCodec(MIX_TRACK_SHAPE) : null
  if (audioCodec && audioCodec !== 'aac') console.info(`[replay-export] no AAC encoder in this browser, audio encoded as ${audioCodec}`)

  // THE FILE IS WRITTEN AS A STREAM, NEVER INTO A SINGLE ArrayBuffer.
  //
  // A full match at constant quality can exceed several GB; a single ArrayBuffer cannot hold
  // that, and the export would die at the finish line, after rendering the whole film. Here,
  // bytes are delivered by `StreamTarget` into a `WritableStream` and folded into ~64 MB
  // `Blob`s by `ExportFileTarget`: the browser keeps the big chunks off the JS heap.
  //
  // `fastStart: false` keeps the ordinary MP4 layout (moov at the end of the file). mediabunny
  // then only does a single in-place rewrite — the mdat header patch, right at the file's
  // start — and `ExportFileTarget` collects it in its mutable head buffer.
  const fileTarget = new ExportFileTarget()
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(
      new WritableStream<StreamTargetChunk>({
        write: (chunk) => fileTarget.write(chunk),
      }),
    ),
  })
  // The container track declares the preset's codec: `avc`, `hevc` or `av1`.
  const videoSource = new EncodedVideoPacketSource(preset.codec)
  output.addVideoTrack(videoSource, { frameRate: fps })
  // AUDIO tracks are added HERE, empty: their EXISTENCE and ORDER are declared before the
  // first byte, their content arrives later (`addAudioTracks`).
  const audioSources = audioCodec
    ? names.map((name) => {
        const src = new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH })
        output.addAudioTrack(src, { name })
        return src
      })
    : []
  await output.start()

  // The first error wins and will be rethrown by `finish`: an encoder error arrives
  // asynchronously, outside the caller's call stack, and swallowing it would produce a
  // truncated file without a word about it.
  let failure: Error | null = null
  /**
   * PACKET WRITES ARE CHAINED, AND AWAITED BEFORE FINALIZATION.
   *
   * `videoSource.add()` is ASYNCHRONOUS — it returns a promise — while a `VideoEncoder`'s
   * `output` callback is synchronous and cannot await anything. Firing them without tracking
   * them (`void add(...)`) let `output.finalize()` close the file while packets were still in
   * flight: the clip came out WITH ITS SOUND AND WITHOUT ITS PICTURE. `encoder.flush()` does
   * not protect against this — it guarantees the packets were EMITTED, not that they were
   * WRITTEN.
   *
   * Chaining also preserves ORDER: two concurrent `add` calls could write out of order,
   * which a video stream does not forgive.
   */
  let writes: Promise<unknown> = Promise.resolve()
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const packet = EncodedPacket.fromEncodedChunk(chunk)
      const checked = withRepairedDescription(meta, packet.data)
      writes = writes.then(() => videoSource.add(packet, checked))
    },
    error: (err) => {
      failure = err instanceof Error ? err : new Error(String(err))
    },
  })
  encoder.configure(config)
  const sink = makeSink(encoder, output, videoSource, audioSources, fps, mode, preset, () => failure, () => writes, {
    width: config.width,
    height: config.height,
  }, fileTarget)
  return { ...sink, fpsFallback, rateMode: mode }
}

/**
 * withRepairedDescription hands the muxer a well-formed `avcC`: Firefox's encoder gives a malformed
 * one (`avcDescription.ts`). Metadata without a description, or with a sound one, passes as is.
 */
function withRepairedDescription(
  meta: EncodedVideoChunkMetadata | undefined,
  data: Uint8Array,
): EncodedVideoChunkMetadata | undefined {
  const desc = meta?.decoderConfig?.description
  if (!meta?.decoderConfig || !desc) return meta
  const bytes = ArrayBuffer.isView(desc) ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength) : new Uint8Array(desc)
  const repaired = repairAvcDescription(bytes, data)
  if (!repaired) return meta
  console.warn('[replay-export] the browser gave a malformed H.264 avcC; rebuilt from the key frame parameter sets')
  return { ...meta, decoderConfig: { ...meta.decoderConfig, description: repaired } }
}

/**
 * makeSink assembles the three gestures. OUTSIDE `openVideoExport` to keep the repo's 80-line
 * rule, and because opening (asynchronous, fallible) and use (synchronous, repeated eighteen
 * thousand times) do not have the same nature.
 */
function makeSink(
  encoder: VideoEncoder,
  output: Output,
  videoSource: EncodedVideoPacketSource,
  audioSources: readonly AudioBufferSource[],
  fps: number,
  mode: ExportRateMode,
  preset: ExportVideoPreset,
  failureOf: () => Error | null,
  /** The chain of video packet writes, to await before finalizing. */
  pendingWrites: () => Promise<unknown>,
  size: { width: number; height: number },
  /** The file's bytes, folded into `Blob`s as they stream in; `finish` returns them, `abort` discards them. */
  fileTarget: ExportFileTarget,
): Omit<VideoExportSink, 'fpsFallback'> {
  let closed = false

  const addFrame = async (canvas: HTMLCanvasElement, index: number) => {
    const failed = failureOf()
    if (failed) throw failed
    if (closed) return
    // THE TIMESTAMP IS COMPUTED, NEVER MEASURED (see the header): that is what makes the
    // clip's duration independent of compute time.
    const frame = new VideoFrame(canvas, {
      timestamp: frameTimestampUs(index, fps),
      duration: frameDurationUs(index, fps),
      // THE CROP IS EXPLICIT. A canvas of a different size than the config (odd, or not yet
      // at the format) must not pass implicitly: without `visibleRect`, a 1919x601 frame
      // would be pushed into an encoder configured at 1918x600, and the behavior then
      // depends on the browser version — implicit scaling here, encoder error elsewhere.
      visibleRect: { x: 0, y: 0, width: size.width, height: size.height },
    })
    try {
      // the preset's quantizer, under ITS codec's key, only in quantizer mode: in the rate
      // modes the browser ignores it, and sending it would make the console lie.
      encoder.encode(frame, encodeOptionsFor(mode, isKeyFrame(index, fps), preset))
    } finally {
      // ALWAYS, even if `encode` throws: an unclosed `VideoFrame` holds its GPU memory, and
      // thirty of them pass by per second of match.
      frame.close()
    }
    while (shouldDrain(encoder.encodeQueueSize)) {
      // NEVER `setTimeout` HERE (see `eventLoopYield.ts`): throttled to one second in a
      // hidden tab, it made the export ten times slower than the real time it encodes.
      await yieldToEvents()
      const late = failureOf()
      if (late) throw late
    }
  }

  /**
   * addAudioTracks hands back the rendered buffers, IN THE ORDER of the names declared at
   * opening.
   *
   * `AudioBufferSource.close()` is called after each buffer: without it, the track stays
   * open and `output.finalize()` would wait forever for content that will never come.
   *
   * `progress` receives the share of the tracks already encoded, 0..1, after each one: on a full
   * match each track takes seconds of AAC encoding.
   */
  const addAudioTracks = async (tracks: readonly AudioTrackInput[], progress?: (fraction: number) => void) => {
    for (let i = 0; i < audioSources.length; i++) {
      const track = tracks[i]
      if (track) await audioSources[i].add(track.buffer)
      audioSources[i].close()
      progress?.((i + 1) / audioSources.length)
    }
  }

  const finish = async (): Promise<Blob> => {
    await encoder.flush()
    // `flush()` guarantees the packets were EMITTED; this guarantees they were WRITTEN.
    await pendingWrites()
    const failed = failureOf()
    if (failed) throw failed
    // SOURCES CLOSE BEFORE FINALIZATION: a track declared but never closed leaves
    // `finalize()` waiting for content that will not arrive.
    for (const src of audioSources) src.close()
    videoSource.close()
    // `finalize()` closes the stream: all the bytes (including the mdat patch and the moov)
    // have by then been delivered to the target. They are returned as is, already folded
    // into a `Blob`.
    await output.finalize()
    closed = true
    encoder.close()
    return fileTarget.finish()
  }

  const abort = () => {
    if (closed) return
    closed = true
    // Everything written so far is discarded: without this, a cancelled match would leave
    // gigabytes of `Blob` waiting in the target.
    fileTarget.abort()
    // `close()` on an encoder already in error throws: cancellation must never mask the
    // cause of a failure with a second error.
    try {
      encoder.close()
    } catch {
      // Nothing to say: this is a cancellation, there is no file to return and no caller to notify.
    }
  }

  return { addFrame, addAudioTracks, audioEnabled: audioSources.length > 0, finish, abort, fps, rateMode: mode }
}


