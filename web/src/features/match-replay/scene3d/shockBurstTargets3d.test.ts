// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests: the demo-9 kill's pull (match 9220185c: Rekkles, slot 553, kills Luciid, slot 562, by a
 * headshot) groups its two records into one pull of three rounds, pairs them with the three damages
 * and lands all three on the victim's head; the same pull without the headshot lands on the body.
 */
import { describe, expect, it } from 'vitest'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import type { ShotFxEntry } from '../model/shotFx'
import type { ActionContext } from './actionScene3d'
import { BODY_CENTER, EYE_HEIGHT } from './body3d'
import { buildBursts, HEAD_RADIUS } from './shockBurstTargets3d'
import type { PlayerState3d } from './tracks3d'

const MS = 33
const rec = (t: number, o = 0): ShotFxEntry => ({ frame: t, time: t + o / MS, slot: 553, x: 26.44, y: -9.8, h: 87.8, fam: 'shock', tint: 'electric', seed: t + 553, vehicleShot: null }) as unknown as ShotFxEntry

function ctxOf(headshot: boolean) {
  const doc = {
    frameIntervalMs: MS,
    tracks: [
      { slot: 553, xuid: 'rekkles', startFrame: 7000, endFrame: 9000, points: [] },
      { slot: 562, xuid: 'luciid', startFrame: 6663, endFrame: 7685, points: [] },
    ],
    damages: [{ t: 7684, slot: 562, by: 553 }, { t: 7685, slot: 562, by: 553 }, { t: 7686, slot: 562, by: 553 }],
  } as unknown as ReplayDocumentReady
  const state = (x: number, y: number, z: number): PlayerState3d => ({ x, y, z, h: 0, p: 0, dropOeil: 0, crouch: false, slot: 0 }) as unknown as PlayerState3d
  const ctx = {
    doc,
    originAboveFloor: 0,
    slotState: (slot: number, f: number) => (slot === 553 ? state(26.44, -9.8, 4.4) : slot === 562 && f <= 7685 ? state(26.86, 0.5, 2.2) : null),
    inputs: () => ({ kills: [{ xuid: 'rekkles', victimXuid: 'luciid', headshot, replayMs: 7686 * MS }] }),
  } as unknown as ActionContext
  return ctx
}

describe('buildBursts', () => {
  const a = rec(7684, 30)
  const c = rec(7686)
  const spec = () => ({ shots: 3, roundsPerSecond: 60 })

  it('makes the two records one pull of three rounds, each paired with its damage, all on the head', () => {
    const m = buildBursts(ctxOf(true), [a, c], spec)
    const b = m.get(a)!
    expect(m.get(c)).toBe(b)
    expect(b.burst.rounds.map((r) => r.e)).toEqual([a, null, c])
    expect(b.hits.map((h) => h?.frame)).toEqual([7684, 7685, 7686])
    expect(b.head).toBe(true)
    // The victim's feet are at height 2.2 (z) in the film: three axes put it on y.
    for (const t of b.targets) {
      expect(t).not.toBeNull()
      expect(t!.point.y).toBeGreaterThan(2.2 + EYE_HEIGHT - HEAD_RADIUS - 1e-6)
      expect(t!.point.y).toBeLessThan(2.2 + EYE_HEIGHT + HEAD_RADIUS + 1e-6)
      // The normal faces the shooter, who stands higher (4.4).
      expect(t!.normal.y).toBeGreaterThan(0)
    }
    // The third damage is past the victim's life end: placed at their last pose.
    expect(b.targets[2]!.point.distanceTo(b.targets[1]!.point)).toBeLessThan(1e-9)
  })

  it('lands on the body when the kill is not a headshot', () => {
    const b = buildBursts(ctxOf(false), [a, c], spec).get(a)!
    expect(b.head).toBe(false)
    expect(b.targets[0]!.point.y).toBeLessThan(2.2 + BODY_CENTER + 0.2)
  })

  it('leaves out every shot of a weapon that fires no burst', () => {
    expect(buildBursts(ctxOf(true), [a, c], () => null).size).toBe(0)
  })
})
