import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

import { BLOOM_EXCESS_MAX, BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD, GlowBloomPass } from './bloom3d'
import { buildPostFx, GRADE_GAIN, PASS_NAMES, type PostFx3d } from './postFx3d'
import type { Outline3d } from './outline3d'

/** Renderer factice : le compositeur n'en lit que le ratio de pixels (la cible est fournie). */
function rendererFactice(): THREE.WebGLRenderer {
  return { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer
}

/** Where the bloom pass sits: its index, the ambient occlusion's and the output's. */
function places(fx: PostFx3d) {
  const passes = fx.composer.passes
  return {
    bloom: passes.findIndex((p) => p instanceof GlowBloomPass),
    ao: passes.findIndex((p) => p instanceof GTAOPass),
    output: passes.findIndex((p) => p instanceof OutputPass),
  }
}

describe('buildPostFx — the bloom pass', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sits on the HDR image, between the ambient occlusion and the output (tone mapping), when on', () => {
    const fx = buildPostFx(rendererFactice(), new THREE.Scene(), new THREE.PerspectiveCamera())
    try {
      const at = places(fx)
      expect(fx.bloom).toBeInstanceOf(GlowBloomPass)
      expect(at.bloom).toBe(at.ao + 1)
      expect(at.output).toBe(at.bloom + 1)
      expect(fx.composer.passes[at.bloom]).toBe(fx.bloom)
      expect(PASS_NAMES.indexOf('bloom')).toBe(PASS_NAMES.indexOf('ao') + 1)
      expect(PASS_NAMES.indexOf('output')).toBe(PASS_NAMES.indexOf('bloom') + 1)
    } finally {
      fx.dispose()
    }
  })

  it('is absent from the chain when off, and comes back in the same place', () => {
    const fx = buildPostFx(rendererFactice(), new THREE.Scene(), new THREE.PerspectiveCamera(), false)
    try {
      const count = fx.composer.passes.length
      expect(fx.bloom).toBeNull()
      expect(places(fx).bloom).toBe(-1)
      fx.setBloom(true)
      const pass = fx.bloom!
      expect(fx.composer.passes.length).toBe(count + 1)
      expect(places(fx).bloom).toBe(places(fx).ao + 1)
      const release = vi.spyOn(pass, 'dispose')
      fx.setBloom(false)
      expect(fx.bloom).toBeNull()
      expect(fx.composer.passes).not.toContain(pass)
      expect(fx.composer.passes.length).toBe(count)
      expect(release).toHaveBeenCalledTimes(1) // its render targets are released
      fx.setBloom(false) // idempotent
      expect(fx.composer.passes.length).toBe(count)
    } finally {
      fx.dispose()
    }
  })

  it('carries the named constants, adds its halo ONE/ONE and keys on the brightest channel', () => {
    const pass = new GlowBloomPass()
    try {
      expect(pass.threshold).toBe(BLOOM_THRESHOLD)
      expect(pass.strength).toBe(BLOOM_STRENGTH)
      expect(pass.radius).toBe(BLOOM_RADIUS)
      expect(pass.materialHighPassFilter.uniforms.excessMax.value).toBe(BLOOM_EXCESS_MAX)
      expect(pass.materialHighPassFilter.fragmentShader).toContain('max(c.r, max(c.g, c.b))')
      const add = pass.blendMaterial
      expect(add.blending).toBe(THREE.CustomBlending)
      expect([add.blendSrc, add.blendDst, add.blendSrcAlpha, add.blendDstAlpha]).toEqual([THREE.OneFactor, THREE.OneFactor, THREE.ZeroFactor, THREE.OneFactor])
      expect(add.depthTest).toBe(false)
      expect(add.depthWrite).toBe(false)
    } finally {
      pass.dispose()
    }
  })

  it("meters its draws as 'bloom' and times it on the GPU only on the frames that ask", () => {
    const info = { render: { calls: 0, triangles: 0 } }
    const renderer = { getPixelRatio: () => 1, info } as unknown as THREE.WebGLRenderer
    vi.spyOn(UnrealBloomPass.prototype, 'render').mockImplementation(() => { info.render.calls += 13; info.render.triangles += 13 })
    const fx = buildPostFx(renderer, new THREE.Scene(), new THREE.PerspectiveCamera())
    try {
      const begin = vi.spyOn(fx.bloomGpu, 'begin')
      const end = vi.spyOn(fx.bloomGpu, 'end')
      const draw = () => (fx.bloom!.render as (...a: unknown[]) => void)(renderer, null, null, 0, false)
      draw()
      expect(fx.costs.bloom).toEqual({ calls: 13, triangles: 13 })
      expect(begin).not.toHaveBeenCalled()
      fx.timeBloom = true
      draw()
      expect(begin).toHaveBeenCalledTimes(1)
      expect(end).toHaveBeenCalledTimes(1)
      fx.resetCosts()
      expect(fx.costs.bloom).toEqual({ calls: 0, triangles: 0 })
    } finally {
      fx.dispose()
    }
  })
})

describe('buildPostFx — la chaîne du compositeur', () => {
  it("la teinte suit la sortie, précède le SMAA, et la ligne du contour reste en dernier", () => {
    const fx = buildPostFx(rendererFactice(), new THREE.Scene(), new THREE.PerspectiveCamera())
    try {
      const passes = fx.composer.passes
      const iSortie = passes.indexOf(passes.find((p) => p.constructor.name === 'OutputPass')!)
      const iTeinte = passes.indexOf(fx.grade)
      const iSmaa = passes.indexOf(passes.find((p) => (p as SMAAPass).materialBlend !== undefined)!)
      expect(iSortie).toBeGreaterThanOrEqual(0)
      expect(iTeinte).toBe(iSortie + 1)
      expect(iSmaa).toBe(iTeinte + 1)
      expect(passes[passes.length - 1]).toBe((fx.outline as Outline3d).linePass)
    } finally {
      fx.dispose()
    }
  })

  it("la teinte n'a ni test ni écriture en profondeur ; son gain est celui de la teinte", () => {
    const fx = buildPostFx(rendererFactice(), new THREE.Scene(), new THREE.PerspectiveCamera())
    try {
      expect(fx.grade.material.depthTest).toBe(false)
      expect(fx.grade.material.depthWrite).toBe(false)
      const gain = fx.grade.uniforms.uGain.value as THREE.Vector3
      expect(gain.toArray()).toEqual(GRADE_GAIN)
    } finally {
      fx.dispose()
    }
  })
})
