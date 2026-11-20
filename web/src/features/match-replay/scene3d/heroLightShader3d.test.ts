// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'

import { armorMaterial } from './armorMaterial3d'
import { HERO_LIGHTS_MAX } from './heroLights3d'
import { clearHeroRigs, graftHeroLights, HERO_APPLY, heroLightUniforms, isHeroLit, setHeroRigs, type HeroRigUniform } from './heroLightShader3d'

/** compile runs a material's `onBeforeCompile` on the stock physical shader, as three does. */
function compile(m: THREE.Material): { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> } {
  const shader = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> }
  m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  return shader
}

const count = (s: string, part: string) => s.split(part).length - 1

afterEach(() => clearHeroRigs())

describe('graftHeroLights', () => {
  it('appends the hero loop after the lights include, once, sharing the session uniforms', () => {
    const m = new THREE.MeshStandardMaterial()
    graftHeroLights(m)
    graftHeroLights(m)
    expect(isHeroLit(m)).toBe(true)
    const shader = compile(m)
    expect(count(shader.fragmentShader, HERO_APPLY)).toBe(1)
    expect(count(shader.fragmentShader, 'uniform int uHeroCount;')).toBe(1)
    // The includes stay, so the other grafts (baked light, lamps) still find them.
    expect(shader.fragmentShader).toContain(`#include <lights_fragment_begin>${HERO_APPLY}`)
    expect(shader.fragmentShader).toContain('#include <lights_pars_begin>')
    expect(shader.fragmentShader.indexOf('uniform int uHeroCount;')).toBeLessThan(shader.fragmentShader.indexOf(HERO_APPLY))
    expect(shader.uniforms.uHeroCount).toBe(heroLightUniforms.uHeroCount)
    expect(m.customProgramCacheKey()).toMatch(/\|hero-v1$/)
  })

  it('composes with a painted armor copy (its own patch runs first)', () => {
    const painted = armorMaterial(new THREE.MeshStandardMaterial(), {
      maps: { asg: null, mask0: null, mask1: null },
      paint: { data: new Float32Array(0), globals: [0, 0, 1, 1], offset: [0, 0] },
      gradients: { value: new THREE.Texture() },
    })
    graftHeroLights(painted)
    const shader = compile(painted)
    expect(shader.fragmentShader).toContain('ArmorZone armor = armorPaint();')
    expect(count(shader.fragmentShader, HERO_APPLY)).toBe(1)
    expect(shader.uniforms.uArmorAsg).toBeDefined()
  })

  it('leaves non-standard materials alone (the map never takes it: it is never grafted)', () => {
    const lambert = new THREE.MeshLambertMaterial()
    graftHeroLights(lambert)
    expect(isHeroLit(lambert)).toBe(false)
  })
})

describe('setHeroRigs', () => {
  const rig = (k: number): HeroRigUniform => ({
    center: [k, k + 1, k + 2],
    directions: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    colors: [[k, 0, 0], [0, k, 0], [0, 0, k]],
  })

  it('packs centers, directions and colors per rig, and the count', () => {
    setHeroRigs([rig(1), rig(2)])
    const u = heroLightUniforms
    expect(u.uHeroCount.value).toBe(2)
    expect([...u.uHeroCenter.value.slice(0, 6)]).toEqual([1, 2, 3, 2, 3, 4])
    expect([...u.uHeroDir.value.slice(9, 18)]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
    expect([...u.uHeroColor.value.slice(9, 18)]).toEqual([2, 0, 0, 0, 2, 0, 0, 0, 2])
  })

  it('caps at HERO_LIGHTS_MAX and clears back to off', () => {
    setHeroRigs(Array.from({ length: HERO_LIGHTS_MAX + 3 }, (_, i) => rig(i)))
    expect(heroLightUniforms.uHeroCount.value).toBe(HERO_LIGHTS_MAX)
    clearHeroRigs()
    expect(heroLightUniforms.uHeroCount.value).toBe(0)
    expect(heroLightUniforms.uHeroColor.value.every((v) => v === 0)).toBe(true)
  })
})
