// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests — grenadeLook3d: THE GRENADE-TYPE -> LOOK MAPPING, and the plasma orb's pulse.
 *
 * WHAT THIS FILE LOCKS DOWN:
 *  - the plasma grenade carries its own look (glowing orb, cold discharge);
 *  - frag, Dynamo and Spike keep the frag look for now (Spike keeps its own discharge nature,
 *    the shard);
 *  - an unknown rank falls back to the frag look, never to a neighboring type's;
 *  - the pulse is bounded and periodic: the same frame renders the same orb.
 */
import { describe, expect, it } from 'vitest'

import {
  grenadeLookOf,
  plasmaPulse,
  PLASMA_CORE_MIX,
  PLASMA_CORE_RADIUS,
  PLASMA_HALO_DIM,
  PLASMA_HALO_MULT,
  PLASMA_PULSE_DEPTH,
  PLASMA_PULSE_RATE,
  PLASMA_RANK,
} from './grenadeLook3d'
import { blastStyleOf } from './explosionFx3d'

describe('grenadeLookOf', () => {
  it('the plasma grenade carries its own look: the orb and the cold discharge', () => {
    expect(PLASMA_RANK).toBe(1)
    expect(grenadeLookOf(PLASMA_RANK)).toEqual({ flight: 'orb', tint: 'plasma_cool' })
  })

  it('the frag keeps the frag look', () => {
    expect(grenadeLookOf(0)).toEqual({ flight: 'model', tint: 'blast' })
  })

  it('Dynamo and Spike keep the frag look for now', () => {
    expect(grenadeLookOf(2).flight).toBe('model')
    expect(grenadeLookOf(3).flight).toBe('model')
    expect(grenadeLookOf(2).tint).toBe('blast')
    expect(grenadeLookOf(3).tint).toBe('needle')
  })

  it('an unknown rank falls back to the frag look', () => {
    expect(grenadeLookOf(-1)).toEqual({ flight: 'model', tint: 'blast' })
    expect(grenadeLookOf(42)).toEqual({ flight: 'model', tint: 'blast' })
  })

  it("the plasma's detonation takes the plasma staging, with no smoke", () => {
    expect(blastStyleOf(grenadeLookOf(PLASMA_RANK).tint)).toBe('plasma')
    expect(blastStyleOf(grenadeLookOf(0).tint)).toBe('fire')
  })
})

describe('plasmaPulse', () => {
  it('is bounded between 0 and 1', () => {
    for (let t = -3; t < 10; t += 0.001) {
      const p = plasmaPulse(t)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
  })

  it('is periodic: the same frame renders the same orb, forward as much as backward', () => {
    const period = 1 / PLASMA_PULSE_RATE
    for (const t of [0.11, 0.37, 1.23]) {
      expect(plasmaPulse(t)).toBeCloseTo(plasmaPulse(t + period))
      expect(plasmaPulse(t)).toBeCloseTo(plasmaPulse(t + 5 * period))
      expect(plasmaPulse(t)).toBeCloseTo(plasmaPulse(t - period))
    }
  })

  it('the constants draw a halo wider than the core, muted, and a core not quite white', () => {
    expect(PLASMA_CORE_RADIUS).toBeGreaterThan(0)
    expect(PLASMA_HALO_MULT).toBeGreaterThan(1)
    expect(PLASMA_HALO_DIM).toBeGreaterThan(0)
    expect(PLASMA_HALO_DIM).toBeLessThan(1)
    expect(PLASMA_PULSE_DEPTH).toBeGreaterThan(0)
    expect(PLASMA_PULSE_DEPTH).toBeLessThan(1)
    expect(PLASMA_CORE_MIX).toBeGreaterThan(0)
    expect(PLASMA_CORE_MIX).toBeLessThan(1)
  })
})
