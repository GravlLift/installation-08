// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayVideoEncoder.test.ts — THE ENCODER'S DECISIONS, tested with no browser.
 *
 * What is tested here depends on NO WebCodecs API: these are the four computations that
 * decide the file (even dimensions, H.264 level, bitrate, backpressure). Actually opening the
 * encoder has no business under jsdom — it is verified in the browser, and that is the plan's
 * E1 step's manual gate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ENCODE_QUEUE_MAX,
  EXPORT_FPS,
  EXPORT_FPS_3D,
  EXPORT_QP,
  EXPORT_VIDEO_PRESET,
  EXPORT_VIDEO_PRESETS,
  KEYFRAME_EVERY,
  audioEncoderConfig,
  av1LevelFor,
  avcLevelFor,
  canExportVideo,
  chooseAudioCodec,
  chooseExportFps,
  chooseExportRateMode,
  encodeOptionsFor,
  evenSize,
  exportPresetNameFromRaw,
  frameDurationUs,
  frameTimestampUs,
  hevcLevelFor,
  isKeyFrame,
  resolveExportPreset,
  shouldDrain,
  videoBitrate,
  videoEncoderConfig,
} from './replayVideoEncoder'
import type { ExportRateMode, ExportVideoPreset, ExportVideoPresetName } from './replayVideoEncoder'

describe('evenSize — H.264 refuses odd dimensions', () => {
  it('leaves an even number intact', () => {
    expect(evenSize(1280)).toBe(1280)
  })

  it('rounds DOWN, never up', () => {
    // Trimming a column is invisible; stretching the frame by one pixel is not.
    expect(evenSize(1281)).toBe(1280)
  })

  it('truncates a fractional width (canvas at a non-integer DPR)', () => {
    expect(evenSize(1439.7)).toBe(1438)
  })

  it('bumps up to 2 anything that makes no sense for an encoder', () => {
    expect(evenSize(0)).toBe(2)
    expect(evenSize(-40)).toBe(2)
    expect(evenSize(Number.NaN)).toBe(2)
  })
})

describe('avcLevelFor — the LOWEST level that accepts the picture', () => {
  it('720p at 30 fps fits level 3.1', () => {
    // 80x45 macroblocks = 3600 FS, exactly level 3.1's ceiling.
    expect(avcLevelFor(1280, 720, 30)).toBe('avc1.64001f')
  })

  it('1080p at 30 fps climbs to level 4.0', () => {
    expect(avcLevelFor(1920, 1080, 30)).toBe('avc1.640028')
  })

  it('the RATE counts as much as the surface', () => {
    // Same picture as above: at 60 fps the macroblock rate exceeds level 4.0.
    expect(avcLevelFor(1920, 1080, 60)).toBe('avc1.64002a')
  })

  it('an oversized canvas returns the highest level rather than nothing', () => {
    expect(avcLevelFor(16_000, 16_000, 30)).toBe('avc1.64003c')
  })
})

describe('videoBitrate — bounded on both ends', () => {
  it('a small canvas does not drop below the floor', () => {
    // 320x180x30x0.25 = 432,000 b/s: the HUD text would smear at that rate.
    expect(videoBitrate(320, 180, 30)).toBe(2_000_000)
  })

  it('an ordinary canvas follows the surface', () => {
    expect(videoBitrate(1280, 720, 30)).toBe(6_912_000)
  })

  it('an oversized canvas does not exceed the ceiling', () => {
    expect(videoBitrate(7680, 4320, 60)).toBe(80_000_000)
  })
})

