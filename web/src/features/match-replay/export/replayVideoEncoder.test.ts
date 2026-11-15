/**
 * replayVideoEncoder.test.ts — LES DÉCISIONS DE L'ENCODEUR, testées sans navigateur.
 *
 * Ce qui est testé ici ne dépend d'AUCUNE API WebCodecs : ce sont les quatre calculs qui
 * décident du fichier (dimensions paires, niveau H.264, débit, contre-pression). L'ouverture
 * réelle de l'encodeur, elle, n'a rien à faire sous jsdom — elle se vérifie dans le navigateur,
 * et c'est le gate manuel de l'étape E1 du plan.
 */
import { describe, expect, it } from 'vitest'

import {
  ENCODE_QUEUE_MAX,
  EXPORT_FPS,
  EXPORT_FPS_3D,
  EXPORT_QP,
  KEYFRAME_EVERY,
  avcLevelFor,
  canExportVideo,
  chooseExportFps,
  chooseExportRateMode,
  encodeOptionsFor,
  evenSize,
  frameDurationUs,
  frameTimestampUs,
  isKeyFrame,
  shouldDrain,
  videoBitrate,
  videoEncoderConfig,
} from './replayVideoEncoder'
import type { ExportRateMode } from './replayVideoEncoder'

describe('evenSize — H.264 refuse les dimensions impaires', () => {
  it('laisse un nombre pair intact', () => {
    expect(evenSize(1280)).toBe(1280)
  })

  it('arrondit VERS LE BAS, jamais vers le haut', () => {
    // Rogner une colonne est invisible ; étirer l'image d'un pixel ne l'est pas.
    expect(evenSize(1281)).toBe(1280)
  })

  it('tronque une largeur fractionnaire (toile à DPR non entier)', () => {
    expect(evenSize(1439.7)).toBe(1438)
  })

  it('remonte à 2 tout ce qui n’a pas de sens pour un encodeur', () => {
    expect(evenSize(0)).toBe(2)
    expect(evenSize(-40)).toBe(2)
    expect(evenSize(Number.NaN)).toBe(2)
  })
})

describe('avcLevelFor — le PLUS BAS niveau qui accepte l’image', () => {
  it('720p à 30 im/s tient au niveau 3.1', () => {
    // 80x45 macroblocs = 3600 FS, soit exactement le plafond du niveau 3.1.
    expect(avcLevelFor(1280, 720, 30)).toBe('avc1.64001f')
  })

  it('1080p à 30 im/s monte au niveau 4.0', () => {
    expect(avcLevelFor(1920, 1080, 30)).toBe('avc1.640028')
  })

  it('la CADENCE compte autant que la surface', () => {
    // Même image qu'au-dessus : à 60 im/s le débit de macroblocs dépasse le niveau 4.0.
    expect(avcLevelFor(1920, 1080, 60)).toBe('avc1.64002a')
  })

  it('une toile démesurée rend le niveau le plus haut plutôt que rien', () => {
    expect(avcLevelFor(16_000, 16_000, 30)).toBe('avc1.64003c')
  })
})

describe('videoBitrate — borné aux deux bouts', () => {
  it('une petite toile ne descend pas sous le plancher', () => {
    // 320x180x30x0.25 = 432 000 b/s : le texte du HUD y baverait.
    expect(videoBitrate(320, 180, 30)).toBe(2_000_000)
  })

  it('une toile courante suit la surface', () => {
    expect(videoBitrate(1280, 720, 30)).toBe(6_912_000)
  })

  it('une toile démesurée ne dépasse pas le plafond', () => {
    expect(videoBitrate(7680, 4320, 60)).toBe(80_000_000)
  })
})

describe('videoEncoderConfig — ce qu’on présente au navigateur', () => {
  it('assemble codec, dimensions paires, cadence et débit (le mode variable est le repli)', () => {
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

  it('la cadence par défaut est celle de l’export', () => {
    expect(videoEncoderConfig(640, 360).framerate).toBe(30)
  })

  it('le mode quantizer demande la qualité, pas le débit', () => {
    // Pas de `bitrate` : en mode quantizer, le QP EST le réglage, et le demander aussi
    // ferait ment la console sur ce qui est demandé à l'encodeur.
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

  it('le mode constant vise le même débit borné que variable', () => {
    const config = videoEncoderConfig(1280, 720, EXPORT_FPS, 'constant')
    expect(config.bitrateMode).toBe('constant')
    expect(config.bitrate).toBe(videoBitrate(1280, 720, EXPORT_FPS))
  })
})

describe('chooseExportRateMode — la sonde décide, rien n’est supposé', () => {
  // La sonde fake lit le mode de la config qu'on lui présente : c'est elle qui décide.
  const probeFor = (supported: ExportRateMode[]) => async (c: VideoEncoderConfig) =>
    supported.includes((c.bitrateMode ?? 'variable') as ExportRateMode)

  it("prend le quantizer quand la sonde l'accepte", async () => {
    expect(await chooseExportRateMode(1920, 1080, 60, probeFor(['quantizer', 'constant', 'variable']))).toBe('quantizer')
  })

  it('prend le constant quand seul lui est accepté', async () => {
    expect(await chooseExportRateMode(1920, 1080, 60, probeFor(['constant', 'variable']))).toBe('constant')
  })

  it("retombe sur le variable quand rien d'autre ne l'est", async () => {
    expect(await chooseExportRateMode(1920, 1080, 60, probeFor(['variable']))).toBe('variable')
  })

  it('ne sonde pas le constant quand le quantizer est déjà accepté', async () => {
    const asked: string[] = []
    const fps = await chooseExportFps(1920, 1080, 60, 30, async (c) => {
      asked.push(`${c.bitrateMode ?? 'variable'}@${c.framerate}`)
      return true
    }, 'quantizer')
    expect(fps).toBe(60)
    expect(asked).toEqual(['quantizer@60'])
  })
})

describe('encodeOptionsFor — le QP ne voyage que dans le mode quantizer', () => {
  it('porte avc.quantizer dans le mode quantizer, image-clé et autres images de même', () => {
    expect(encodeOptionsFor('quantizer', true)).toEqual({ keyFrame: true, avc: { quantizer: EXPORT_QP } })
    expect(encodeOptionsFor('quantizer', false)).toEqual({ keyFrame: false, avc: { quantizer: EXPORT_QP } })
  })

  it('ne porte que la clé dans les modes de débit : le QP serait ignoré, et la console mentirait', () => {
    expect(encodeOptionsFor('constant', true)).toEqual({ keyFrame: true })
    expect(encodeOptionsFor('variable', false)).toEqual({ keyFrame: false })
  })
})

describe('contre-pression et images-clés', () => {
  it('n’attend pas tant que la file reste sous le seuil', () => {
    expect(shouldDrain(0)).toBe(false)
    expect(shouldDrain(ENCODE_QUEUE_MAX)).toBe(false)
  })

  it('attend dès que la file dépasse le seuil', () => {
    // Sans cette attente, un match de dix minutes empile 18 000 images et l'onglet meurt.
    expect(shouldDrain(ENCODE_QUEUE_MAX + 1)).toBe(true)
  })

  it('ouvre le clip sur une image-clé, puis une toutes les 2 secondes', () => {
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

describe('canExportVideo — la capacité du navigateur', () => {
  it('rend false là où WebCodecs n’existe pas (jsdom)', () => {
    // C'est ce qui fait retomber l'UI sur l'enregistreur temps réel (décision D5 du plan).
    expect(canExportVideo()).toBe(false)
  })
})
