import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { materiauProsthesique, peintureProsthesique, regionsProsthetiques, sourceProsthesique } from './brasProsthesique3d'
import { packPaint } from './armorMaterial3d'
import { DARK_METAL, LIGHT_METAL } from './fallbackMetal3d'

describe('sourceProsthesique', () => {
  it('reconnaît une source de membre prosthétique', () => {
    expect(sourceProsthesique('prosthetic_left_arm')).toBe(true)
    expect(sourceProsthesique('prosthetic_right_forearm_armour')).toBe(true)
    expect(sourceProsthesique('left_arm')).toBe(false)
    expect(sourceProsthesique('theme')).toBe(false)
    expect(sourceProsthesique(undefined)).toBe(false)
  })
})

describe('regionsProsthetiques', () => {
  it('ne retient que les régions prosthétiques du choix du joueur', () => {
    const regions = regionsProsthetiques([
      { region_key: '3f91af6a', source: 'prosthetic_left_arm' },
      { region_key: '7c8065e9', source: 'prosthetic_right_arm' },
      { region_key: 'aaaaaaaa', source: 'theme' },
      { region_key: 'bbbbbbbb', source: 'helmet' },
    ])
    expect([...regions]).toEqual(['3f91af6a', '7c8065e9'])
  })

  it('rend un ensemble vide sans manifeste', () => {
    expect(regionsProsthetiques(null).size).toBe(0)
  })
})

describe('materiauProsthesique', () => {
  const regions = regionsProsthetiques([{ region_key: '3f91af6a', source: 'prosthetic_left_arm' }])

  it('décide par la région du style du matériau', () => {
    const prosth = new THREE.MeshStandardMaterial()
    prosth.userData = { style: { stylelist: 'a7d83e8c', region: '3f91af6a' } }
    const armure = new THREE.MeshStandardMaterial()
    armure.userData = { style: { stylelist: 'b0799de3', region: 'aaaaaaaa' } }
    const sansStyle = new THREE.MeshStandardMaterial()
    expect(materiauProsthesique(prosth, regions)).toBe(true)
    expect(materiauProsthesique(armure, regions)).toBe(false)
    expect(materiauProsthesique(sansStyle, regions)).toBe(false)
  })

  it('ne peint rien quand le manifeste n’a pas de membre prosthétique', () => {
    const m = new THREE.MeshStandardMaterial()
    m.userData = { style: { stylelist: 'a7d83e8c', region: '3f91af6a' } }
    expect(materiauProsthesique(m, regionsProsthetiques(null))).toBe(false)
  })
})

describe('peintureProsthesique', () => {
  it('peint la base en gunmetal clair et le masque 0 en gunmetal sombre', () => {
    const paint = peintureProsthesique()
    expect(paint.zones[0]?.bot).toEqual([LIGHT_METAL.r, LIGHT_METAL.g, LIGHT_METAL.b])
    expect(paint.zones[0]?.metallic).toBe(LIGHT_METAL.metalness)
    expect(paint.zones[1]?.bot).toEqual([DARK_METAL.r, DARK_METAL.g, DARK_METAL.b])
    expect(paint.zones[1]?.metallic).toBe(DARK_METAL.metalness)
    for (let k = 2; k < paint.zones.length; k++) expect(paint.zones[k]).toBeNull()
    expect(paint.grime).toBeNull()
    expect(paint.scratchAmount).toBe(0)
    expect(paint.grimeAmount).toBe(0)
  })

  it('range la teinte et la rugosité dans les uniformes de la zone', () => {
    const packed = packPaint(peintureProsthesique(), () => undefined, () => {})
    const z0 = packed.data.subarray(0, 24)
    expect([z0[4], z0[5], z0[6]]).toEqual([expect.closeTo(LIGHT_METAL.r), expect.closeTo(LIGHT_METAL.g), expect.closeTo(LIGHT_METAL.b)])
    expect(z0[11]).toBeCloseTo(LIGHT_METAL.metalness)
    expect(z0[15]).toBeCloseTo(LIGHT_METAL.roughness)
    const z1 = packed.data.subarray(24, 48)
    expect([z1[4], z1[5], z1[6]]).toEqual([expect.closeTo(DARK_METAL.r), expect.closeTo(DARK_METAL.g), expect.closeTo(DARK_METAL.b)])
    expect(packed.globals).toEqual([0, 0, 1, 1])
  })
})
