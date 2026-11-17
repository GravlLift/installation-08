// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { THRUSTER_DASH_MS } from '../layers/thrusterDashFx'
import { testReplayDoc } from '../test/testDoc'
import { thrusterBursts, thrusterJetAt } from './thruster3d_logic'

const FRAME_MS = 100

/** A life that moves along +Y from frame 0 to 20, then stands still. */
function moving(slot: number) {
  return {
    slot,
    team: 0,
    startFrame: 0,
    endFrame: 100,
    points: [
      { t: 0, x: 0, y: 0 },
      { t: 20, x: 0, y: 10 },
      { t: 100, x: 0, y: 10 },
    ],
  }
}

const doc = testReplayDoc({
  frameCount: 200,
  frameIntervalMs: FRAME_MS,
  tracks: [moving(3)],
  abilityImpulses: [
    { t: 10, slot: 3, family: 'thruster' },
    // Standing still before and after: no direction, nothing drawn.
    { t: 60, slot: 3, family: 'thruster' },
    // Another family never bursts.
    { t: 5, slot: 3, family: 'repulsor' },
  ],
})

describe('thrusterBursts — the thruster uses whose direction the trajectory gives', () => {
  it('keeps the thruster use with a read direction, along the push', () => {
    const bursts = thrusterBursts(doc, FRAME_MS)
    expect(bursts).toHaveLength(1)
    expect(bursts[0].t).toBe(10)
    expect(bursts[0].slot).toBe(3)
    expect(bursts[0].dx).toBeCloseTo(0)
    expect(bursts[0].dy).toBeCloseTo(1)
  })
})

describe('thrusterJetAt — the exhaust over the 2D dash window', () => {
  const burst = { t: 10, slot: 3, dx: 0, dy: 1 }
  const windowFrames = THRUSTER_DASH_MS / FRAME_MS

  it('shows nothing before the use or after the window', () => {
    expect(thrusterJetAt(burst, 9.9, FRAME_MS)).toBeNull()
    expect(thrusterJetAt(burst, 10 + windowFrames + 0.01, FRAME_MS)).toBeNull()
  })

  it('grows out then fades, a function of the frame alone', () => {
    const start = thrusterJetAt(burst, 10, FRAME_MS)
    expect(start?.reach).toBe(0)
    const mid = thrusterJetAt(burst, 10 + windowFrames / 2, FRAME_MS)
    expect(mid!.reach).toBeGreaterThan(0.5)
    expect(mid!.alpha).toBeLessThan(start!.alpha)
    expect(thrusterJetAt(burst, 10 + windowFrames / 2, FRAME_MS)).toEqual(mid)
  })
})
