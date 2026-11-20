// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * postFx3d.ts — THE 3D SCENE'S COMPOSITOR: scene render into a target that keeps its depth, team
 * outline mask (`outline3d`), ambient occlusion, screen color space conversion, anti-aliasing
 * (SMAA), then the outline's line.
 *
 * Screen-space ambient occlusion (GTAO): the darkening of corners and crevices that game
 * lighting carries. It reuses the main pass's depth instead of re-rendering the scene into a
 * normal material: normals are reconstructed from it, faceted like the GLB with no vertex
 * normals. Radius in world units (0.6 u ~ 1.8 m), denoising over 6 px.
 *
 * Bloom (`bloom3d`): the glow of self-lit surfaces, on the HDR image between the ambient
 * occlusion and the output pass. Present only while the drawer's "Bloom" setting is on
 * (`setBloom`): off, the pass leaves the chain and its render targets are released.
 *
 * Depth of field (`dof3d`): a camera script's lens, on the HDR image after the bloom and before
 * the output pass. Present only while the current script pose has a lens (`setLens`); without
 * one the pass is out of the chain and the image is exactly the default look.
 *
 * Film look (`filmLook3d`, a camera script's `look`): while set (`setFilmLook`), the output pass
 * tone maps at the look's exposure, on the view's ACES or, when the look asks, AgX (the
 * renderer's own settings are swapped in only around that pass, so nothing else drawn sees
 * them); bloom is in the chain at the look's strength whatever the drawer says; and a film pass
 * (film curve, saturation, warmth, vignette, grain) runs after SMAA, before the outline's line.
 * Cleared, the chain is the default one again, with the drawer's bloom setting.
 *
 * Highlight ceiling (`highlightCeiling3d`, `highlightMeter3d`): while on (`setHighlightCeiling`,
 * the perspective view), the output pass first meters the HDR image it receives and multiplies it
 * by the eased ceiling's gain (1 or less) before tone mapping, so a frame's pale surfaces keep
 * detail. Its easing runs on the clock `setExposureClock` gives (wall clock on screen, the file
 * frame's time in an export); `resetExposure` makes the next frame take its own ceiling at once.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'

import { BLOOM_STRENGTH, GlowBloomPass } from './bloom3d'
import { DofPass, type Lens3d } from './dof3d'
import { FILM_FRAGMENT, filmSeed, resolveFilmLook, seedOffset, warmthGain, type FilmLook, type FilmLookSettings } from './filmLook3d'
import { GpuTimer } from './gpuTimer3d'
import { HighlightMeter3d } from './highlightMeter3d'
import { Outline3d } from './outline3d'

export interface PostFx3d {
  composer: EffectComposer
  gtao: GTAOPass
  /** The bloom pass while the setting is on, null while it is off (out of the chain). */
  readonly bloom: GlowBloomPass | null
  grade: ShaderPass
  output: OutputPass
  smaa: SMAAPass
  outline: Outline3d
  /** What each pass drew at the last frames since `resetCosts` (`renderer.info`), for the playback meter. */
  costs: Record<PassName, PassCost>
  /**
   * The GPU time of the bloom pass alone (ms, smoothed; null until measured, without the timer
   * extension, or with bloom off). Measured only on frames that set `timeBloom`: a WebGL timer
   * query cannot run inside the frame's own (`gpuTimer3d`).
   */
  readonly bloomGpu: GpuTimer
  /** True for a frame whose bloom pass is to be timed by `bloomGpu` (the frame's own timer then stays off). */
  timeBloom: boolean
  /** The depth of field pass while a lens is set, null while none is (out of the chain). */
  readonly dof: DofPass | null
  /**
   * setLens sets the frame's lens (a playing camera script's focus distance and f-number): the
   * depth of field pass enters the chain before the output pass, or, with null, leaves it and is
   * released. Called every frame; only a change of presence touches the chain.
   */
  setLens(lens: Lens3d | null): void
  /**
   * setBloom puts the bloom pass in the chain (before the depth of field, else the output pass)
   * or takes it out and releases it: the drawer's setting. A film look keeps the pass in while it is set.
   */
  setBloom(on: boolean): void
  /** The film look being drawn, resolved, or null for the default look. */
  readonly film: FilmLookSettings | null
  /** The film pass while a film look is set (after SMAA, before the outline's line), else null. */
  readonly filmPass: ShaderPass | null
  /**
   * setFilmLook draws `look` (a camera script's), or the default look for null; `scriptMs`, the
   * script time of the frame about to be drawn, seeds its grain. Called every frame: a look
   * already set only has its seed (and its values, when the object changes) updated.
   */
  setFilmLook(look: FilmLook | null, scriptMs?: number): void
  /** The highlight ceiling's meter (`highlightMeter3d`). */
  readonly meter: HighlightMeter3d
  /** setHighlightCeiling turns the highlight ceiling on (the perspective view) or off (top-down). */
  setHighlightCeiling(on: boolean): void
  /** setExposureClock: the time (ms) of the frame about to be drawn, the ceiling's easing clock. */
  setExposureClock(ms: number): void
  /** resetExposure: the next frame drawn takes its own ceiling at once. */
  resetExposure(): void
  /** The last drawn frame's ceiling in stops (0 or less; a GPU read), null while the ceiling is off. */
  readCeilingStops(): number | null
  resetCosts(): void
  dispose(): void
}

/** The composer's passes, in order, as the playback meter names them. */
export const PASS_NAMES = ['scene', 'outlineMask', 'ao', 'bloom', 'output', 'grade', 'smaa', 'outlineLine'] as const
export type PassName = (typeof PASS_NAMES)[number]
export interface PassCost { calls: number; triangles: number }

/**
 * Per-channel gain (red, green, blue) in screen space: applied after output, it cools the image
 * to bring it back to the game's own (measured on recordings). The outline's line passes after,
 * it keeps its exact color.
 */
export const GRADE_GAIN = [0.93, 1.02, 1.07]

/** Grade pass: multiplies the screen color by `GRADE_GAIN`. */
const shaderGrade = {
  name: 'Grade',
  uniforms: {
    tDiffuse: { value: null },
    uGain: { value: new THREE.Vector3(...GRADE_GAIN) },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; uniform vec3 uGain; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(c.rgb * uGain, c.a); }',
}

/** The output shader's first line, after which the highlight ceiling's gain is applied. */
const OUTPUT_READ = 'gl_FragColor = texture2D( tDiffuse, vUv );'

/**
 * graftHighlightCeiling makes the output pass multiply its HDR input by the highlight ceiling's
 * gain (`tCeiling`'s G, 1 or less) before tone mapping, while `uCeilingOn` is 1; at 0 the shader
 * computes exactly what it did before. Throws if three's output shader no longer has the line it
 * grafts after (an upgrade must not drop the ceiling silently).
 */
export function graftHighlightCeiling(output: OutputPass, ceiling: THREE.Texture | null): CeilingUniforms {
  const material = output.material as THREE.ShaderMaterial
  const source = material.fragmentShader
  if (!source.includes(OUTPUT_READ)) throw new Error('three OutputShader changed: the highlight ceiling cannot be grafted')
  material.fragmentShader = source
    .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D tCeiling;\nuniform float uCeilingOn;')
    .replace(OUTPUT_READ, `${OUTPUT_READ}\nif (uCeilingOn > 0.5) gl_FragColor.rgb *= texture2D( tCeiling, vec2( 0.5 ) ).g;`)
  // The pass's uniforms are its material's (the same object): the new ones reach the shader.
  const uniforms = output.uniforms as Record<string, THREE.IUniform>
  const grafted: CeilingUniforms = { tCeiling: { value: ceiling }, uCeilingOn: { value: 0 } }
  Object.assign(uniforms, grafted)
  material.needsUpdate = true
  return grafted
}

/** The output pass's highlight-ceiling uniforms (`graftHighlightCeiling`). */
export interface CeilingUniforms {
  tCeiling: THREE.IUniform<THREE.Texture | null>
  uCeilingOn: THREE.IUniform<number>
}

/** The tone curve of a film look with `tone: 'agx'`; with 'aces' (the default) the view's own curve stays (ACES, set by `lighting`). */
export const FILM_AGX_TONE_MAPPING = THREE.AgXToneMapping

/** The film pass's shader (`filmLook3d`): its uniforms are set from the look each frame. */
function shaderFilm() {
  return {
    name: 'FilmLook',
    uniforms: {
      tDiffuse: { value: null },
      uWarmth: { value: new THREE.Vector3(1, 1, 1) },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
      uVignette: { value: 0 },
      uGrain: { value: 0 },
      uSeedOffset: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader: shaderGrade.vertexShader,
    fragmentShader: FILM_FRAGMENT,
  }
}

/** buildPostFx builds the passes for scene `scene` as seen by `camera`; `bloom`: the bloom pass starts in the chain. */
export function buildPostFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, bloom = true): PostFx3d {
  // The scene's depth stays readable after its render: ambient occlusion compares against it.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) })
  const composer = new EffectComposer(renderer, target)
  const scenePass = new DepthKeepingRenderPass(scene, camera)
  composer.addPass(scenePass)
  const outline = new Outline3d(camera)
  composer.addPass(outline.maskPass)
  const gtao = new GtaoScenePass(scene, camera)
  gtao.updateGtaoMaterial({ radius: 0.6, thickness: 1, distanceFallOff: 1, scale: 1 })
  gtao.updatePdMaterial({ radius: 6 })
  composer.addPass(gtao)
  const output = new OutputPass()
  // A full-screen quad has nothing to depth-test or depth-write: the scene's depth must reach
  // ambient occlusion intact (the target it writes to may be the scene's).
  output.material.depthTest = false
  output.material.depthWrite = false
  // The highlight ceiling's gain, read by the output pass before tone mapping (1 while off).
  const meter = new HighlightMeter3d()
  const ceilingUniforms = graftHighlightCeiling(output, meter.texture)
  // Off until the scene turns it on (`setHighlightCeiling`, every drawn frame of the perspective view).
  let ceilingOn = false
  let exposureClock = Number.NaN
  // A film look tone maps this pass alone at its exposure (and with AgX when it asks): the
  // renderer's settings are swapped in for the pass and given back after it (the minimap, drawn
  // straight to the screen after the composer, keeps the view's own).
  const outputRender = output.render.bind(output) as (renderer: THREE.WebGLRenderer, ...rest: unknown[]) => void
  output.render = ((renderer: THREE.WebGLRenderer, ...rest: unknown[]) => {
    const film = fx.film
    // The ceiling meters the HDR image this pass is about to tone map (its read buffer), with the
    // view's own exposure (the film's stops are swapped in below, and enter through the chain).
    const readBuffer = rest[1] as THREE.WebGLRenderTarget | null
    const metered = ceilingOn && readBuffer !== null
    ceilingUniforms.uCeilingOn.value = metered ? 1 : 0
    if (metered) {
      meter.setChain({ exposure: renderer.toneMappingExposure, grade: GRADE_GAIN as [number, number, number], film })
      meter.update(renderer, readBuffer.texture, exposureClock)
      ceilingUniforms.tCeiling.value = meter.texture
    }
    if (!film) return outputRender(renderer, ...rest)
    const toneMapping = renderer.toneMapping
    const exposure = renderer.toneMappingExposure
    if (film.tone === 'agx') renderer.toneMapping = FILM_AGX_TONE_MAPPING
    renderer.toneMappingExposure = exposure * Math.pow(2, film.exposure)
    try {
      outputRender(renderer, ...rest)
    } finally {
      renderer.toneMapping = toneMapping
      renderer.toneMappingExposure = exposure
    }
  }) as never
  composer.addPass(output)
  // Image grading, between output and anti-aliasing: the outline, after, keeps its color.
  const grade = new ShaderPass(shaderGrade)
  // Same rule as output: the full-screen quad has nothing to depth-test or depth-write, the
  // scene's depth must reach ambient occlusion intact.
  grade.material.depthTest = false
  grade.material.depthWrite = false
  composer.addPass(grade)
  // Anti-aliasing of the image in screen colors, before the outline's line (which must stay the
  // last pass: it draws over the image).
  // Same rule as output: depending on which passes are active, its target may be the scene's,
  // whose depth must not be overwritten by the full-screen quad.
  const smaa = new SMAAPass(1, 1) as SMAAPass & { materialBlend: THREE.ShaderMaterial }
  smaa.materialBlend.depthTest = false
  smaa.materialBlend.depthWrite = false
  composer.addPass(smaa)
  composer.addPass(outline.linePass)
  const costs = Object.fromEntries(PASS_NAMES.map((n) => [n, { calls: 0, triangles: 0 }])) as Record<PassName, PassCost>
  const metered: [PassName, Meterable][] = [['scene', scenePass], ['outlineMask', outline.maskPass], ['ao', gtao], ['output', output], ['grade', grade], ['smaa', smaa], ['outlineLine', outline.linePass]]
  for (const [name, pass] of metered) meterPass(renderer, pass, costs[name])
  const bloomGpu = new GpuTimer(renderer)
  /** The drawer's bloom setting (`setBloom`), which a film look overrides while it is set. */
  let drawerBloom = bloom
  /** The look object last set, to resolve it once rather than every frame. */
  let filmSource: FilmLook | null = null
  type Mutable = { bloom: GlowBloomPass | null; film: FilmLookSettings | null; filmPass: ShaderPass | null; dof: DofPass | null }
  const self = (): Mutable => fx as unknown as Mutable
  /** syncBloom puts the bloom pass in or out for the drawer's setting and the film look, at the strength the look asks. */
  const syncBloom = () => {
    const s = self()
    const on = drawerBloom || s.film !== null
    if (!on && s.bloom) {
      composer.removePass(s.bloom)
      s.bloom.dispose()
      s.bloom = null
      bloomGpu.ms = null
      costs.bloom.calls = costs.bloom.triangles = 0
    } else if (on && !s.bloom) {
      const pass = new GlowBloomPass()
      meterPass(renderer, pass, costs.bloom, () => (fx.timeBloom ? bloomGpu : null))
      // The glow is part of the scene the lens sees: it goes before the depth of field.
      composer.insertPass(pass, composer.passes.indexOf(s.dof ?? output))
      s.bloom = pass
    }
    if (s.bloom) s.bloom.strength = s.film ? s.film.bloom : BLOOM_STRENGTH
  }
  const fx: PostFx3d = {
    composer,
    gtao,
    bloom: null,
    grade,
    output,
    smaa,
    outline,
    costs,
    bloomGpu,
    timeBloom: false,
    dof: null,
    film: null,
    filmPass: null,
    meter,
    setHighlightCeiling(on) {
      if (on && !ceilingOn) meter.reset()
      ceilingOn = on
    },
    setExposureClock(ms) {
      exposureClock = ms
    },
    resetExposure() {
      meter.reset()
    },
    readCeilingStops() {
      return ceilingOn ? meter.readStops(renderer) : null
    },
    setBloom(on) {
      drawerBloom = on
      syncBloom()
    },
    setFilmLook(look, scriptMs = 0) {
      const s = self()
      if (!look) {
        if (!s.film) return
        filmSource = null
        s.film = null
        if (s.filmPass) {
          composer.removePass(s.filmPass)
          s.filmPass.dispose()
          s.filmPass = null
        }
        syncBloom()
        return
      }
      if (look !== filmSource || !s.film) {
        filmSource = look
        s.film = resolveFilmLook(look)
        if (!s.filmPass) {
          const pass = new ShaderPass(shaderFilm())
          // Same rule as grading: a full-screen quad has nothing to depth-test or depth-write.
          pass.material.depthTest = false
          pass.material.depthWrite = false
          // After anti-aliasing (SMAA would read grain as edges), before the outline's line,
          // which keeps its exact color: neither vignette nor grain touches it.
          composer.insertPass(pass, composer.passes.indexOf(outline.linePass))
          s.filmPass = pass
        }
        const u = s.filmPass.uniforms
        ;(u.uWarmth.value as THREE.Vector3).set(...warmthGain(s.film.warmth))
        u.uContrast.value = s.film.contrast
        u.uSaturation.value = s.film.saturation
        u.uVignette.value = s.film.vignette
        u.uGrain.value = s.film.grain
        syncBloom()
      }
      ;(s.filmPass!.uniforms.uSeedOffset.value as THREE.Vector2).set(...seedOffset(filmSeed(scriptMs)))
    },
    setLens(lens) {
      const s = self()
      if (!lens) {
        if (s.dof) {
          composer.removePass(s.dof)
          s.dof.dispose()
          s.dof = null
        }
        return
      }
      if (!s.dof) {
        const pass = new DofPass(camera, () => scenePass.depth)
        composer.insertPass(pass, composer.passes.indexOf(output))
        s.dof = pass
      }
      s.dof.focusDistance = lens.focusDistance
      s.dof.aperture = lens.aperture
    },
    resetCosts() {
      for (const name of PASS_NAMES) costs[name].calls = costs[name].triangles = 0
    },
    dispose() {
      fx.setLens(null)
      fx.setFilmLook(null)
      fx.setBloom(false)
      bloomGpu.dispose()
      meter.dispose()
      outline.dispose()
      gtao.dispose()
      grade.dispose()
      composer.dispose()
    },
  }
  fx.setBloom(bloom)
  return fx
}

type Meterable = { render: (...args: never[]) => void }

/**
 * meterPass wraps a pass's `render` to add what it drew (`renderer.info`, which the scene resets
 * once per frame) to `cost`; `timer`, when it gives one, times the pass on the GPU.
 */
function meterPass(renderer: THREE.WebGLRenderer, pass: Meterable, cost: PassCost, timer?: () => GpuTimer | null): void {
  const render = pass.render.bind(pass) as (...args: unknown[]) => void
  pass.render = ((...args: unknown[]) => {
    const info = renderer.info.render
    const calls = info.calls
    const triangles = info.triangles
    const gpu = timer?.() ?? null
    gpu?.begin()
    render(...args)
    gpu?.end()
    cost.calls += info.calls - calls
    cost.triangles += info.triangles - triangles
  }) as never
}

/**
 * DepthKeepingRenderPass — the scene's render pass, which records the depth texture of the target
 * it draws into (the compositor swaps its two targets, so which one holds the scene changes): the
 * depth of field reads the scene's depth from it.
 */
class DepthKeepingRenderPass extends RenderPass {
  depth: THREE.DepthTexture | null = null

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    this.depth = this.renderToScreen ? null : readBuffer.depthTexture
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
  }
}

/**
 * GtaoScenePass — a GTAO pass that reuses the main pass's depth instead of re-rendering the
 * scene into a normal material: every frame it is handed the depth of the target the scene's
 * render just wrote (the compositor swaps its targets between passes), and normals are
 * reconstructed from it. GTAO's own target and normal material, set up for that re-render, no
 * longer have a role.
 */
class GtaoScenePass extends GTAOPass {
  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    super(scene, camera, 1, 1)
    const interne = this as unknown as { normalRenderTarget: THREE.WebGLRenderTarget }
    interne.normalRenderTarget.dispose()
    this.normalMaterial.dispose()
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const depth = readBuffer.depthTexture
    if (depth) this.setGBuffer(depth, undefined)
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
  }
}
