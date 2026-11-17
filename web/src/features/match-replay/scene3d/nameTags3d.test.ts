// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { describe, expect, it } from 'vitest'

import { TAG_HEIGHT } from './body3d'
import { NAME_TAG_FULL_U, NAME_TAG_RANGE_U, nameTagOpacity, placeTag } from './nameTags3d'

describe('nameTagOpacity — player tags by distance', () => {
  it('full within range, zero beyond the limit', () => {
    expect(nameTagOpacity(0, false)).toBe(1)
    expect(nameTagOpacity(NAME_TAG_FULL_U, false)).toBe(1)
    expect(nameTagOpacity(NAME_TAG_RANGE_U, false)).toBe(0)
    expect(nameTagOpacity(NAME_TAG_RANGE_U * 3, false)).toBe(0)
    expect(nameTagOpacity(Number.NaN, false)).toBe(0)
  })

  it('fades out with no jump between the two bounds', () => {
    const mid = (NAME_TAG_FULL_U + NAME_TAG_RANGE_U) / 2
    expect(nameTagOpacity(mid, false)).toBeCloseTo(0.5, 6)
    let previous = 1
    for (let d = NAME_TAG_FULL_U; d <= NAME_TAG_RANGE_U; d += 0.05) {
      const o = nameTagOpacity(d, false)
      expect(o).toBeLessThanOrEqual(previous)
      expect(previous - o).toBeLessThan(0.05)
      previous = o
    }
    // At both bounds, the curve arrives flat: no jump entering the fade, nor leaving it.
    expect(1 - nameTagOpacity(NAME_TAG_FULL_U + 0.01, false)).toBeLessThan(1e-3)
    expect(nameTagOpacity(NAME_TAG_RANGE_U - 0.01, false)).toBeLessThan(1e-3)
  })

  it('the followed player and the "all names" aid are named at any distance', () => {
    expect(nameTagOpacity(NAME_TAG_RANGE_U * 10, true)).toBe(1)
  })
})

describe('placeTag — placement and visibility of the tag', () => {
  const tagAt = () => new CSS2DObject(document.createElement('div'))
  const feet = new THREE.Vector3(0, 0, 0)

  it('places above the feet, fully opaque and with no written opacity within range', () => {
    const tag = tagAt()
    placeTag(tag, feet, new THREE.Vector3(0, TAG_HEIGHT, 2), false)
    expect(tag.position.y).toBe(TAG_HEIGHT)
    expect(tag.visible).toBe(true)
    expect(tag.element.style.opacity).toBe('')
  })

  it('fades in the transition, hides beyond it, returns full when getting closer', () => {
    const tag = tagAt()
    const mid = (NAME_TAG_FULL_U + NAME_TAG_RANGE_U) / 2
    placeTag(tag, feet, new THREE.Vector3(0, TAG_HEIGHT, mid), false)
    expect(tag.visible).toBe(true)
    expect(tag.element.style.opacity).toBe('0.5')
    placeTag(tag, feet, new THREE.Vector3(0, TAG_HEIGHT, NAME_TAG_RANGE_U + 1), false)
    expect(tag.visible).toBe(false)
    placeTag(tag, feet, new THREE.Vector3(0, TAG_HEIGHT, 1), false)
    expect(tag.visible).toBe(true)
    expect(tag.element.style.opacity).toBe('')
  })

  it('hidden when opacity to the hundredth drops to zero (never left transparent)', () => {
    const tag = tagAt()
    placeTag(tag, feet, new THREE.Vector3(0, TAG_HEIGHT, NAME_TAG_RANGE_U - 0.05), false)
    expect(tag.visible).toBe(false)
  })

  it('with no camera (yourself in first person), hidden even up close', () => {
    const tag = tagAt()
    placeTag(tag, feet, null, true)
    expect(tag.visible).toBe(false)
  })
})
