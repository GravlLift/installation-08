// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * fireBurstSound.test.ts — the continuous-fire burst's place and level for the owner's listening
 * note (2026-11-16): another shooter's burst must carry a position AND `OTHER_SHOOTER_GAIN_DB`,
 * the followed player's own burst must stay without a place and without that offset.
 */
import { describe, expect, it } from 'vitest'

import type { ReplayDocument } from '@/lib/api/types'
import { testReplayDoc } from '../test/testDoc'
import { fireBurstSoundEvents, OTHER_SHOOTER_GAIN_DB } from './fireBurstSound'

const FPS = 30
const stemOf = () => 'hinf_ma40_ar'

/** Two shooters: A at the origin (slot 1), B ten map units away (slot 2). Rate under the beam
 *  threshold and no vehicle loop, so every burst takes the per-shot "cut to the rate" path. */
function doc(over: Partial<ReplayDocument> = {}) {
  return testReplayDoc({
    frameIntervalMs: 1000 / FPS,
    frameCount: 61,
    tracks: [
      { slot: 1, team: 0, xuid: 'A', startFrame: 0, endFrame: 60, points: [{ t: 0, x: 0, y: 0, h: 0 }] },
      { slot: 2, team: 1, xuid: 'B', startFrame: 0, endFrame: 60, points: [{ t: 0, x: 10, y: 0, h: 0 }] },
    ],
    bursts: [
      { w: '0x1', slot: 1, t0: 0, t1: 0, rate: 10, b0: 'held', b1: 'held' },
      { w: '0x1', slot: 2, t0: 0, t1: 0, rate: 10, b0: 'held', b1: 'held' },
    ],
    ...over,
  })
}

describe('fireBurstSoundEvents', () => {
  it('without a followed player, every burst carries its shooter\'s position', () => {
    const events = fireBurstSoundEvents(doc(), stemOf, null)
    expect(events.every((e) => e.at !== undefined)).toBe(true)
    expect(events.every((e) => e.gainDb === OTHER_SHOOTER_GAIN_DB)).toBe(true)
  })

  it("the followed player's own burst has no place and no other-shooter offset", () => {
    const events = fireBurstSoundEvents(doc(), stemOf, 'A')
    const mine = events.filter((e) => e.stem === 'hinf_ma40_ar' && e.ms === 0)
    // Both slots fire at t0=0; split by presence of a place to tell them apart.
    const own = mine.filter((e) => e.at === undefined)
    const other = mine.filter((e) => e.at !== undefined)
    expect(own.length).toBeGreaterThan(0)
    expect(other.length).toBeGreaterThan(0)
    for (const e of own) expect(e.gainDb).toBeUndefined()
    for (const e of other) expect(e.gainDb).toBe(OTHER_SHOOTER_GAIN_DB)
  })
})
