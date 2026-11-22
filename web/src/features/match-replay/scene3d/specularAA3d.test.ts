// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { ShaderLib } from 'three'
import { describe, expect, it } from 'vitest'

import { guardMaterial } from './lighting'
import { LIGHTS_PHYSICAL_INCLUDE, MAP_ANISOTROPY, filterAnisotropically, specularAntialias } from './specularAA3d'

describe('specularAntialias — the map highlights widened where the shaded normal turns within a pixel', () => {
  it('follows three.js r170 physical shader, after the includes it reads', () => {
    const fragment = ShaderLib.physical.fragmentShader
    const n = fragment.indexOf('#include <normal_fragment_maps>')
    const l = fragment.indexOf(LIGHTS_PHYSICAL_INCLUDE)
    expect(n).toBeGreaterThan(0)
    expect(l).toBeGreaterThan(n)
    const s = specularAntialias(fragment)
    const widen = s.indexOf('specularAAKernel')
    expect(widen).toBeGreaterThan(s.indexOf(LIGHTS_PHYSICAL_INCLUDE))
    expect(widen).toBeLessThan(s.indexOf('#include <lights_fragment_begin>'))
    expect(s).toContain('dFdx( normal )')
    expect(s).toContain('min( 2.0 * specularAAVariance, 0.20 )')
  })

  it('leaves a shader without physical lighting alone', () => {
    expect(specularAntialias('void main() {}')).toBe('void main() {}')
  })

  it('is part of every guarded map material, with a program key of its own', () => {
    const m = new THREE.MeshStandardMaterial()
    m.customProgramCacheKey = () => 'couches-v6'
    guardMaterial(m)
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '', fragmentShader: ShaderLib.physical.fragmentShader }
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
    expect(shader.fragmentShader).toContain('specularAAKernel')
    expect(m.customProgramCacheKey()).toBe('couches-v6|guard-specaa1')
  })
})

describe('filterAnisotropically — the map textures filtered along a pixel\'s long axis', () => {
  it('sets the slots and the layers\' maps the material names', () => {
    const own = new THREE.Texture()
    const layer = new THREE.Texture()
    const m = new THREE.MeshStandardMaterial({ map: own })
    m.userData.textures = [layer]
    filterAnisotropically(m)
    expect(own.anisotropy).toBe(MAP_ANISOTROPY)
    expect(layer.anisotropy).toBe(MAP_ANISOTROPY)
  })

  it('keeps a higher anisotropy already set', () => {
    const t = new THREE.Texture()
    t.anisotropy = 16
    filterAnisotropically(new THREE.MeshStandardMaterial({ map: t }))
    expect(t.anisotropy).toBe(16)
  })
})