describe('videoEncoderConfig — what is presented to the browser', () => {
  it('assembles codec, even dimensions, rate, and bitrate (variable mode is the fallback)', () => {
    expect(videoEncoderConfig(1281, 721)).toEqual({
      codec: 'avc1.64001f',
      width: 1280,
      height: 720,
      framerate: EXPORT_FPS,
      bitrate: 6_912_000,
      bitrateMode: 'variable',
      avc: { format: 'avc' },
    })
  })

  it('the default rate is the export\'s own', () => {
    expect(videoEncoderConfig(640, 360).framerate).toBe(30)
  })

  it('quantizer mode requests quality, not a bitrate', () => {
    // No `bitrate`: in quantizer mode, the QP IS the setting, and requesting one too would
    // make the console lie about what is being asked of the encoder.
    const config = videoEncoderConfig(1280, 720, EXPORT_FPS, 'quantizer')
    expect(config).toEqual({
      codec: 'avc1.64001f',
      width: 1280,
      height: 720,
      framerate: EXPORT_FPS,
      bitrateMode: 'quantizer',
      avc: { format: 'avc' },
    })
    expect('bitrate' in config).toBe(false)
  })

  it('constant mode targets the same bounded bitrate as variable', () => {
    const config = videoEncoderConfig(1280, 720, EXPORT_FPS, 'constant')
    expect(config.bitrateMode).toBe('constant')
    expect(config.bitrate).toBe(videoBitrate(1280, 720, EXPORT_FPS))
  })
})

describe('chooseExportRateMode — the probe decides, nothing is assumed', () => {
  // The fake probe reads the mode of the config it is presented: it is what decides.
  const probeFor = (supported: ExportRateMode[]) => async (c: VideoEncoderConfig) =>
    supported.includes((c.bitrateMode ?? 'variable') as ExportRateMode)

  it('takes the quantizer when the probe accepts it', async () => {
    expect(await chooseExportRateMode(1920, 1080, 60, probeFor(['quantizer', 'constant', 'variable']))).toBe('quantizer')
  })

  it('takes constant when only that is accepted', async () => {
    expect(await chooseExportRateMode(1920, 1080, 60, probeFor(['constant', 'variable']))).toBe('constant')
  })

  it('falls back to variable when nothing else is', async () => {
    expect(await chooseExportRateMode(1920, 1080, 60, probeFor(['variable']))).toBe('variable')
  })

  it('does not probe constant when the quantizer is already accepted', async () => {
    const asked: string[] = []
    const fps = await chooseExportFps(1920, 1080, 60, 30, async (c) => {
      asked.push(`${c.bitrateMode ?? 'variable'}@${c.framerate}`)
      return true
    }, 'quantizer')
    expect(fps).toBe(60)
    expect(asked).toEqual(['quantizer@60'])
  })
})

describe('encodeOptionsFor — the QP only travels in quantizer mode', () => {
  it('carries avc.quantizer in quantizer mode, keyframe and other frames alike', () => {
    // Without a preset argument, the default preset's quantizer.
    const qp = EXPORT_VIDEO_PRESETS[EXPORT_VIDEO_PRESET].quantizer
    expect(encodeOptionsFor('quantizer', true)).toEqual({ keyFrame: true, avc: { quantizer: qp } })
    expect(encodeOptionsFor('quantizer', false)).toEqual({ keyFrame: false, avc: { quantizer: qp } })
  })

  it('only carries the key in the rate modes: the QP would be ignored, and the console would lie', () => {
    expect(encodeOptionsFor('constant', true)).toEqual({ keyFrame: true })
    expect(encodeOptionsFor('variable', false)).toEqual({ keyFrame: false })
  })
})

describe('backpressure and keyframes', () => {
  it('does not wait while the queue stays under the threshold', () => {
    expect(shouldDrain(0)).toBe(false)
    expect(shouldDrain(ENCODE_QUEUE_MAX)).toBe(false)
  })

  it('waits as soon as the queue exceeds the threshold', () => {
    // Without this wait, a ten-minute match stacks 18,000 frames and the tab dies.
    expect(shouldDrain(ENCODE_QUEUE_MAX + 1)).toBe(true)
  })

  it('opens the clip on a keyframe, then one every 2 seconds', () => {
    expect(isKeyFrame(0)).toBe(true)
    expect(isKeyFrame(1)).toBe(false)
    expect(isKeyFrame(KEYFRAME_EVERY)).toBe(true)
    expect(KEYFRAME_EVERY).toBe(60)
  })
})

