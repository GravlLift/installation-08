// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

import { BLOOM_EXCESS_MAX, BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD, GlowBloomPass } from './bloom3d'
import { FILM_LOOK_DEFAULTS, filmSeed, seedOffset, warmthGain } from './filmLook3d'
import { buildPostFx, FILM_AGX_TONE_MAPPING, GRADE_GAIN, PASS_NAMES, type PostFx3d } from './postFx3d'
import type { Outline3d } from './outline3d'

/** Fake renderer: the compositor only reads its pixel ratio from it (the target is supplied). */
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

describe('buildPostFx — the film look', () => {
  afterEach(() => vi.restoreAllMocks())

  /** A fake renderer with the view's own tone mapping; `seen` records what the output pass drew with. */
  function filmRig(bloom: boolean) {
    const seen: [THREE.ToneMapping, number][] = []
    vi.spyOn(OutputPass.prototype, 'render').mockImplementation(function (this: OutputPass, r: THREE.WebGLRenderer) {
      seen.push([r.toneMapping, r.toneMappingExposure])
    })
    const renderer = {
      getPixelRatio: () => 1,
      info: { render: { calls: 0, triangles: 0 } },
      toneMapping: THREE.ACESFilmicToneMapping as THREE.ToneMapping,
      toneMappingExposure: 1.15,
    } as unknown as THREE.WebGLRenderer
    const fx = buildPostFx(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), bloom)
    const drawOutput = () => (fx.output.render as (...a: unknown[]) => void)(renderer, null, null, 0, false)
    return { fx, renderer, seen, drawOutput }
  }

  it("keeps the view's ACES by default and only changes the exposure, for the output pass alone", () => {
    const { fx, renderer, seen, drawOutput } = filmRig(false)
    try {
      drawOutput()
      fx.setFilmLook({ preset: 'film', exposure: 1 }, 1000)
      expect(fx.film?.tone).toBe('aces')
      drawOutput()
      expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping)
      expect(renderer.toneMappingExposure).toBe(1.15)
      fx.setFilmLook(null)
      drawOutput()
      expect(seen).toEqual([
        [THREE.ACESFilmicToneMapping, 1.15],
        [THREE.ACESFilmicToneMapping, 2.3],
        [THREE.ACESFilmicToneMapping, 1.15],
      ])
    } finally {
      fx.dispose()
    }
  })

  it("tone maps with AgX only when the look asks (tone: 'agx'), and gives the renderer its settings back", () => {
    const { fx, renderer, seen, drawOutput } = filmRig(false)
    try {
      fx.setFilmLook({ preset: 'film', tone: 'agx' }, 0)
      drawOutput()
      expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping)
      expect(renderer.toneMappingExposure).toBe(1.15)
      expect(seen).toEqual([[FILM_AGX_TONE_MAPPING, 1.15]])
      expect(FILM_AGX_TONE_MAPPING).toBe(THREE.AgXToneMapping)
    } finally {
      fx.dispose()
    }
  })

  it('after setFilmLook alone (no knobs applied), composer.render runs the film pass, enabled, between SMAA and the line, with the look uniforms', () => {
    const { fx } = filmRig(false)
    try {
      fx.setFilmLook({ preset: 'film', vignette: 0.6, contrast: 1.6, grain: 0.3 }, 2500)
      const film = fx.filmPass!
      expect(fx.composer.passes).toContain(film)
      expect(film.enabled).toBe(true)
      expect(film.uniforms.uVignette.value).toBe(0.6)
      expect(film.uniforms.uContrast.value).toBe(1.6)
      expect(film.uniforms.uGrain.value).toBe(0.3)
      // Every pass's draw stubbed: the composer's own loop decides which run, in which order, from which buffer.
      const ran: { pass: unknown; read: unknown; write: unknown; screen: boolean }[] = []
      for (const pass of fx.composer.passes) {
        vi.spyOn(pass, 'render').mockImplementation(function (this: typeof pass, _r: unknown, write: unknown, read: unknown) {
          ran.push({ pass: this, read, write, screen: this.renderToScreen })
        } as never)
      }
      const composerRenderer = fx.composer.renderer as unknown as Record<string, unknown>
      composerRenderer.getRenderTarget = () => null
      composerRenderer.setRenderTarget = () => {}
      fx.composer.render(0)
      const order = ran.map((r) => r.pass)
      const at = order.indexOf(film)
      expect(at).toBe(order.indexOf(fx.smaa) + 1)
      expect(order[at + 1]).toBe(fx.outline.linePass)
      expect(ran[at].screen).toBe(false)
      expect(ran[at].read).toBe(ran[at - 1].write) // it reads what SMAA wrote
      expect(ran[at + 1].read).toBe(ran[at].write) // and the line reads what it wrote
    } finally {
      fx.dispose()
    }
  })

  it('forces bloom on at the look strength, puts the film pass between SMAA and the outline line, and clearing restores the exact chain', () => {
    const { fx } = filmRig(false)
    try {
      const before = [...fx.composer.passes]
      fx.setFilmLook({ preset: 'film', bloom: 0.8 }, 0)
      const passes = fx.composer.passes
      expect(fx.bloom).toBeInstanceOf(GlowBloomPass)
      expect(fx.bloom!.strength).toBe(0.8)
      expect(passes.indexOf(fx.bloom!)).toBe(passes.findIndex((p) => p instanceof OutputPass) - 1)
      const film = fx.filmPass!
      expect(passes.indexOf(film)).toBe(passes.indexOf(fx.smaa) + 1)
      expect(passes[passes.length - 1]).toBe(fx.outline.linePass) // grain and vignette never touch the line
      expect(film.material.depthTest).toBe(false)
      expect(film.material.depthWrite).toBe(false)
      // The drawer turning bloom off while the look plays changes nothing until the look ends.
      fx.setBloom(false)
      expect(fx.bloom).not.toBeNull()
      const release = vi.spyOn(film, 'dispose')
      fx.setFilmLook(null)
      expect(release).toHaveBeenCalledTimes(1)
      expect(fx.film).toBeNull()
      expect(fx.filmPass).toBeNull()
      expect(fx.bloom).toBeNull()
      expect(fx.composer.passes.length).toBe(before.length)
      fx.composer.passes.forEach((p, i) => expect(p).toBe(before[i]))
      expect((fx.grade.uniforms.uGain.value as THREE.Vector3).toArray()).toEqual(GRADE_GAIN)
      fx.setFilmLook(null) // idempotent
      expect(fx.composer.passes.length).toBe(before.length)
    } finally {
      fx.dispose()
    }
  })

  it("with the drawer's bloom on, the same pass is kept and goes back to the view's strength", () => {
    const { fx } = filmRig(true)
    try {
      const pass = fx.bloom!
      expect(pass.strength).toBe(BLOOM_STRENGTH)
      fx.setFilmLook({ preset: 'film' }, 0)
      expect(fx.bloom).toBe(pass)
      expect(pass.strength).toBe(FILM_LOOK_DEFAULTS.bloom)
      fx.setFilmLook(null)
      expect(fx.bloom).toBe(pass)
      expect(pass.strength).toBe(BLOOM_STRENGTH)
    } finally {
      fx.dispose()
    }
  })

  it('sets the film uniforms from the look, and seeds the grain from the script time of each frame', () => {
    const { fx } = filmRig(false)
    try {
      const look = { preset: 'film' as const, contrast: 1.4, saturation: 0.7, vignette: 0.5, grain: 0.6, warmth: 1 }
      fx.setFilmLook(look, 1000)
      const u = fx.filmPass!.uniforms
      expect(u.uContrast.value).toBe(1.4)
      expect(u.uSaturation.value).toBe(0.7)
      expect(u.uVignette.value).toBe(0.5)
      expect(u.uGrain.value).toBe(0.6)
      expect((u.uWarmth.value as THREE.Vector3).toArray()).toEqual(warmthGain(1))
      const offset = () => (u.uSeedOffset.value as THREE.Vector2).toArray()
      const seed = offset()
      expect(seed).toEqual(seedOffset(filmSeed(1000)))
      fx.setFilmLook(look, 1000)
      expect(offset()).toEqual(seed) // the same frame, the same grain
      fx.setFilmLook(look, 1016.7)
      expect(offset()).not.toEqual(seed)
      const pass = fx.filmPass
      fx.setFilmLook({ ...look, grain: 0 }, 1016.7) // a new look object: values follow, the pass stays
      expect(fx.filmPass).toBe(pass)
      expect(u.uGrain.value).toBe(0)
    } finally {
      fx.dispose()
    }
  })
})

describe('buildPostFx — the compositor chain', () => {
  it("grading follows output, precedes SMAA, and the outline's line stays last", () => {
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

  it("grading has neither depth test nor depth write; its gain is GRADE_GAIN", () => {
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
