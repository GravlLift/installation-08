// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { neutralPaint, type CoatingSwatch, type MaterialPaint } from './armorCoating3d'
import { PAINT_SLOTS, VEC4_PER_SLOT, armorMaterial, gradientsOf, packPaint, prepareArmorUVs } from './armorMaterial3d'

function swatch(gradient?: string): CoatingSwatch {
  return {
    index: 0, gradient, gradient_scale: [2, 3], roughness: 2, roughness_white: 0.3, roughness_black: 0.6, metallic: 0.4, emissive: 0.5,
    top: [0.9, 0.8, 0.7], mid: [0.5, 0.4, 0.3], bot: [0.1, 0.2, 0.3], scratch_color: [0.25, 0.25, 0.25], scratch_roughness: 0.15, scratch_metallic: 1,
  }
}

const slot = (data: Float32Array, s: number) => Array.from(data.slice(s * VEC4_PER_SLOT * 4, (s + 1) * VEC4_PER_SLOT * 4))

describe('packPaint', () => {
  it('range chaque zone et la salissure dans leurs emplacements, chaque dégradé à sa couche', () => {
    const note = vi.fn()
    const p: MaterialPaint = { ...neutralPaint(), zones: [swatch('a'), null, swatch('a'), null, null, null, swatch('b')], grime: swatch(), grimeAmount: 0.55, scratchAmount: 0.5, density: [2, 4], offset: [0.1, 0.2] }
    expect(gradientsOf(p)).toEqual(['a', 'b'])
    const packed = packPaint(p, (g) => ({ a: 5, b: 9 })[g], note)
    expect(packed.data).toHaveLength(PAINT_SLOTS * VEC4_PER_SLOT * 4)
    const z0 = slot(packed.data, 0)
    expect(z0.slice(0, 4)).toEqual([1, 5, 2, 3])
    expect(z0.slice(4, 8).map((v) => +v.toFixed(3))).toEqual([0.9, 0.8, 0.7, 0.5])
    expect(z0.slice(8, 12).map((v) => +v.toFixed(3))).toEqual([0.5, 0.4, 0.3, 0.4])
    expect(z0.slice(12, 16).map((v) => +v.toFixed(3))).toEqual([0.1, 0.2, 0.3, 0.5])
    expect(z0.slice(16, 20)).toEqual([0.25, 0.25, 0.25, 1])
    expect(z0.slice(20, 24).map((v) => +v.toFixed(3))).toEqual([0.6, 0.3, 0.15, 0])
    expect(slot(packed.data, 1).every((v) => v === 0)).toBe(true)
    expect(slot(packed.data, 6)[1]).toBe(9)
    // La salissure, sans dégradé : allumée, dégradé neutre.
    expect(slot(packed.data, PAINT_SLOTS - 1).slice(0, 2)).toEqual([1, -1])
    expect([packed.globals, packed.offset]).toEqual([[0.55, 0.5, 2, 4], [0.1, 0.2]])
    expect(note).not.toHaveBeenCalled()
  })

  it('huit dégradés distincts posés ; dégradé non chargé : neutre, nommé ; sans salissure : quantité nulle', () => {
    const note = vi.fn()
    const zones = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((g) => swatch(g))
    const layers: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, f: 5, g: 6 }
    const packed = packPaint({ ...neutralPaint(), zones, grime: swatch('h'), grimeAmount: 0.7 }, (g) => layers[g], note)
    expect([0, 1, 2, 3, 4, 5, 6].map((s) => slot(packed.data, s)[1])).toEqual([0, 1, 2, 3, -1, 5, 6])
    expect(note.mock.calls).toEqual([['gradient_missing', 'e'], ['gradient_missing', 'h']])
    expect(packPaint({ ...neutralPaint(), grimeAmount: 0.7 }, () => 0, note).globals[0]).toBe(0)
  })
})

describe('armorMaterial', () => {
  const gradients: THREE.IUniform<THREE.Texture> = { value: new THREE.Texture() }
  const input = () => ({
    maps: { asg: new THREE.Texture(), mask0: null, mask1: new THREE.Texture() },
    paint: packPaint({ ...neutralPaint(), zones: [swatch('a'), swatch('b'), null, null, null, null, null] }, () => 0, () => {}),
    gradients,
  })

  it('une copie sans texture propre, un programme commun, la peinture en uniformes, les dégradés partagés', () => {
    const base = new THREE.MeshStandardMaterial({ color: 0x808080, map: new THREE.Texture() })
    const a = armorMaterial(base, input())
    const b = armorMaterial(base, input())
    expect(a).not.toBe(base)
    expect(a.map).toBeNull()
    expect(a.color.toArray()).toEqual([1, 1, 1])
    expect(base.map).not.toBeNull()
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey())
    const u = a.userData.armorUniforms as Record<string, THREE.IUniform>
    expect((u.uArmorHas.value as THREE.Vector4).toArray()).toEqual([1, 0, 1, 0])
    // Le camp ne se peint pas sur l'armure (le contour d'équipe est tracé après la scène).
    expect(u.uRim).toBeUndefined()
    // L'uniforme des dégradés est celui de la session : sa croissance atteint tous les matériaux.
    expect(u.uArmorGradients).toBe(gradients)
    expect((b.userData.armorUniforms as Record<string, THREE.IUniform>).uArmorGradients).toBe(gradients)
  })

  it('le programme lit les masques et la peinture', () => {
    const m = armorMaterial(new THREE.MeshStandardMaterial(), input())
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms
    m.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
    expect(shader.fragmentShader).toContain('ArmorZone armor = armorPaint();')
    expect(shader.fragmentShader).toContain('roughnessFactor = clamp(armor.rough')
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += armor.col * armor.emis;')
    expect(shader.fragmentShader).not.toContain('uRim')
    expect(shader.vertexShader).toContain('vArmorUv = armorUv;')
    expect(Object.keys(shader.uniforms)).toContain('uPaint')
  })
})

describe('prepareArmorUVs', () => {
  it('expose `uv` sous le nom du matériau, sans copie ; faux sans coordonnées', () => {
    const g = new THREE.BoxGeometry()
    expect(prepareArmorUVs(g)).toBe(true)
    expect(g.getAttribute('armorUv')).toBe(g.getAttribute('uv'))
    expect(prepareArmorUVs(new THREE.BufferGeometry())).toBe(false)
  })
})