describe('the 3D export at 60 fps', () => {
  it('the 3D rate is 60, the 2D rate stays 30', () => {
    expect(EXPORT_FPS_3D).toBe(60)
    expect(EXPORT_FPS).toBe(30)
  })

  it('keyframes stay every 2 seconds of clip at 60: every 120 frames', () => {
    expect(isKeyFrame(0, 60)).toBe(true)
    expect(isKeyFrame(60, 60)).toBe(false)
    expect(isKeyFrame(119, 60)).toBe(false)
    expect(isKeyFrame(120, 60)).toBe(true)
  })

  it('1080p60 asks level 4.2 and 720p60 level 3.2, each holding its macroblock rate', () => {
    const hd = videoEncoderConfig(1920, 1080, 60)
    expect(hd).toMatchObject({ codec: 'avc1.64002a', width: 1920, height: 1080, framerate: 60 })
    // 120x68 MB x 60 = 489 600 MB/s: over 4.0 (245 760), within 4.2 (522 240, 8704 MB).
    expect(hd.bitrate).toBe(31_104_000)
    const sd = videoEncoderConfig(1280, 720, 60)
    // 80x45 MB x 60 = 216 000 MB/s: exactly 3.2's ceiling.
    expect(sd).toMatchObject({ codec: 'avc1.640020', framerate: 60, bitrate: 13_824_000 })
  })

  it('the bitrate doubles with the rate: same bits per pixel and frame', () => {
    expect(videoBitrate(1920, 1080, 60)).toBe(2 * videoBitrate(1920, 1080, 30))
  })

  it('timestamps come from the index: one minute at 60 ends at exactly 60 s, no drift', () => {
    expect(frameTimestampUs(0, 60)).toBe(0)
    expect(frameTimestampUs(1, 60)).toBe(16_667)
    expect(frameTimestampUs(2, 60)).toBe(33_333)
    expect(frameTimestampUs(3600, 60)).toBe(60_000_000)
    expect(frameTimestampUs(36_000, 60)).toBe(600_000_000)
    // Durations tile: each frame ends where the next starts.
    let end = 0
    for (let i = 0; i < 600; i++) {
      expect(frameTimestampUs(i, 60)).toBe(end)
      end += frameDurationUs(i, 60)
    }
    expect(end).toBe(10_000_000)
  })

  it('chooseExportFps keeps 60 when the browser accepts it', async () => {
    const asked: number[] = []
    const fps = await chooseExportFps(1920, 1080, 60, 30, async (c) => {
      asked.push(c.framerate ?? 0)
      return true
    })
    expect(fps).toBe(60)
    expect(asked).toEqual([60])
  })

  it('chooseExportFps falls back to 30 only when 60 is refused, and probes the 30 config', async () => {
    const asked: string[] = []
    const fps = await chooseExportFps(1920, 1080, 60, 30, async (c) => {
      asked.push(`${c.codec}@${c.framerate}`)
      return c.framerate === 30
    })
    expect(fps).toBe(30)
    expect(asked).toEqual(['avc1.64002a@60', 'avc1.640028@30'])
  })

  it('chooseExportFps returns null when nothing is accepted, or 60 is refused without fallback', async () => {
    expect(await chooseExportFps(1920, 1080, 60, 30, async () => false)).toBeNull()
    expect(await chooseExportFps(1920, 1080, 60, undefined, async (c) => c.framerate === 30)).toBeNull()
  })
})

describe('canExportVideo — the browser\'s capability', () => {
  it('returns false where WebCodecs does not exist (jsdom)', () => {
    // This is what makes the UI fall back to the real-time recorder (plan decision D5).
    expect(canExportVideo()).toBe(false)
  })
})

