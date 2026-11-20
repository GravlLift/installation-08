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
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'

import { GlowBloomPass } from './bloom3d'
import { DofPass, type Lens3d } from './dof3d'
import { GpuTimer } from './gpuTimer3d'
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
  /** setBloom puts the bloom pass in the chain (before the depth of field, else the output pass) or takes it out and releases it. */
  setBloom(on: boolean): void
  /** The depth of field pass while a lens is set, null while none is (out of the chain). */
  readonly dof: DofPass | null
  /**
   * setLens sets the frame's lens (a playing camera script's focus distance and f-number): the
   * depth of field pass enters the chain before the output pass, or, with null, leaves it and is
   * released. Called every frame; only a change of presence touches the chain.
   */
  setLens(lens: Lens3d | null): void
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
    setBloom(on) {
      const self = fx as { bloom: GlowBloomPass | null }
      if (on === (self.bloom !== null)) return
      if (self.bloom) {
        composer.removePass(self.bloom)
        self.bloom.dispose()
        self.bloom = null
        bloomGpu.ms = null
        costs.bloom.calls = costs.bloom.triangles = 0
        return
      }
      const pass = new GlowBloomPass()
      meterPass(renderer, pass, costs.bloom, () => (fx.timeBloom ? bloomGpu : null))
      // The glow is part of the scene the lens sees: it goes before the depth of field.
      composer.insertPass(pass, composer.passes.indexOf(fx.dof ?? output))
      self.bloom = pass
    },
    setLens(lens) {
      const self = fx as { dof: DofPass | null }
      if (!lens) {
        if (self.dof) {
          composer.removePass(self.dof)
          self.dof.dispose()
          self.dof = null
        }
        return
      }
      if (!self.dof) {
        const pass = new DofPass(camera, () => scenePass.depth)
        composer.insertPass(pass, composer.passes.indexOf(output))
        self.dof = pass
      }
      self.dof.focusDistance = lens.focusDistance
      self.dof.aperture = lens.aperture
    },
    resetCosts() {
      for (const name of PASS_NAMES) costs[name].calls = costs[name].triangles = 0
    },
    dispose() {
      fx.setLens(null)
      fx.setBloom(false)
      bloomGpu.dispose()
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
