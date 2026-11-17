// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests — grenadeLook3d : LE PASSAGE TYPE DE GRENADE -> LOOK, et le pulsé de l'orbe plasma.
 *
 * CE QUE CE FICHIER VERROUILLE :
 *  - la grenade plasma porte son propre look (orbe lumineuse, décharge froide) ;
 *  - frag, Dynamo et Spike gardent le look frag pour l'instant (la Spike garde sa nature de
 *    décharge, le cristal) ;
 *  - un rang inconnu retombe sur le look frag, jamais sur celui d'un type voisin ;
 *  - le pulsé est borné et périodique : la même image rend le même orbe.
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
  it('la grenade plasma porte son propre look : l orbe et la décharge froide', () => {
    expect(PLASMA_RANK).toBe(1)
    expect(grenadeLookOf(PLASMA_RANK)).toEqual({ flight: 'orb', tint: 'plasma_cool' })
  })

  it('la frag garde le look frag', () => {
    expect(grenadeLookOf(0)).toEqual({ flight: 'model', tint: 'blast' })
  })

  it('Dynamo et Spike gardent le look frag pour l instant', () => {
    expect(grenadeLookOf(2).flight).toBe('model')
    expect(grenadeLookOf(3).flight).toBe('model')
    expect(grenadeLookOf(2).tint).toBe('blast')
    expect(grenadeLookOf(3).tint).toBe('needle')
  })

  it('un rang inconnu retombe sur le look frag', () => {
    expect(grenadeLookOf(-1)).toEqual({ flight: 'model', tint: 'blast' })
    expect(grenadeLookOf(42)).toEqual({ flight: 'model', tint: 'blast' })
  })

  it('la détonation de la plasma prend la mise en scène plasma, sans fumée', () => {
    expect(blastStyleOf(grenadeLookOf(PLASMA_RANK).tint)).toBe('plasma')
    expect(blastStyleOf(grenadeLookOf(0).tint)).toBe('fire')
  })
})

describe('plasmaPulse', () => {
  it('est borné entre 0 et 1', () => {
    for (let t = -3; t < 10; t += 0.001) {
      const p = plasmaPulse(t)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
  })

  it('est périodique : la même image rend le même orbe, en avant comme en arrière', () => {
    const periode = 1 / PLASMA_PULSE_RATE
    for (const t of [0.11, 0.37, 1.23]) {
      expect(plasmaPulse(t)).toBeCloseTo(plasmaPulse(t + periode))
      expect(plasmaPulse(t)).toBeCloseTo(plasmaPulse(t + 5 * periode))
      expect(plasmaPulse(t)).toBeCloseTo(plasmaPulse(t - periode))
    }
  })

  it('les constantes dessinent un halo plus large que le cœur, assourdi, et un cœur pas tout à fait blanc', () => {
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
