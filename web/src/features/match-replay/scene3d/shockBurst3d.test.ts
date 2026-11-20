// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests: a Shock Rifle pull's three rounds from the film's shot records (one record per round, some
 * missing) at the tag's 60 rounds a second, and the damages they pair with; the records and damages
 * are match 9220185c's (slot 553, the demo-9 kill and its other pulls).
 */
import { describe, expect, it } from 'vitest'

import type { ShotFxEntry } from '../model/shotFx'
import { aimAt, burstHits, groupBursts, roundFrames, type BurstDamage } from './shockBurst3d'

const MS = 33
const SPEC = { shots: 3, roundsPerSecond: 60 }

/** A shot record at frame `t` and `o` ms into it. */
const rec = (t: number, o = 0, h = 87.8): ShotFxEntry => ({ frame: t, time: t + o / MS, slot: 553, x: 0, y: 0, h, fam: 'shock', tint: 'electric', seed: t + 553, vehicleShot: null }) as unknown as ShotFxEntry
const dmg = (t: number, slot = 562): BurstDamage => ({ t, slot, by: 553 })

describe('groupBursts', () => {
  it('spaces a pull\'s rounds 1/60 s apart', () => {
    expect(roundFrames(SPEC, MS)).toBeCloseTo(1000 / 60 / 33)
  })

  it('places the demo-9 kill\'s missing middle round between its two records', () => {
    const a = rec(7684, 30)
    const c = rec(7686)
    const [b] = groupBursts([a, c], SPEC, MS)
    expect(b.leader).toBe(a)
    expect(b.rounds.map((r) => r.e)).toEqual([a, null, c])
    expect(b.rounds[1].time).toBeCloseTo(7684 + 30 / 33 + 1000 / 60 / 33)
  })

  it('keeps three records of a pull at their own times, and the next pull apart', () => {
    // 7147+15, 7147+31, 7148+18, then 7226+12 (2.6 s later).
    const list = [rec(7147, 15), rec(7147, 31), rec(7148, 18), rec(7226, 12)]
    const bursts = groupBursts(list, SPEC, MS)
    expect(bursts).toHaveLength(2)
    expect(bursts[0].rounds.map((r) => r.e)).toEqual(list.slice(0, 3))
    expect(bursts[1].rounds.map((r) => r.e)).toEqual([list[3], null, null])
    // One record alone (7780+22): its two other rounds follow it at the tag's rate.
    expect(bursts[1].rounds[2].time - bursts[1].rounds[0].time).toBeCloseTo(2 * 1000 / 60 / 33)
  })

  it('starts a new pull past the last round, and gives a collided rank the next free one', () => {
    const [p, q] = groupBursts([rec(100, 0), rec(100, 2), rec(101, 30)], SPEC, MS)
    expect(p.rounds.map((r) => r.e?.time)).toEqual([100, 100 + 2 / 33, null].map((v) => v ?? undefined))
    expect(q.leader.time).toBeCloseTo(101 + 30 / 33)
  })
})

describe('burstHits', () => {
  it('pairs each round of the demo-9 kill with one of its three damages, in order', () => {
    const [b] = groupBursts([rec(7684, 30), rec(7686)], SPEC, MS)
    expect(burstHits(b, [dmg(7684), dmg(7685), dmg(7686)])).toEqual([
      { victim: 562, frame: 7684 }, { victim: 562, frame: 7685 }, { victim: 562, frame: 7686 },
    ])
  })

  it('leaves a round with no damage of its frame or the next a miss, and uses each damage once', () => {
    // 7258+25, 7259+9, 7259+23 with damages at 7258 and 7259: the third round missed.
    const [b] = groupBursts([rec(7258, 25), rec(7259, 9), rec(7259, 23)], SPEC, MS)
    expect(burstHits(b, [dmg(7258, 564), dmg(7259, 564)])).toEqual([{ victim: 564, frame: 7258 }, { victim: 564, frame: 7259 }, null])
    // A self-inflicted damage is no round's hit.
    expect(burstHits(b, [{ t: 7258, slot: 553, by: 553 }])).toEqual([null, null, null])
  })
})

describe('aimAt', () => {
  it('interpolates a missing round\'s aim between its neighbours by rank, the short way round', () => {
    const [b] = groupBursts([rec(500, 0, 350), rec(501, 0, 10)], SPEC, MS)
    const aim = (e: ShotFxEntry) => ({ h: e.h ?? 0, p: e.frame === 500 ? -2 : -4 })
    expect(b.rounds.map((r) => r.e !== null)).toEqual([true, false, true])
    const a = aimAt(b, 1, aim)!
    expect(((a.h % 360) + 360) % 360).toBeCloseTo(0)
    expect(a.p).toBeCloseTo(-3)
    // Past the last record: its aim.
    const [one] = groupBursts([rec(600, 0, 42)], SPEC, MS)
    expect(aimAt(one, 2, aim)).toEqual({ h: 42, p: -4 })
  })
})
