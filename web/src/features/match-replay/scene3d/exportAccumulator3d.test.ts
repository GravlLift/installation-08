// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * exportAccumulator3d.test.ts — the accumulator's GL choreography on a renderer double: the sum
 * cleared to zero (the scene's clear color put back), each subframe copied and added without a
 * clear, the average weighted by subframes and supersampled block, the targets kept between
 * frames of one size and released at the end. The shaders themselves run only in a browser.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { ExportAccumulator3d, renderSize } from './exportAccumulator3d'

function rendererDouble(floatBlend = true) {
  const log: string[] = []
  const scene = new THREE.Color(0.2, 0.3, 0.4)
  const clear = scene.clone()
  let clearAlpha = 1
  let bound: THREE.WebGLRenderTarget | null = null
  const r = {
    autoClear: true,
    extensions: { has: (name: string) => name === 'EXT_float_blend' && floatBlend },
    getClearColor: (c: THREE.Color) => c.copy(clear),
    getClearAlpha: () => clearAlpha,
    setClearColor: (c: THREE.ColorRepresentation, a: number) => {
      clear.set(c)
      clearAlpha = a
      const name = clear.equals(scene) ? 'scene' : clear.getHex() === 0 ? 'zero' : 'other'
      log.push(`clearColor ${name} ${a}`)
    },
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { bound = t; log.push(t ? `bind ${t.width}x${t.height}` : 'bind screen') },
    clear: () => log.push('clear'),
    copyFramebufferToTexture: (t: THREE.Texture) => log.push(`copy ${t.image.width}x${t.image.height}${bound ? ' FROM A TARGET' : ''}`),
    render: () => log.push(`draw autoClear=${r.autoClear}`),
  }
  return { r, log, bound: () => bound }
}

describe('ExportAccumulator3d', () => {
  it('clears the sum to zero and gives the scene its clear color back', () => {
    const { r, log } = rendererDouble()
    const acc = new ExportAccumulator3d(r as never)
    acc.begin(100, 50, 1)
    expect(log).toEqual(['bind 100x50', 'clearColor zero 0', 'clear', 'clearColor scene 1', 'bind screen'])
  })

  it('adds each subframe from the default framebuffer without clearing, and resolves at the file size, left bound', () => {
    const { r, log, bound } = rendererDouble()
    const acc = new ExportAccumulator3d(r as never)
    acc.begin(100, 50, 2)
    log.length = 0
    acc.add()
    acc.add()
    expect(log).toEqual([
      'copy 200x100', 'bind 200x100', 'draw autoClear=false', 'bind screen',
      'copy 200x100', 'bind 200x100', 'draw autoClear=false', 'bind screen',
    ])
    expect(r.autoClear).toBe(true) // put back
    expect(acc.resolve()).toEqual({ width: 100, height: 50 })
    expect(bound()?.width).toBe(100) // the 8-bit output stays bound for readPixels
    // Two subframes, 2x2 supersampled: each file pixel is the mean of 8 samples.
    const u = (acc as unknown as { resolveMaterial: THREE.ShaderMaterial }).resolveMaterial.uniforms
    expect(u.uWeight.value).toBeCloseTo(1 / 8, 12)
    expect(u.uScale.value).toBe(2)
  })

  it('keeps its targets between frames of one size, reallocates on a new one, and sums in float when it can blend', () => {
    const { r } = rendererDouble()
    const acc = new ExportAccumulator3d(r as never)
    acc.begin(100, 50, 1)
    const sum = (acc as unknown as { sum: THREE.WebGLRenderTarget }).sum
    expect(sum.texture.type).toBe(THREE.FloatType)
    acc.begin(100, 50, 1)
    expect((acc as unknown as { sum: THREE.WebGLRenderTarget }).sum).toBe(sum)
    acc.begin(200, 100, 1)
    expect((acc as unknown as { sum: THREE.WebGLRenderTarget }).sum).not.toBe(sum)
    acc.dispose()
    expect((acc as unknown as { sum: THREE.WebGLRenderTarget | null }).sum).toBeNull()
  })

  it('half float without float blending', () => {
    const { r } = rendererDouble(false)
    const acc = new ExportAccumulator3d(r as never)
    acc.begin(10, 10, 1)
    expect((acc as unknown as { sum: THREE.WebGLRenderTarget }).sum.texture.type).toBe(THREE.HalfFloatType)
  })

  it('renderSize floors as the renderer sizes its drawing buffer', () => {
    expect(renderSize(1920, 1080, 2)).toEqual({ width: 3840, height: 2160 })
    expect(renderSize(1281, 721, 1)).toEqual({ width: 1281, height: 721 })
  })
})
