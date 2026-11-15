import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { guardMaterial } from './lighting'
import { CUT_HEADROOM } from './topDownLogic'
import { ABOVE_LIFT, BELOW_SHADE, BELOW_TINT, SHADE_DEPTH, SHADE_START, TOP_SHADE_UNIFORMS, flatTopLight, graftTopShade, heightShade } from './topDownShade3d'

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

describe('heightShade — levels read by height around the followed floor', () => {
  const lum = (c: readonly number[]) => (c[0] + c[1] + c[2]) / 3

  it('is full on his floor and a few steps down', () => {
    expect(heightShade(10, 10)).toEqual([1, 1, 1])
    expect(lum(heightShade(10 - SHADE_START, 10))).toBeCloseTo(1)
  })

  it('darkens each floor below a step more, down to the floor of the ramp', () => {
    const one = lum(heightShade(10 - 3, 10))
    const two = lum(heightShade(10 - 6, 10))
    expect(one).toBeLessThan(1)
    expect(two).toBeLessThan(one)
    const deep = heightShade(10 - 50, 10)
    expect(deep[0]).toBeCloseTo(BELOW_SHADE * BELOW_TINT[0])
    expect(deep[2]).toBeCloseTo(BELOW_SHADE * BELOW_TINT[2])
    expect(heightShade(10 - SHADE_START - SHADE_DEPTH, 10)).toEqual(deep)
  })

  it('keeps a lower floor clearly visible', () => {
    expect(lum(heightShade(-100, 0))).toBeGreaterThan(0.35)
  })

  it('lifts what stands over his floor a little, up to the cut', () => {
    const top = heightShade(CUT_HEADROOM, 0)
    expect(top[0]).toBeCloseTo(1 + ABOVE_LIFT)
    expect(heightShade(CUT_HEADROOM * 3, 0)).toEqual(top)
    expect(heightShade(CUT_HEADROOM / 2, 0)[0]).toBeLessThan(top[0])
  })

  it('is even without a floor (the ghost of the floors above)', () => {
    expect(heightShade(-20, null)).toEqual([1, 1, 1])
  })
})

describe('flatTopLight — on only while a top-down image is drawn', () => {
  it('shades by height around the floor it is given, and not without one', () => {
    const u = TOP_SHADE_UNIFORMS
    const restore = flatTopLight(4.5)
    expect([u.uTopRamp.value, u.uTopFloorY.value]).toEqual([1, 4.5])
    const ghost = flatTopLight(null)
    expect(u.uTopRamp.value).toBe(0)
    ghost()
    expect([u.uTopRamp.value, u.uTopFloorY.value]).toEqual([1, 4.5])
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