describe('chooseAudioCodec — AAC first, Opus where there is no AAC encoder (Firefox)', () => {
  const SHAPE = { sampleRate: 48_000, numberOfChannels: 2 }
  afterEach(() => vi.unstubAllGlobals())
  const withWebCodecs = () => {
    vi.stubGlobal('AudioEncoder', class {})
    vi.stubGlobal('AudioData', class {})
  }

  it('takes AAC when the browser encodes it', async () => {
    withWebCodecs()
    expect(await chooseAudioCodec(SHAPE, async () => true)).toBe('aac')
  })

  it('falls back to Opus when AAC is refused, as Firefox does', async () => {
    withWebCodecs()
    const asked: string[] = []
    const codec = await chooseAudioCodec(SHAPE, async (c) => {
      asked.push(c.codec)
      return c.codec === 'opus'
    })
    expect(codec).toBe('opus')
    expect(asked).toEqual(['mp4a.40.2', 'opus'])
  })

  it('no codec at all, or no WebCodecs: null, and the clip is announced silent', async () => {
    withWebCodecs()
    expect(await chooseAudioCodec(SHAPE, async () => false)).toBeNull()
    vi.unstubAllGlobals()
    expect(await chooseAudioCodec(SHAPE, async () => true)).toBeNull()
  })

  it('the configurations presented: AAC-LC by default, Opus on request, same shape and rate', () => {
    expect(audioEncoderConfig(SHAPE)).toMatchObject({ codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2 })
    expect(audioEncoderConfig(SHAPE, 'opus')).toMatchObject({ codec: 'opus', sampleRate: 48_000, numberOfChannels: 2 })
  })
})
describe('EXPORT_VIDEO_PRESET — the default, and h264-qp20 as the old behavior', () => {
  it('the default preset is h264-qp26 (the bake-off winner)', () => {
    expect(EXPORT_VIDEO_PRESET).toBe('h264-qp26')
    expect(EXPORT_VIDEO_PRESETS[EXPORT_VIDEO_PRESET]).toEqual({
      name: 'h264-qp26',
      codec: 'avc',
      mode: 'quantizer',
      quantizer: 26,
      bitsPerPixel: 0.25,
    })
  })

  it('h264-qp20 keeps the old default exactly', () => {
    expect(EXPORT_VIDEO_PRESETS['h264-qp20']).toEqual({
      name: 'h264-qp20',
      codec: 'avc',
      mode: 'quantizer',
      quantizer: EXPORT_QP,
      bitsPerPixel: 0.25,
    })
  })

  it('videoEncoderConfig for h264-qp20 is byte for byte the old config', () => {
    const preset = EXPORT_VIDEO_PRESETS['h264-qp20']
    // The quantizer mode: today’s setting, no `bitrate`.
    expect(videoEncoderConfig(1280, 720, EXPORT_FPS, 'quantizer', preset)).toEqual({
      codec: 'avc1.64001f',
      width: 1280,
      height: 720,
      framerate: 30,
      bitrateMode: 'quantizer',
      avc: { format: 'avc' },
    })
    // The rate modes: today’s fallback, at the same bounded rate.
    expect(videoEncoderConfig(1280, 720, EXPORT_FPS, 'variable', preset)).toEqual({
      codec: 'avc1.64001f',
      width: 1280,
      height: 720,
      framerate: 30,
      bitrate: 6_912_000,
      bitrateMode: 'variable',
      avc: { format: 'avc' },
    })
  })

  it('encodeOptionsFor for h264-qp20 is byte for byte the old options', () => {
    const preset = EXPORT_VIDEO_PRESETS['h264-qp20']
    expect(encodeOptionsFor('quantizer', true, preset)).toEqual({ keyFrame: true, avc: { quantizer: 20 } })
    expect(encodeOptionsFor('quantizer', false, preset)).toEqual({ keyFrame: false, avc: { quantizer: 20 } })
    expect(encodeOptionsFor('constant', true, preset)).toEqual({ keyFrame: true })
    expect(encodeOptionsFor('variable', false, preset)).toEqual({ keyFrame: false })
  })
})

