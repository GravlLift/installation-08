// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayExportFileTarget.test.ts — THE EXPORT FILE'S TARGET, tested without a browser.
 *
 * Two families of tests:
 *
 * 1. `ExportFileTarget` in isolation: it is fed `StreamTargetChunk`s, and we verify the
 *    assembly, the flush into a `Blob`, positioned writes into the head, the error on a
 *    region already flushed, and the rejection via `abort`.
 *
 * 2. A SYNTHETIC MP4 export (mediabunny, `fastStart: false`, already-encoded packets — no
 *    WebCodecs API required). We prove the target reproduces exactly what `BufferTarget`
 *    would produce, that the layout is ftyp/mdat/moov with the mdat size patched, and which
 *    positions mediabunny writes in place (only the mdat header, right at the start).
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

/** Builds a `StreamTarget` chunk to feed the target directly. */
const chunk = (position: number, data: Uint8Array<ArrayBuffer>): StreamTargetChunk => ({ type: 'write', data, position })

/** Reads a `Blob`'s bytes. */
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('ExportFileTarget — assembly and flushing', () => {
  it('assembles appends in order', async () => {
    const t = new ExportFileTarget(64, 1024)
    t.write(chunk(0, new Uint8Array([1, 2, 3])))
    t.write(chunk(3, new Uint8Array([4, 5])))
    expect([...(await blobBytes(t.finish()))]).toEqual([1, 2, 3, 4, 5])
  })

  it('applies a positioned write inside the mutable head', async () => {
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

  it('flushes bytes into a Blob past the threshold, without losing a single one', async () => {
    // 16-byte head, 8-byte parts: 30 bytes written force a flush.
    const t = new ExportFileTarget(16, 8)
    t.write(chunk(0, new Uint8Array(30).fill(7)))
    expect(t.partCount).toBe(1)
    const bytes = await blobBytes(t.finish())
    expect(bytes).toHaveLength(30)
    for (const b of bytes) expect(b).toBe(7)
  })

  it('throws for a positioned write inside a region already flushed', () => {
    const t = new ExportFileTarget(16, 8)
    t.write(chunk(0, new Uint8Array(40).fill(0)))
    // Position 24 is past the head (16) and falls inside a part already flushed.
    expect(() => t.write(chunk(24, new Uint8Array([1])))).toThrow()
  })

  it('abort discards all collected data', async () => {
    const t = new ExportFileTarget(64, 8)
    t.write(chunk(0, new Uint8Array(40).fill(5)))
    t.abort()
    expect((await t.finish()).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Synthetic MP4 export: mediabunny, `fastStart: false`, already-encoded packets.
// ---------------------------------------------------------------------------

/** A minimal AVCDecoderConfigurationRecord (the muxer embeds it as is). */
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

/** Muxes a short synthetic video clip into the given target. */
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

/** The production target: a `StreamTarget` wired to our `ExportFileTarget`. */
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

/** Splits an ISOBMFF file's top-level boxes. */
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
 * `mediabunny` inserts `creationTime = floor(Date.now()/1000)` into mvhd/tkhd/mdhd: two
 * distinct runs are only identical at a fixed instant. The clock is frozen so the
 * byte-for-byte test is deterministic.
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

describe('ExportFileTarget vs BufferTarget — synthetic export', () => {
  it('produces bytes strictly identical to a BufferTarget', () =>
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

  it('lays out the file as ftyp, mdat, moov — mdat size patched', () =>
    withFrozenClock(async () => {
      const fileTarget = new ExportFileTarget()
      await muxSynthetic(streamTargetFor(fileTarget))
      const bytes = await blobBytes(fileTarget.finish())
      const boxes = topLevelBoxes(bytes)
      expect(boxes.map((b) => b.type)).toEqual(['ftyp', 'mdat', 'moov'])
      const mdat = boxes[1]
      const moov = boxes[2]
      // mdat's declared size covers exactly up to the start of moov: the patch was applied.
      expect(mdat.size).toBe(moov.start - mdat.start)
      expect(mdat.size).toBeGreaterThan(8)
    }))

  it('mediabunny rewrites in place only the mdat header, right at the start of the file', () =>
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
      // A single in-place pass: the mdat header patch, right after ftyp.
      expect(inPlace).toHaveLength(1)
      const patch = inPlace[0]
      expect(patch.position).toBe(ftypSize)
      expect(patch.position).toBeLessThan(HEAD_BYTES)
      // A file of a few KB: 32-bit size, an 8-byte patch.
      expect(patch.length).toBe(8)
    }))
})
