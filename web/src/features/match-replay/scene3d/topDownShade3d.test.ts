import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { guardMaterial } from './lighting'
import { TOP_SHADE_UNIFORMS, flatTopLight, graftTopShade } from './topDownShade3d'

const fragment = '#include <common>\nvoid main() {\n#include <lights_fragment_begin>\n#include <lights_fragment_maps>\n#include <lights_fragment_end>\n}'

function compiled(material: THREE.Material) {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '', fragmentShader: fragment }
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  return shader
}

describe('graftTopShade — the flat light of the top-down views', () => {
  it('replaces the light right before the indirect terms are applied', () => {
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: fragment }
    graftTopShade(shader)
    const s = shader.fragmentShader
    expect(s).toContain('uniform float uTopFlat;')
    expect(s.indexOf('uTopFlat > 0.5')).toBeGreaterThan(s.indexOf('#include <lights_fragment_maps>'))
    expect(s.indexOf('uTopFlat > 0.5')).toBeLessThan(s.indexOf('#include <lights_fragment_end>'))
    expect(s).toContain('reflectedLight.directDiffuse = vec3(0.0);')
  })

  it('shares one switch between every material (no copy, no recompile to toggle)', () => {
    const a = compiled(withGuard(new THREE.MeshStandardMaterial()))
    const b = compiled(withGuard(new THREE.MeshStandardMaterial()))
    expect(a.uniforms.uTopFlat).toBe(TOP_SHADE_UNIFORMS.uTopFlat)
    expect(b.uniforms.uTopFlat).toBe(TOP_SHADE_UNIFORMS.uTopFlat)
  })

  it('leaves a shader without lights alone', () => {
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: '#include <common>\nvoid main() {}' }
    graftTopShade(shader)
    expect(shader.fragmentShader).not.toContain('uTopFlat > 0.5')
  })
})

describe('flatTopLight — on only while a top-down image is drawn', () => {
  it('is off by default, on inside, and gives the switch back', () => {
    expect(TOP_SHADE_UNIFORMS.uTopFlat.value).toBe(0)
    const restore = flatTopLight()
    expect(TOP_SHADE_UNIFORMS.uTopFlat.value).toBe(1)
    const inner = flatTopLight()
    inner()
    expect(TOP_SHADE_UNIFORMS.uTopFlat.value).toBe(1)
    restore()
    expect(TOP_SHADE_UNIFORMS.uTopFlat.value).toBe(0)
  })
})

function withGuard<M extends THREE.Material>(m: M): M {
  guardMaterial(m)
  return m
}
