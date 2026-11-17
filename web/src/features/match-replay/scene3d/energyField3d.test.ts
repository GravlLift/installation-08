// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { Coat, CoatPaint } from './armorCoat3d'
import { neutralPaint, type CoatingSwatch } from './armorCoating3d'
import { packPaint } from './armorMaterial3d'
import { ENERGY_INTENSITY, energize, energyCopy, energyTintOf, isEnergized, isEnergyField } from './energyField3d'
import { darkMetalFallback, DARK_GLASS } from './fallbackMetal3d'

/** The Energy Sword's blade as the library writes it (`mat_e134dc33`): alpha blended, untextured, tint 0.6 0.8 1 at 0.25. */
function blade(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.6, 0.8, 1), transparent: true, opacity: 0.25 })
  m.userData = { connu: true, melange: 3, shader: 1273268522 }
  return m
}

function swatch(top: [number, number, number], emissive: number): CoatingSwatch {
  return {
    index: 0, gradient_scale: [1, 1], roughness: 4, roughness_white: 1, roughness_black: 1, metallic: 0, emissive,
    top, mid: top, bot: top, scratch_color: [0, 0, 0], scratch_roughness: 0, scratch_metallic: 0,
  }
}

function coatPaint(zones: (CoatingSwatch | null)[]): CoatPaint {
  const p = neutralPaint()
  zones.forEach((z, k) => { p.zones[k] = z })
  return { maps: { asg: null, mask0: null, mask1: null }, paint: packPaint(p, () => undefined, () => {}), gradients: { value: new THREE.Texture() } }
}

describe('isEnergyField', () => {
  it('recognizes the sword blade, not glass, opaque or painted surfaces', () => {
    expect(isEnergyField(blade())).toBe(true)
    const glass = blade()
    glass.userData.vitre = true
    expect(isEnergyField(glass)).toBe(false)
    const opaque = blade()
    opaque.transparent = false
    expect(isEnergyField(opaque)).toBe(false)
    const additive = blade()
    additive.userData.melange = 1
    expect(isEnergyField(additive)).toBe(false)
    const painted = blade()
    painted.userData.surfaceBrute = { asg: 0 }
    expect(isEnergyField(painted)).toBe(false)
  })
})

describe('darkMetalFallback on an energy field', () => {
  it('draws the blade as a self-lit additive field of its tint, not dark glass, once', () => {
    const m = blade()
    expect(darkMetalFallback(m)).toBe(true)
    expect(isEnergized(m)).toBe(true)
    expect([m.color.r, m.color.g, m.color.b]).toEqual([0, 0, 0])
    expect([m.emissive.r, m.emissive.g, m.emissive.b]).toEqual([0.6, 0.8, 1].map((v) => expect.closeTo(v, 5)))
    expect(m.emissiveIntensity).toBe(ENERGY_INTENSITY)
    expect(m.blending).toBe(THREE.AdditiveBlending)
    expect(m.transparent).toBe(true)
    expect(m.opacity).toBe(0.25)
    expect(m.depthWrite).toBe(false)
    // A second pass (models are prepared more than once) leaves it lit.
    expect(darkMetalFallback(m)).toBe(false)
    expect(energize(m)).toBe(false)
    expect(m.emissive.g).toBeCloseTo(0.8)
  })

  it('still turns a scope glass into dark glass', () => {
    const glass = blade()
    glass.userData.vitre = true
    expect(darkMetalFallback(glass)).toBe(true)
    expect(isEnergized(glass)).toBe(false)
    expect(glass.color.r).toBeCloseTo(DARK_GLASS.r)
    expect(glass.transparent).toBe(false)
  })
})

describe('energyTintOf', () => {
  it('takes the brightest lit emissive swatch of the filtered materials', () => {
    const hilt = new THREE.MeshStandardMaterial()
    hilt.userData.rigWeapon = true
    const arm = new THREE.MeshStandardMaterial()
    const coat: Coat = new Map([
      // The sword's default style: gray metal base, blue emissive 46ec02bd at 16.
      [hilt, coatPaint([swatch([0.16, 0.16, 0.16], 0), null, null, swatch([0, 0.3714, 1], 16)])],
      [arm, coatPaint([swatch([1, 0, 0], 40)])],
    ])
    expect(energyTintOf(coat, (m) => !!m.userData.rigWeapon)).toEqual({ color: [0, expect.closeTo(0.3714, 4), 1], intensity: 16 })
    expect(energyTintOf(coat)?.intensity).toBe(40)
    expect(energyTintOf(new Map([[hilt, coatPaint([swatch([0.2, 0.2, 0.2], 0)])]]))).toBeNull()
  })
})

describe('energyCopy', () => {
  it('lights a copy in the weapon tint and leaves the source as loaded', () => {
    const m = blade()
    energize(m)
    const c = energyCopy(m, { color: [0, 0.37, 1], intensity: 16 })
    expect(c).not.toBe(m)
    expect([c.emissive.r, c.emissive.g, c.emissive.b]).toEqual([0, expect.closeTo(0.37, 5), 1])
    expect(c.emissiveIntensity).toBe(16)
    expect(c.blending).toBe(THREE.AdditiveBlending)
    expect(m.emissive.g).toBeCloseTo(0.8)
  })
})
