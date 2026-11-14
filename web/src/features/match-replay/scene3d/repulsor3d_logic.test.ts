import { describe, expect, it } from 'vitest'

import { KNOCKBACK_FX_MS } from '../layers/knockbackFx'
import { testReplayDoc } from '../test/testDoc'
import { REPULSOR_PULSE_RADIUS_U, repulsorBurstAt, repulsorPulses } from './repulsor3d_logic'

const FRAME_MS = 40

const doc = testReplayDoc({
  frameCount: 1000,
  frameIntervalMs: FRAME_MS,
  abilityLabels: {
    '6': { fr: 'Répulseur', en: 'Repulsor', family: 'repulsor' },
    '5': { fr: 'Propulseur', en: 'Thruster', family: 'thruster' },
  },
  carriedEquipment: [
    // Two activations, the second into the void (no knockback anywhere): both pulse.
    { slot: 3, r: 6, t0: 10, uses: [300, 120] },
    // Another family's activations never pulse.
    { slot: 4, r: 5, t0: 10, uses: [200] },
    // A rank without a family never pulses.
    { slot: 5, r: 9, t0: 10, uses: [210] },
  ],
})

describe('repulsorPulses — every activation of a carried repulsor', () => {
  it('keeps the repulsor activations only, in frame order', () => {
    expect(repulsorPulses(doc)).toEqual([
      { t: 120, slot: 3 },
      { t: 300, slot: 3 },
    ])
  })
})

describe('repulsorBurstAt — the burst opens over the push wave window, then is gone', () => {
  const pulse = { t: 120, slot: 3 }
  const windowFrames = KNOCKBACK_FX_MS / FRAME_MS

  it('shows nothing before the activation or after the window', () => {
    expect(repulsorBurstAt(pulse, 119, FRAME_MS)).toBeNull()
    expect(repulsorBurstAt(pulse, 120 + windowFrames + 0.01, FRAME_MS)).toBeNull()
  })

  it('starts at the carrier and opens to its full radius as it fades', () => {
    expect(repulsorBurstAt(pulse, 120, FRAME_MS)?.radius).toBe(0)
    const late = repulsorBurstAt(pulse, 120 + windowFrames, FRAME_MS)
    expect(late?.radius).toBeCloseTo(REPULSOR_PULSE_RADIUS_U)
    expect(late?.alpha).toBeCloseTo(0)
    const mid = repulsorBurstAt(pulse, 120 + windowFrames / 2, FRAME_MS)
    expect(mid!.radius).toBeGreaterThan(REPULSOR_PULSE_RADIUS_U / 2)
    expect(mid!.alpha).toBeGreaterThan(0)
  })
})
