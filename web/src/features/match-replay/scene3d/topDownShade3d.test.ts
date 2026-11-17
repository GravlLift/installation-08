// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { guardMaterial } from './lighting'
import { LOW_SHADE, LOW_TINT, MIN_SPAN, TOP_SHADE_UNIFORMS, flatTopLight, graftTopShade, heightShade } from './topDownShade3d'

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
    expect(s).toContain('vec3 topHeightShade(float y)')
    expect(s).toContain('irradiance *= topHeightShade(topWorld.y);')
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

describe('heightShade — levels read by world height, fixed for the match', () => {
  const lum = (c: readonly number[]) => (c[0] + c[1] + c[2]) / 3
  const span = { low: -2, high: 10 }

  it('is full on the highest walked floor and over it', () => {
    expect(heightShade(10, span)).toEqual([1, 1, 1])
    expect(heightShade(30, span)).toEqual([1, 1, 1])
  })

  it('is the low shade, cool, on the lowest walked floor and under it', () => {
    const low = heightShade(-2, span)
    expect(low[0]).toBeCloseTo(LOW_SHADE * LOW_TINT[0])
    expect(low[2]).toBeCloseTo(LOW_SHADE * LOW_TINT[2])
    expect(heightShade(-40, span)).toEqual(low)
  })

  it('steps each floor between by its height', () => {
    expect(lum(heightShade(2, span))).toBeLessThan(lum(heightShade(6, span)))
    expect(lum(heightShade(-2, span))).toBeLessThan(lum(heightShade(2, span)))
  })

  it('keeps the lowest floor clearly visible', () => {
    expect(lum(heightShade(-2, span))).toBeGreaterThan(0.5)
  })

  it('depends on the height alone: the same at every frame', () => {
    expect(heightShade(4, span)).toEqual(heightShade(4, { ...span }))
  })

  it('is even without a span, or on a one-level map', () => {
    expect(heightShade(-20, null)).toEqual([1, 1, 1])
    expect(heightShade(0, { low: 0, high: MIN_SPAN / 2 })).toEqual([1, 1, 1])
  })
})

describe('flatTopLight — on only while a top-down image is drawn', () => {
  it('shades by the span it is given, and not without one or on a one-level map', () => {
    const u = TOP_SHADE_UNIFORMS
    const restore = flatTopLight({ low: 1, high: 9 })
    expect([u.uTopRamp.value, u.uTopLow.value, u.uTopHigh.value]).toEqual([1, 1, 9])
    const none = flatTopLight(null)
    expect(u.uTopRamp.value).toBe(0)
    none()
    const thin = flatTopLight({ low: 0, high: MIN_SPAN / 2 })
    expect(u.uTopRamp.value).toBe(0)
    thin()
    expect([u.uTopRamp.value, u.uTopLow.value, u.uTopHigh.value]).toEqual([1, 1, 9])
    restore()
    expect([u.uTopFlat.value, u.uTopRamp.value]).toEqual([0, 0])
  })

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
