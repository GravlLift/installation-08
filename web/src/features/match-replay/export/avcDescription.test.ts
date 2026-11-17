/**
 * avcDescription.test.ts — the `avcC` repair, on the bytes Firefox 142 really produced
 * (2026-11-16, 1280x720 at 60 fps, `avc1.640020`): a description with doubled NAL header bytes, and
 * the first key chunk that carries the correct sets in band.
 */
import { describe, expect, it } from 'vitest'

import { buildAvcDescription, inBandParameterSets, parseAvcDescription, repairAvcDescription } from './avcDescription'

const hex = (s: string) => Uint8Array.from(s.trim().split(/\s+/).map((b) => parseInt(b, 16)))

const SPS = hex('67 64 00 20 ac 2c ac 05 00 5b a1 00 00 03 00 01 00 00 03 00 78 0d a0 88 45 38')
const PPS = hex('68 ce 3c 30')
/** Firefox's description: SPS and PPS with their header byte twice, reserved bits zero. */
const FIREFOX_DESCRIPTION = hex(
  '01 64 00 20 03 01 00 1b 67 67 64 00 20 ac 2c ac 05 00 5b a1 00 00 03 00 01 00 00 03 00 78 0d a0 88 45 38 01 00 05 68 68 ce 3c 30',
)
/** The head of Firefox's first key chunk: AUD, SPS, PPS, then a slice (truncated here). */
const FIREFOX_KEY_CHUNK = hex(
  '00 00 00 02 09 10 00 00 00 1a 67 64 00 20 ac 2c ac 05 00 5b a1 00 00 03 00 01 00 00 03 00 78 0d a0 88 45 38 00 00 00 04 68 ce 3c 30 00 00 00 03 65 88 84',
)

describe('repairAvcDescription', () => {
  it('rebuilds Firefox’s malformed description from the key chunk’s in-band sets', () => {
    const fixed = repairAvcDescription(FIREFOX_DESCRIPTION, FIREFOX_KEY_CHUNK)
    expect(fixed).not.toBeNull()
    const rec = parseAvcDescription(fixed!)
    expect(rec?.sps).toEqual([SPS])
    expect(rec?.pps).toEqual([PPS])
    expect(rec?.lengthSize).toBe(4)
    // Profile, compatibility and level come from the SPS; the reserved bits are set.
    expect([...fixed!.slice(0, 6)]).toEqual([0x01, 0x64, 0x00, 0x20, 0xff, 0xe1])
  })

  it('without in-band sets, drops the doubled header byte instead', () => {
    const fixed = repairAvcDescription(FIREFOX_DESCRIPTION, hex('00 00 00 03 65 88 84'))
    const rec = parseAvcDescription(fixed!)
    expect(rec?.sps).toEqual([SPS])
    expect(rec?.pps).toEqual([PPS])
  })

  it('leaves a well-formed description (Chrome’s shape) alone', () => {
    const good = buildAvcDescription([SPS], [PPS])
    expect(repairAvcDescription(good, FIREFOX_KEY_CHUNK)).toBeNull()
  })

  it('reads the in-band sets of a length-prefixed chunk, and stops on a broken length', () => {
    expect(inBandParameterSets(FIREFOX_KEY_CHUNK, 4)).toEqual({ sps: [SPS], pps: [PPS] })
    expect(inBandParameterSets(hex('00 00 ff ff 67 64'), 4)).toEqual({ sps: [], pps: [] })
  })
})
