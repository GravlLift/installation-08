import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { describe, expect, it } from 'vitest'

import { TAG_HEIGHT } from './body3d'
import { NAME_TAG_FULL_U, NAME_TAG_RANGE_U, nameTagOpacity, placeTag } from './nameTags3d'

describe('nameTagOpacity — étiquette des joueurs selon la distance', () => {
  it('pleine à portée, nulle au-delà de la limite', () => {
    expect(nameTagOpacity(0, false)).toBe(1)
    expect(nameTagOpacity(NAME_TAG_FULL_U, false)).toBe(1)
    expect(nameTagOpacity(NAME_TAG_RANGE_U, false)).toBe(0)
    expect(nameTagOpacity(NAME_TAG_RANGE_U * 3, false)).toBe(0)
    expect(nameTagOpacity(Number.NaN, false)).toBe(0)
  })

  it('s’efface sans saut entre les deux bornes', () => {
    const mid = (NAME_TAG_FULL_U + NAME_TAG_RANGE_U) / 2
    expect(nameTagOpacity(mid, false)).toBeCloseTo(0.5, 6)
    let previous = 1
    for (let d = NAME_TAG_FULL_U; d <= NAME_TAG_RANGE_U; d += 0.05) {
      const o = nameTagOpacity(d, false)
      expect(o).toBeLessThanOrEqual(previous)
      expect(previous - o).toBeLessThan(0.05)
      previous = o
    }
    // Aux deux bornes, la courbe arrive à plat : ni saut à l'entrée du fondu, ni à la sortie.
    expect(1 - nameTagOpacity(NAME_TAG_FULL_U + 0.01, false)).toBeLessThan(1e-3)
    expect(nameTagOpacity(NAME_TAG_RANGE_U - 0.01, false)).toBeLessThan(1e-3)
  })

  it('le joueur suivi et le repère « tous les noms » sont nommés à toute distance', () => {
    expect(nameTagOpacity(NAME_TAG_RANGE_U * 10, true)).toBe(1)
  })
})

describe('placeTag — pose et visibilité de l’étiquette', () => {
  const tagAt = () => new CSS2DObject(document.createElement('div'))
  const feet = new THREE.Vector3(0, 0, 0)

  it('pose au-dessus des pieds, pleine et sans opacité écrite à portée', () => {
    const tag = tagAt()
    placeTag(tag, feet, new THREE.Vector3(0, TAG_HEIGHT, 2), false)
    expect(tag.position.y).toBe(TAG_HEIGHT)
    expect(tag.visible).toBe(true)
    expect(tag.element.style.opacity).toBe('')
  })

  it('pâlit dans le fondu, se cache au-delà, revient pleine en se rapprochant', () => {
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

  it('cachée quand l’opacité au centième tombe à zéro (jamais posée transparente)', () => {
    const tag = tagAt()
    placeTag(tag, feet, new THREE.Vector3(0, TAG_HEIGHT, NAME_TAG_RANGE_U - 0.05), false)
    expect(tag.visible).toBe(false)
  })

  it('sans caméra (soi-même en 1re personne), cachée même de près', () => {
    const tag = tagAt()
    placeTag(tag, feet, null, true)
    expect(tag.visible).toBe(false)
  })
})
