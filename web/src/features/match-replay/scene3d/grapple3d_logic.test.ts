import { describe, expect, it } from 'vitest'

import { GRAPPLE_HOOK_FLIGHT_MS, grapplePhaseAt } from './grapple3d_logic'

/** 30 ms per frame: the 150 ms flight is five frames. */
const FRAME_MS = 30

describe('grapplePhaseAt — the hook flies, then holds, inside the measured pull', () => {
  const pull = { t0: 100, t1: 140 }

  it('shows nothing before the fire, after the arrival, or on an empty pull', () => {
    expect(grapplePhaseAt(pull, 99, FRAME_MS)).toBeNull()
    expect(grapplePhaseAt(pull, 140.01, FRAME_MS)).toBeNull()
    expect(grapplePhaseAt({ t0: 50, t1: 50 }, 50, FRAME_MS)).toBeNull()
  })

  it('the hook leaves the hand at the fire and reaches the anchor one measured flight later', () => {
    const flightFrames = GRAPPLE_HOOK_FLIGHT_MS / FRAME_MS
    expect(grapplePhaseAt(pull, 100, FRAME_MS)).toEqual({ reach: 0, attached: false })
    expect(grapplePhaseAt(pull, 100 + flightFrames / 2, FRAME_MS)?.reach).toBeCloseTo(0.5)
    expect(grapplePhaseAt(pull, 100 + flightFrames, FRAME_MS)).toEqual({ reach: 1, attached: true })
    expect(grapplePhaseAt(pull, 140, FRAME_MS)).toEqual({ reach: 1, attached: true })
  })

  it('a pull shorter than the flight lands its hook at the arrival', () => {
    const short = { t0: 10, t1: 12 }
    expect(grapplePhaseAt(short, 11, FRAME_MS)?.reach).toBeCloseTo(0.5)
    expect(grapplePhaseAt(short, 12, FRAME_MS)?.attached).toBe(true)
  })

  it('is a function of the frame alone (seeking back gives the same phase)', () => {
    const a = grapplePhaseAt(pull, 102, FRAME_MS)
    grapplePhaseAt(pull, 130, FRAME_MS)
    expect(grapplePhaseAt(pull, 102, FRAME_MS)).toEqual(a)
  })
})
