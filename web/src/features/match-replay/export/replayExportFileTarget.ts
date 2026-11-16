/**
 * replayExportFileTarget.ts — WHERE THE EXPORT'S BYTES LAND, and nothing else.
 *
 * A full match at constant quality can be several GB, and one ArrayBuffer cannot hold
 * that: the old export kept the whole file in a single `BufferTarget` and failed at the
 * end with a size error after rendering the entire match. Here the bytes stream in as
 * they are written and are folded into ~64 MB `Blob` parts as they accumulate. A Blob
 * made of Blobs lets the browser keep the large data off the JS heap, so a multi-GB
 * export no longer needs a multi-GB heap allocation.
 *
 * # WHY A HEAD BUFFER
 *
 * mediabunny writes a plain MP4 (`fastStart: false`) in three moves:
 *   1. at start: the ftyp box, then an mdat header whose size field is only a
 *      placeholder (the real size is unknown until the end);
 *   2. the media data, appended in order;
 *   3. at finalize: one positioned write that patches the mdat header near the start
 *      of the file (8 bytes; 16 when the file is 4 GiB+ and a 64-bit size is used),
 *      then the moov box appended at the end.
 *
 * The first `HEAD_BYTES` of the file therefore stay in one mutable buffer until
 * `finish()`: that is what makes the step-3 patch legal. A positioned write that
 * lands in an already-folded region can never be honored and throws, loudly.
 */
import type { StreamTargetChunk } from 'mediabunny'

/**
 * Bytes of file head kept mutable until finish. The only positioned write a plain MP4
 * does is the mdat header patch, which lands right after ftyp (tens of bytes in); a
 * megabyte of head is orders of magnitude more than enough.
 */
export const HEAD_BYTES = 1024 * 1024

/** Size of each folded Blob part. */
export const PART_BYTES = 64 * 1024 * 1024

/**
 * Collects the bytes of the exported file as mediabunny's `StreamTarget` delivers
 * them, and hands back the final `Blob`.
 *
 * Layout: the first `headBytes` stay in one mutable buffer; everything after it is
 * folded into `Blob` parts of at most `partBytes` each. Only appends and writes into
 * the still-mutable head are legal; anything else throws.
 */
export class ExportFileTarget {
  private head: Uint8Array<ArrayBuffer>
  private headEnd = 0
  private parts: Blob[] = []
  private current: Uint8Array<ArrayBuffer>
  private currentEnd = 0
  /** Next append position in the file. */
  private end = 0

  constructor(headBytes = HEAD_BYTES, partBytes = PART_BYTES) {
    this.head = new Uint8Array(headBytes)
    this.current = new Uint8Array(partBytes)
  }

  /**
   * Applies one write from mediabunny's `StreamTarget`. Appends extend the file;
   * positioned writes may only overwrite bytes that are still in the mutable head.
   * Anything else is a contract violation and throws.
   */
  write(chunk: StreamTargetChunk): void {
    const { data, position } = chunk
    if (position === this.end) {
      this.append(data)
    } else if (position < this.head.byteLength && position + data.byteLength <= this.headEnd) {
      this.head.set(data, position)
    } else {
      throw new Error(
        `export file target: positioned write at ${position} (length ${data.byteLength}) is neither an append `
        + `(file ends at ${this.end}) nor a patch inside the mutable ${this.head.byteLength}-byte head. `
        + 'The MP4 writer wrote back over a region that was already folded into a Blob part.',
      )
    }
  }

  /** Number of parts already folded into Blobs (the seam the tests check). */
  get partCount(): number {
    return this.parts.length
  }

  private append(data: Uint8Array): void {
    let offset = 0
    while (offset < data.byteLength) {
      let n: number
      if (this.end < this.head.byteLength) {
        n = Math.min(this.head.byteLength - this.headEnd, data.byteLength - offset)
        this.head.set(data.subarray(offset, offset + n), this.headEnd)
        this.headEnd += n
      } else {
        n = Math.min(this.current.byteLength - this.currentEnd, data.byteLength - offset)
        this.current.set(data.subarray(offset, offset + n), this.currentEnd)
        this.currentEnd += n
        if (this.currentEnd === this.current.byteLength) this.foldCurrent()
      }
      this.end += n
      offset += n
    }
  }

  /** Folds the full current buffer into a Blob and starts a fresh one. */
  private foldCurrent(): void {
    this.parts.push(new Blob([this.current], { type: 'video/mp4' }))
    this.current = new Uint8Array(this.current.byteLength)
    this.currentEnd = 0
  }

  /** The final file: the head, then the folded parts, then the un-folded tail. */
  finish(): Blob {
    const parts: BlobPart[] = [this.head.subarray(0, this.headEnd), ...this.parts]
    if (this.currentEnd > 0) parts.push(this.current.subarray(0, this.currentEnd))
    return new Blob(parts, { type: 'video/mp4' })
  }

  /** Cancels the export: drops everything collected so far. */
  abort(): void {
    this.parts = []
    this.current = new Uint8Array(this.current.byteLength)
    this.currentEnd = 0
    this.headEnd = 0
    this.end = 0
  }
}