describe('each preset produces its config and codec name', () => {
  it('h264-qp23: H.264 at QP 23, same shape as the default', () => {
    const preset = EXPORT_VIDEO_PRESETS['h264-qp23']
    expect(videoEncoderConfig(1280, 720, EXPORT_FPS, 'quantizer', preset)).toEqual({
      codec: 'avc1.64001f',
      width: 1280,
      height: 720,
      framerate: 30,
      bitrateMode: 'quantizer',
      avc: { format: 'avc' },
    })
    expect(encodeOptionsFor('quantizer', true, preset)).toEqual({ keyFrame: true, avc: { quantizer: 23 } })
  })

  it('h264-qp26: H.264 at QP 26', () => {
    const preset = EXPORT_VIDEO_PRESETS['h264-qp26']
    expect(encodeOptionsFor('quantizer', true, preset)).toEqual({ keyFrame: true, avc: { quantizer: 26 } })
    expect(videoEncoderConfig(1280, 720, EXPORT_FPS, 'quantizer', preset).codec).toBe(avcLevelFor(1280, 720, EXPORT_FPS))
  })

  it('h264-qp29: H.264 at QP 29', () => {
    const preset = EXPORT_VIDEO_PRESETS['h264-qp29']
    expect(encodeOptionsFor('quantizer', true, preset)).toEqual({ keyFrame: true, avc: { quantizer: 29 } })
    expect(videoEncoderConfig(1280, 720, EXPORT_FPS, 'quantizer', preset).codec).toBe(avcLevelFor(1280, 720, EXPORT_FPS))
  })

  it('hevc-qp26: HEVC at QP 26, HEVC codec name, no avc sub-object', () => {
    const preset = EXPORT_VIDEO_PRESETS['hevc-qp26']
    const config = videoEncoderConfig(1280, 720, EXPORT_FPS, 'quantizer', preset)
    // 1280x720 = 921 600 samples, x30 = 27 648 000: below level 3.1's ceiling (L93).
    expect(config.codec).toBe('hvc1.1.6.L93.B0')
    expect(config.codec).toBe(hevcLevelFor(1280, 720, EXPORT_FPS))
    expect(config).toMatchObject({ width: 1280, height: 720, framerate: 30, bitrateMode: 'quantizer' })
    expect('avc' in config).toBe(false)
    expect('bitrate' in config).toBe(false)
    expect(encodeOptionsFor('quantizer', true, preset)).toEqual({ keyFrame: true, hevc: { quantizer: 26 } })
  })

  it('av1-q35: AV1 at quantizer 35, AV1 codec name, no avc sub-object', () => {
    const preset = EXPORT_VIDEO_PRESETS['av1-q35']
    const config = videoEncoderConfig(1280, 720, EXPORT_FPS, 'quantizer', preset)
    // 921 600 samples x30 = 27 648 000: below level 3.1's ceiling (LL 05).
    expect(config.codec).toBe('av01.0.05M.08')
    expect(config.codec).toBe(av1LevelFor(1280, 720, EXPORT_FPS))
    expect(config).toMatchObject({ width: 1280, height: 720, framerate: 30, bitrateMode: 'quantizer' })
    expect('avc' in config).toBe(false)
    expect(encodeOptionsFor('quantizer', true, preset)).toEqual({ keyFrame: true, av1: { quantizer: 35 } })
  })

  it('HEVC/AV1 levels follow the surface AND the rate, like H.264', () => {
    // The surface counts the FULL picture's luma samples (w*h), not half resolution.
    // 1080p60: 2 073 600 samples, x60 = 124 416 000: level 4.1 (HEVC L123 / AV1 LL 09).
    expect(hevcLevelFor(1920, 1080, 60)).toBe('hvc1.1.6.L123.B0')
    expect(av1LevelFor(1920, 1080, 60)).toBe('av01.0.09M.08')
    // 1080p30: 62 208 000 samples/s: level 4 (HEVC L120 / AV1 LL 08).
    expect(hevcLevelFor(1920, 1080, 30)).toBe('hvc1.1.6.L120.B0')
    expect(av1LevelFor(1920, 1080, 30)).toBe('av01.0.08M.08')
    // 1440p60: 3 732 480 samples, x60 = 223 948 800: level 5 (HEVC L150 / AV1 LL 12).
    expect(hevcLevelFor(2560, 1440, 60)).toBe('hvc1.1.6.L150.B0')
    expect(av1LevelFor(2560, 1440, 60)).toBe('av01.0.12M.08')
    // 2160p60: 8 294 400 samples, x60 = 497 664 000: level 5.1 (HEVC L153 / AV1 LL 13).
    expect(hevcLevelFor(3840, 2160, 60)).toBe('hvc1.1.6.L153.B0')
    expect(av1LevelFor(3840, 2160, 60)).toBe('av01.0.13M.08')
  })
})

