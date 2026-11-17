// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** eye3d.test.ts — la descente de l'œil : fondu à l'entrée, fondu à la sortie, fusion des postures. */
import { describe, expect, it } from 'vitest'

import { CROUCH_DROP } from './body3d'
import { DUREE_ENTREE_OEIL, DUREE_SORTIE_OEIL, dropOeil, fusionnerIntervallees, SANS_INTERVALLE } from './eye3d'

const FPS = 10
const E = DUREE_ENTREE_OEIL * FPS // 2 images
const X = DUREE_SORTIE_OEIL * FPS // 2,5 images

describe('fusionnerIntervallees', () => {
  it('unit ce qui se touche ou se chevauche, sans changer les bornes de l’union', () => {
    expect(fusionnerIntervallees([{ t0: 15, fin: 20 }, { t0: 10, fin: 15 }])).toEqual([{ t0: 10, fin: 20 }])
    expect(fusionnerIntervallees([{ t0: 10, fin: 15 }, { t0: 14, fin: 20 }])).toEqual([{ t0: 10, fin: 20 }])
    expect(fusionnerIntervallees([{ t0: 10, fin: 15 }, { t0: 20, fin: 25 }])).toEqual([{ t0: 10, fin: 15 }, { t0: 20, fin: 25 }])
    expect(fusionnerIntervallees([])).toEqual([])
  })
})

describe('dropOeil', () => {
  const accroupi = [{ t0: 10, fin: 20 }]
  const debout = (f: number) => dropOeil(SANS_INTERVALLE, f, E, X)
  const d = (f: number) => dropOeil(accroupi, f, E, X)

  it('debout : 0, avant et après l’intervalle comme sans intervalle', () => {
    expect(d(9.9)).toBe(0)
    expect(d(20 + X)).toBe(0)
    expect(d(20 + X + 100)).toBe(0)
    expect(debout(15)).toBe(0)
  })

  it('enfoncé : la descente pleine, accroupi comme en glissade', () => {
    expect(d(15)).toBe(CROUCH_DROP)
    expect(d(20)).toBe(CROUCH_DROP) // la fin de l’intervalle : le fondu de sortie commence après
  })

  it('au milieu du fondu d’entrée : la moitié (point médian du smoothstep)', () => {
    expect(d(10 + E / 2)).toBeCloseTo(CROUCH_DROP / 2, 12)
  })

  it('après la fin : retour à 0 sur le temps de sortie', () => {
    expect(d(20 + X / 2)).toBeCloseTo(CROUCH_DROP / 2, 12)
    expect(d(20 + X)).toBe(0)
    expect(d(20 + X - 0.01)).toBeGreaterThan(0)
  })

  it('une glissade qui commence quand l’accroupissement finit tient la descente pleine à la jonction', () => {
    const jonction = fusionnerIntervallees([{ t0: 10, fin: 15 }, { t0: 15, fin: 25 }])
    expect(dropOeil(jonction, 15, E, X)).toBe(CROUCH_DROP)
    expect(dropOeil(jonction, 14.99, E, X)).toBe(CROUCH_DROP)
    expect(dropOeil(jonction, 24.99, E, X)).toBe(CROUCH_DROP)
  })

  it('un intervalle de 50 ms ne dépasse jamais ce que son fondu d’entrée a atteint, sans saut', () => {
    const court = [{ t0: 10, fin: 10.5 }] // 50 ms à 10 images/s : 0,5 image
    for (let f = 10; f <= 10 + 0.5 + X; f += 0.01) {
      const v = dropOeil(court, f, E, X)
      const entree = f < 10 ? 0 : f > 10 + E ? 1 : ((f - 10) / E) ** 2 * (3 - 2 * (f - 10) / E)
      expect(v).toBeLessThanOrEqual(CROUCH_DROP * entree + 1e-12)
      expect(v).toBeLessThan(CROUCH_DROP)
    }
    // Continuité : pas de saut au-delà d’un pas de fondu sur un pas de 0,01 image.
    let precedent = dropOeil(court, 10, E, X)
    for (let f = 10.01; f <= 10 + 0.5 + X; f += 0.01) {
      const v = dropOeil(court, f, E, X)
      expect(Math.abs(v - precedent)).toBeLessThan(0.01)
      precedent = v
    }
  })

  it('la même image donne la même descente en avant comme en arrière', () => {
    const images = [0, 5, 10.2, 11, 14.99, 20, 22, 22.5, 40]
    const avant = images.map((f) => d(f))
    const arriere = [...images].reverse().map((f) => d(f))
    expect(arriere).toEqual([...avant].reverse())
  })

  it('plusieurs intervalles : l’enveloppe est la plus haute des queues et des entrées', () => {
    const deux = fusionnerIntervallees([{ t0: 10, fin: 12 }, { t0: 13, fin: 23 }])
    // Le premier intervalle (2 images) vaut le fondu d'entrée : au point médian, la moitié.
    expect(dropOeil(deux, 11, E, X)).toBeCloseTo(CROUCH_DROP / 2, 12)
    // La queue de sortie du premier couvre encore le début du second : c’est elle qui tient.
    expect(dropOeil(deux, 12.5, E, X)).toBeCloseTo(CROUCH_DROP * (1 - 0.104), 12)
    expect(dropOeil(deux, 13.5, E, X)).toBeCloseTo(CROUCH_DROP * (1 - 0.648), 12)
    expect(dropOeil(deux, 20, E, X)).toBe(CROUCH_DROP)
  })
})
