// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayExportFileTarget.test.ts — LE CIBLE DU FICHIER D'EXPORT, testé sans navigateur.
 *
 * Deux familles de tests :
 *
 * 1. `ExportFileTarget` en isolation : on lui nourrit des `StreamTargetChunk` et on vérifie
 *    l'assemblage, le rabattage en `Blob`, les ecritures positionnees dans la tete, l'erreur
 *    sur une region deja rabattue, et le rejet par `abort`.
 *
 * 2. Un export MP4 SYNTHETIQUE (mediabunny, `fastStart: false`, paquets deja codés — aucune
 *    API WebCodecs requise). On prouve que le cible reproduce exactement ce que `BufferTarget`
 *    produirait, que la disposition est ftyp/mdat/moov avec la taille mdat patchee, et quelles
 *    positions mediabunny ecrit in place (seule l'en-tete mdat, tout au debut).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny'
import type { StreamTargetChunk, Target } from 'mediabunny'

import { ExportFileTarget, HEAD_BYTES } from './replayExportFileTarget'

/** Fabrique un chunk de `StreamTarget` pour nourrir le cible directement. */
const chunk = (position: number, data: Uint8Array<ArrayBuffer>): StreamTargetChunk => ({ type: 'write', data, position })

/** Lit les octets d'un `Blob`. */
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('ExportFileTarget — assemblage et rabattage', () => {
  it('assemble les appends dans l\'ordre', async () => {
    const t = new ExportFileTarget(64, 1024)
    t.write(chunk(0, new Uint8Array([1, 2, 3])))
    t.write(chunk(3, new Uint8Array([4, 5])))
    expect([...(await blobBytes(t.finish()))]).toEqual([1, 2, 3, 4, 5])
  })

  it('applique une ecriture positionnee dans la tete mutable', async () => {
    const t = new ExportFileTarget(64, 1024)
    t.write(chunk(0, new Uint8Array(10).fill(0)))
    t.write(chunk(2, new Uint8Array([9, 9])))
    const bytes = await blobBytes(t.finish())
    expect(bytes).toHaveLength(10)
    expect(bytes[1]).toBe(0)
    expect(bytes[2]).toBe(9)
    expect(bytes[3]).toBe(9)
    expect(bytes[4]).toBe(0)
  })

  it('rabattre les octets en Blob au-dela du seuil, sans en perdre un seul', async () => {
    // Tete de 16 o, parts de 8 o : 30 o ecrits forcent un rabattage.
    const t = new ExportFileTarget(16, 8)
    t.write(chunk(0, new Uint8Array(30).fill(7)))
    expect(t.partCount).toBe(1)
    const bytes = await blobBytes(t.finish())
    expect(bytes).toHaveLength(30)
    for (const b of bytes) expect(b).toBe(7)
  })

  it('leve pour une ecriture positionnee dans une region deja rabattue', () => {
    const t = new ExportFileTarget(16, 8)
    t.write(chunk(0, new Uint8Array(40).fill(0)))
    // La position 24 est hors de la tete (16) et tombe dans une part deja rabattue.
    expect(() => t.write(chunk(24, new Uint8Array([1])))).toThrow()
  })

  it('abort jette toutes les donnees collectees', async () => {
    const t = new ExportFileTarget(64, 8)
    t.write(chunk(0, new Uint8Array(40).fill(5)))
    t.abort()
    expect((await t.finish()).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Export MP4 synthetique : mediabunny, `fastStart: false`, paquets deja codés.
// ---------------------------------------------------------------------------

/** Un enregistrement AVCDecoderConfigurationRecord minimal (le muxer l'incruste tel quel). */
function minimalAvcC(): Uint8Array {
  const sps = [0x67, 0x42, 0xc0, 0x1e, 0xd9, 0x01, 0x40, 0x56]
  const pps = [0x68, 0xcb, 0x83, 0xcb]
  return new Uint8Array([
    0x01, 0x42, 0x00, 0x1e, 0xff,
    0xe1,
    (sps.length >> 8) & 0xff, sps.length & 0xff, ...sps,
    0xa1,
    (pps.length >> 8) & 0xff, pps.length & 0xff, ...pps,
  ])
}

const VIDEO_META = {
  decoderConfig: {
    codec: 'avc1.42C01F',
    codedWidth: 64,
    codedHeight: 64,
    description: minimalAvcC(),
  },
}

/** Muxe un court clip video synthetique dans le cible fourni. */
async function muxSynthetic(target: Target): Promise<void> {
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target })
  const video = new EncodedVideoPacketSource('avc')
  output.addVideoTrack(video, { frameRate: 30 })
  await output.start()
  const frames = 8
  for (let i = 0; i < frames; i++) {
    const data = new Uint8Array(64 + i)
    for (let j = 0; j < data.length; j++) data[j] = (i + j) & 0xff
    const packet = new EncodedPacket(data, i === 0 ? 'key' : 'delta', i / 30, 1 / 30, i)
    await video.add(packet, i === 0 ? (VIDEO_META as Parameters<typeof video.add>[1]) : undefined)
  }
  video.close()
  await output.finalize()
}

/** Le cible de production : `StreamTarget` vers notre `ExportFileTarget`. */
function streamTargetFor(fileTarget: ExportFileTarget, onChunk?: (c: StreamTargetChunk) => void): StreamTarget {
  return new StreamTarget(
    new WritableStream<StreamTargetChunk>({
      write: (c) => {
        onChunk?.(c)
        fileTarget.write(c)
      },
    }),
  )
}

/** Decoupe les boites de premier niveau d'un fichier ISOBMFF. */
function topLevelBoxes(bytes: Uint8Array): { type: string; start: number; size: number }[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const boxes: { type: string; start: number; size: number }[] = []
  let pos = 0
  while (pos + 8 <= bytes.length) {
    const size = dv.getUint32(pos)
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    boxes.push({ type, start: pos, size })
    if (size === 1) pos += Number(dv.getBigUint64(pos + 8))
    else if (size === 0) break
    else pos += size
  }
  return boxes
}

/**
 * `mediabunny` insere `creationTime = floor(Date.now()/1000)` dans mvhd/tkhd/mdhd : deux
 * sorties distinctes ne sont identiques qu'a l'instant fixe. On gele l'horloge pour que le
 * test de byte-a-byte soit deterministe.
 */
function withFrozenClock(fn: () => Promise<void>): Promise<void> {
  return (async () => {
    vi.useFakeTimers().setSystemTime(new Date('2020-01-01T00:00:00Z'))
    try {
      await fn()
    } finally {
      vi.useRealTimers()
    }
  })()
}

describe('ExportFileTarget vs BufferTarget — export synthetique', () => {
  it('produit des octets strictement identiques a un BufferTarget', () =>
    withFrozenClock(async () => {
      const reference = new BufferTarget()
      await muxSynthetic(reference)
      const referenceBytes = new Uint8Array(reference.buffer ?? new ArrayBuffer(0))

      const fileTarget = new ExportFileTarget()
      await muxSynthetic(streamTargetFor(fileTarget))
      const mine = await blobBytes(fileTarget.finish())

      expect(mine).toHaveLength(referenceBytes.length)
      expect(mine).toEqual(referenceBytes)
    }))

  it('dispose le fichier en ftyp, mdat, moov — taille mdat patchee', () =>
    withFrozenClock(async () => {
      const fileTarget = new ExportFileTarget()
      await muxSynthetic(streamTargetFor(fileTarget))
      const bytes = await blobBytes(fileTarget.finish())
      const boxes = topLevelBoxes(bytes)
      expect(boxes.map((b) => b.type)).toEqual(['ftyp', 'mdat', 'moov'])
      const mdat = boxes[1]
      const moov = boxes[2]
      // La taille declaree de mdat couvre exactement jusqu'au debut de moov : le patch a ete fait.
      expect(mdat.size).toBe(moov.start - mdat.start)
      expect(mdat.size).toBeGreaterThan(8)
    }))

  it('mediabunny ne reecrit in place que l\'en-tete mdat, tout au debut du fichier', () =>
    withFrozenClock(async () => {
      const writes: { position: number; length: number; inPlace: boolean }[] = []
      let end = 0
      const fileTarget = new ExportFileTarget()
      await muxSynthetic(
        streamTargetFor(fileTarget, (c) => {
          writes.push({ position: c.position, length: c.data.byteLength, inPlace: c.position !== end })
          end = Math.max(end, c.position + c.data.byteLength)
        }),
      )
      const bytes = await blobBytes(fileTarget.finish())
      const ftypSize = topLevelBoxes(bytes)[0].size

      const inPlace = writes.filter((w) => w.inPlace)
      // Un seul passage in place : le patch de l'en-tete mdat, juste apres ftyp.
      expect(inPlace).toHaveLength(1)
      const patch = inPlace[0]
      expect(patch.position).toBe(ftypSize)
      expect(patch.position).toBeLessThan(HEAD_BYTES)
      // Fichier de quelques Ko : taille 32 bits, patch de 8 octets.
      expect(patch.length).toBe(8)
    }))
})
