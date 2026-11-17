/**
 * avcDescription.ts — checking, and repairing, the H.264 decoder configuration (`avcC`) a browser's
 * `VideoEncoder` hands out, before it is written into the MP4.
 *
 * # WHY
 *
 * Firefox 142 on Windows (checked 2026-11-16, every rate mode) gives a `decoderConfig.description`
 * whose parameter sets carry their NAL header byte TWICE: the SPS reads `67 67 64 00 20 ...` with a
 * length one byte too long, the PPS `68 68 ce 3c 30`, and the reserved bits are zero. The key
 * chunks themselves carry the correct sets in band (`67 64 00 20 ...`, `68 ce 3c 30`). Written as
 * is, the file's `avcC` is malformed: ffmpeg recovers from the in-band sets with "sps_id out of
 * range" and "too many reference frames" errors, and a player that configures its decoder from the
 * `avcC` alone (the usual way) may refuse the file or show garbage.
 *
 * # WHAT
 *
 * `repairAvcDescription` leaves a well-formed description alone (Chrome's). A description whose SPS
 * does not start with an SPS header followed by the profile byte (ISO/IEC 14496-15: the record's
 * `AVCProfileIndication` IS the SPS `profile_idc`) is rebuilt from the key chunk's in-band SPS and
 * PPS, or, when the chunk has none, from its own sets with the doubled header byte dropped.
 */

/** The parts of an `AVCDecoderConfigurationRecord` this module reads and writes. */
interface AvcRecord {
  lengthSize: number
  sps: Uint8Array[]
  pps: Uint8Array[]
}

const NAL_SPS = 7
const NAL_PPS = 8

/** Parses the record; `null` when it is too short or its lengths run past its end. */
export function parseAvcDescription(d: Uint8Array): AvcRecord | null {
  if (d.length < 7 || d[0] !== 1) return null
  const lengthSize = (d[4] & 0x03) + 1
  let p = 5
  const sets = (count: number): Uint8Array[] | null => {
    const out: Uint8Array[] = []
    for (let i = 0; i < count; i++) {
      if (p + 2 > d.length) return null
      const n = (d[p] << 8) | d[p + 1]
      p += 2
      if (p + n > d.length) return null
      out.push(d.slice(p, p + n))
      p += n
    }
    return out
  }
  const sps = sets(d[p++] & 0x1f)
  if (!sps || p >= d.length) return null
  const pps = sets(d[p++])
  if (!pps) return null
  return { lengthSize, sps, pps }
}

/** Builds a record from parameter sets (no high-profile extension, as the browsers' own). */
export function buildAvcDescription(sps: readonly Uint8Array[], pps: readonly Uint8Array[], lengthSize = 4): Uint8Array {
  const first = sps[0]
  const bytes: number[] = [1, first[1], first[2], first[3], 0xfc | (lengthSize - 1), 0xe0 | sps.length]
  for (const s of sps) bytes.push(s.length >> 8, s.length & 0xff, ...s)
  bytes.push(pps.length)
  for (const s of pps) bytes.push(s.length >> 8, s.length & 0xff, ...s)
  return Uint8Array.from(bytes)
}

/** True when every SPS starts with an SPS header followed by the record's profile byte. */
function wellFormed(d: Uint8Array, rec: AvcRecord): boolean {
  if (rec.sps.length === 0 || rec.pps.length === 0) return false
  return rec.sps.every((s) => s.length >= 4 && (s[0] & 0x1f) === NAL_SPS && s[1] === d[1])
    && rec.pps.every((s) => s.length >= 2 && (s[0] & 0x1f) === NAL_PPS)
}

/** The SPS and PPS a length-prefixed (`avc` format) chunk carries in band, first of each kind. */
export function inBandParameterSets(chunk: Uint8Array, lengthSize: number): { sps: Uint8Array[]; pps: Uint8Array[] } {
  const sps: Uint8Array[] = []
  const pps: Uint8Array[] = []
  for (let p = 0; p + lengthSize <= chunk.length; ) {
    let n = 0
    for (let i = 0; i < lengthSize; i++) n = n * 256 + chunk[p + i]
    p += lengthSize
    if (n === 0 || p + n > chunk.length) break
    const type = chunk[p] & 0x1f
    if (type === NAL_SPS && sps.length === 0) sps.push(chunk.slice(p, p + n))
    if (type === NAL_PPS && pps.length === 0) pps.push(chunk.slice(p, p + n))
    p += n
  }
  return { sps, pps }
}

/**
 * repairAvcDescription returns the description to write: `null` when `description` is fine as it
 * is, else a rebuilt one (see the header). `keyChunk` is the data of the key chunk it came with.
 */
export function repairAvcDescription(description: Uint8Array, keyChunk: Uint8Array): Uint8Array | null {
  const rec = parseAvcDescription(description)
  if (rec && wellFormed(description, rec)) return null
  const lengthSize = rec?.lengthSize ?? 4
  const inBand = inBandParameterSets(keyChunk, lengthSize)
  if (inBand.sps.length > 0 && inBand.pps.length > 0) return buildAvcDescription(inBand.sps, inBand.pps, lengthSize)
  if (!rec) return null
  // No in-band sets: drop a doubled NAL header byte, the defect seen in Firefox.
  const undouble = (s: Uint8Array) => (s.length > 1 && s[0] === s[1] ? s.slice(1) : s)
  const fixed = { sps: rec.sps.map(undouble), pps: rec.pps.map(undouble) }
  const rebuilt = buildAvcDescription(fixed.sps, fixed.pps, lengthSize)
  const check = parseAvcDescription(rebuilt)
  return check && wellFormed(rebuilt, check) ? rebuilt : null
}