describe('resolveExportPreset — the chain falls back to H.264', () => {
  // The fake probe refuses every non-H.264 codec.
  const onlyAvc = async (c: VideoEncoderConfig) => c.codec.startsWith('avc1')

  it('takes the HEVC when the probe accepts it', async () => {
    const resolved = await resolveExportPreset('hevc-qp26', 1280, 720, EXPORT_FPS, async (c) => c.codec.startsWith('hvc1'))
    expect(resolved?.preset.name).toBe('hevc-qp26')
    expect(resolved?.mode).toBe('quantizer')
  })

  it('falls back to h264-qp23 when the browser refuses HEVC', async () => {
    const resolved = await resolveExportPreset('hevc-qp26', 1280, 720, EXPORT_FPS, onlyAvc)
    expect(resolved?.preset.name).toBe('h264-qp23')
    expect(resolved?.preset.codec).toBe('avc')
    expect(resolved?.mode).toBe('quantizer')
  })

  it('takes the AV1 when the probe accepts it', async () => {
    const resolved = await resolveExportPreset('av1-q35', 1280, 720, EXPORT_FPS, async (c) => c.codec.startsWith('av01'))
    expect(resolved?.preset.name).toBe('av1-q35')
    expect(resolved?.mode).toBe('quantizer')
  })

  it('falls back to h264-qp23 when the browser refuses AV1', async () => {
    const resolved = await resolveExportPreset('av1-q35', 1280, 720, EXPORT_FPS, onlyAvc)
    expect(resolved?.preset.name).toBe('h264-qp23')
    expect(resolved?.preset.codec).toBe('avc')
  })

  it('the default preset keeps the H.264 rate-mode fallback: quantizer refused -> constant', async () => {
    const onlyConstant = async (c: VideoEncoderConfig) => (c.bitrateMode ?? 'variable') === 'constant'
    const resolved = await resolveExportPreset(EXPORT_VIDEO_PRESET, 1280, 720, EXPORT_FPS, onlyConstant)
    expect(resolved?.preset.name).toBe('h264-qp26')
    expect(resolved?.preset.codec).toBe('avc')
    expect(resolved?.mode).toBe('constant')
  })
})

describe('the fallback chain cannot loop', () => {
  it('every preset ends on an H.264, without revisiting a preset', () => {
    const names = Object.keys(EXPORT_VIDEO_PRESETS) as ExportVideoPresetName[]
    expect(names).toHaveLength(6)
    for (const name of names) {
      const seen = new Set<ExportVideoPresetName>()
      let current: ExportVideoPresetName | undefined = name
      let hops = 0
      while (current !== undefined) {
        expect(seen.has(current)).toBe(false)
        seen.add(current)
        const preset: ExportVideoPreset = EXPORT_VIDEO_PRESETS[current]
        if (preset.codec === 'avc') break // the chain stops on H.264
        current = preset.fallback
        hops += 1
        expect(hops).toBeLessThan(64)
      }
      const terminal = current !== undefined ? EXPORT_VIDEO_PRESETS[current] : undefined
      expect(terminal?.codec).toBe('avc')
    }
  })
})

describe('exportPresetNameFromRaw — the developer override never lies about the default', () => {
  it('a known name is passed through as is', () => {
    expect(exportPresetNameFromRaw('hevc-qp26')).toBe('hevc-qp26')
    expect(exportPresetNameFromRaw('av1-q35')).toBe('av1-q35')
  })

  it('an unknown name yields undefined: the caller keeps EXPORT_VIDEO_PRESET', () => {
    expect(exportPresetNameFromRaw('not-a-preset')).toBeUndefined()
    expect(exportPresetNameFromRaw('')).toBeUndefined()
  })

  it('an absent override yields undefined: the one-line default holds', () => {
    expect(exportPresetNameFromRaw(null)).toBeUndefined()
    expect(exportPresetNameFromRaw(undefined)).toBeUndefined()
  })
})
