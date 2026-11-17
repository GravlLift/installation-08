// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { BEAM_GLOW_DIM, BEAM_GLOW_MULT, BEAM_RADIUS, BEAM_SECONDS, BOLT_SPEED, IMPACT_SECONDS, TRACER_LENGTH, TRACER_SPEED, beamFade, formeVol, impactAge, lunetteSansGerbe, shotLineShown, tracerSpan } from './shots3d'

describe('the default shot looks like the game', () => {
  it('a bullet lives for the length of its flight, never suspended in the air', () => {
    // 80 u (range) at 300 u/s: under a third of a second from muzzle to wall.
    expect(tracerSpan(80, 0.27)).not.toBeNull()
    expect(tracerSpan(80, (80 + TRACER_LENGTH) / TRACER_SPEED)).toBeNull()
    const span = tracerSpan(80, 0.1)
    expect(span && span.head - span.tail).toBeCloseTo(TRACER_LENGTH)
  })

  it('an energy projectile is a point flying more slowly, with no streak', () => {
    const speed = BOLT_SPEED.plasma ?? 0
    expect(speed).toBeLessThan(TRACER_SPEED)
    const span = tracerSpan(30, 0.2, speed, 0)
    expect(span).toEqual({ tail: 0.2 * speed, head: 0.2 * speed })
    expect(impactAge(30, 30 / speed + 0.01, speed)).toBeCloseTo(0.01)
  })

  it('the entire shot line only shows when asked for, for the persistence', () => {
    expect(shotLineShown(0.3, -1)).toBe(false)
    expect(shotLineShown(0.3, 0.6)).toBe(true)
    expect(shotLineShown(0.7, 0.6)).toBe(false)
  })
})

describe('tracerSpan', () => {
  it('advances a short streak at the speed of the bullet', () => {
    const t = 10 / TRACER_SPEED
    expect(tracerSpan(30, t)).toEqual({ tail: 10 - TRACER_LENGTH, head: 10 })
  })

  it('starts from the muzzle: the tail never goes back behind it', () => {
    expect(tracerSpan(30, 0)).toEqual({ tail: 0, head: 0 })
  })

  it('retracts into the impact point then goes out', () => {
    const arrived = tracerSpan(30, 30.5 / TRACER_SPEED)
    expect(arrived?.head).toBe(30)
    expect(arrived?.tail).toBeCloseTo(30.5 - TRACER_LENGTH)
    expect(tracerSpan(30, (30 + TRACER_LENGTH) / TRACER_SPEED)).toBeNull()
  })

  it('a short flight lives less long than a long flight', () => {
    expect(tracerSpan(2, 0.05)).toBeNull()
    expect(tracerSpan(30, 0.05)).not.toBeNull()
  })
})

describe('impactAge', () => {
  it('throws the spark only when the bullet arrives, and briefly', () => {
    const arrival = 30 / TRACER_SPEED
    expect(impactAge(30, arrival - 0.01)).toBeNull()
    expect(impactAge(30, arrival + 0.01)).toBeCloseTo(0.01)
    expect(impactAge(30, arrival + IMPACT_SECONDS)).toBeNull()
  })

  it('a zero-distance flight (beam) throws the spark at the instant of the shot', () => {
    expect(impactAge(0, 0)).toBe(0)
    expect(impactAge(0, IMPACT_SECONDS / 2)).toBeCloseTo(IMPACT_SECONDS / 2)
    expect(impactAge(0, IMPACT_SECONDS)).toBeNull()
  })
})

describe('formeVol', () => {
  it('the shock shot is an instant beam, not a bullet or a point', () => {
    expect(formeVol('shock')).toBe('beam')
  })

  it('energy projectiles are fire points', () => {
    expect(formeVol('plasma')).toBe('bolt')
    expect(formeVol('needles')).toBe('bolt')
  })

  it('the other families fire a short streak at the speed of the bullet', () => {
    expect(formeVol('ballistic')).toBe('tracer')
    expect(formeVol('light')).toBe('tracer')
    expect(formeVol('explosive')).toBe('tracer')
    expect(formeVol('plain')).toBe('tracer')
  })

  it('the spread shot (Heatwave) has its own form', () => {
    expect(formeVol('spread')).toBe('spread')
  })
})

describe('beamFade', () => {
  it('the beam is full at the instant of the shot', () => {
    expect(beamFade(0)).toBe(1)
    expect(beamFade(-0.1)).toBe(0)
  })

  it('it fades linearly and is out past its duration', () => {
    expect(beamFade(BEAM_SECONDS / 2)).toBeCloseTo(0.5)
    expect(beamFade(BEAM_SECONDS)).toBe(0)
    expect(beamFade(BEAM_SECONDS + 0.05)).toBe(0)
  })
})

describe("the beam's glow", () => {
  it("the radius is a named multiple of the core's and the intensity a named fraction", () => {
    expect(BEAM_GLOW_MULT).toBe(4)
    expect(BEAM_GLOW_MULT * BEAM_RADIUS).toBeGreaterThan(BEAM_RADIUS)
    expect(BEAM_GLOW_DIM).toBeCloseTo(0.25)
    expect(BEAM_GLOW_DIM).toBeLessThan(1)
  })
})


describe('lunetteSansGerbe', () => {
  it('a 1st-person view shot has no spray when the scope is mounted', () => {
    expect(lunetteSansGerbe(true, true)).toBe(true)
  })

  it('the 1st-person view spray stays with no scope', () => {
    expect(lunetteSansGerbe(true, false)).toBe(false)
  })

  it('the tracked player\'s scope does not remove a shot\'s spray seen from 3rd person', () => {
    expect(lunetteSansGerbe(false, true)).toBe(false)
  })
})
