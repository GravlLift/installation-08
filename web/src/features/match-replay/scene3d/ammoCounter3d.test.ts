// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { INPUT_ONES, INPUT_TENS, counterImage, counterInput, findCounterQuads, readCounterImages, showRounds } from './ammoCounter3d'

/** A digit quad as the library writes the BR75's: ten images in a strip, scaled to the first. */
function digit(entree: number): THREE.Mesh {
  const map = new THREE.Texture()
  map.repeat.set(0.1, 1)
  const m = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0, 0.18, 1), emissiveIntensity: 5, emissiveMap: map })
  m.userData = { shader: 0xfb43df97, emissionImages: { entree, min: 0, max: 10, nombre: 10 } }
  return new THREE.Mesh(new THREE.BufferGeometry(), m)
}

const offset = (mesh: THREE.Mesh) => (mesh.material as THREE.MeshStandardMaterial).emissiveMap!.offset.x

describe('ammo counter', () => {
  it('reads the images the library writes, and refuses a malformed or single-image entry', () => {
    expect(readCounterImages({ emissionImages: { entree: 2531565988, min: 0, max: 10, nombre: 10 } })).toEqual({ entree: INPUT_TENS, min: 0, max: 10, nombre: 10 })
    expect(readCounterImages({ emissionImages: { entree: 1, min: 0, max: 10, nombre: 1 } })).toBeNull()
    expect(readCounterImages({ emissionImages: { entree: 'x' } })).toBeNull()
    expect(readCounterImages(undefined)).toBeNull()
  })

  it('maps each digit of the rounds to its image, through the game function', () => {
    const spec = { entree: INPUT_ONES, min: 0, max: 10, nombre: 10 }
    for (let d = 0; d < 10; d++) expect(counterImage(spec, counterInput(INPUT_ONES, d)!)).toBe(d)
    expect(counterInput(INPUT_TENS, 36)).toBeCloseTo(0.3)
    expect(counterInput(INPUT_ONES, 36)).toBeCloseTo(0.6)
    expect(counterInput(INPUT_TENS, 5)).toBe(0)
    expect(counterInput(0x1234, 5)).toBeNull()
  })

  it('shows a full BR75 magazine as 36, then 35 after a shot', () => {
    const tens = digit(INPUT_TENS)
    const ones = digit(INPUT_ONES)
    const root = new THREE.Group().add(tens, ones, new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()))
    const quads = findCounterQuads(root)
    expect(quads).toHaveLength(2)
    showRounds(quads, 36)
    expect(offset(tens)).toBeCloseTo(0.3)
    expect(offset(ones)).toBeCloseTo(0.6)
    showRounds(quads, 35)
    expect(offset(ones)).toBeCloseTo(0.5)
    showRounds(quads, null) // the film does not say: the counter keeps what it showed
    expect(offset(ones)).toBeCloseTo(0.5)
    showRounds(quads, 0)
    expect(offset(tens)).toBeCloseTo(0)
    expect(offset(ones)).toBeCloseTo(0)
  })
})
