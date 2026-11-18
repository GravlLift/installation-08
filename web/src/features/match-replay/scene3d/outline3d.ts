// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * outline3d.ts — THE TEAM OUTLINE: a solid line, in the team's color (ally or enemy as seen
 * from the page's player), around each living player's whole silhouette, weapon in hand
 * included, of constant on-screen thickness, drawn through the map, in X-ray, as in the
 * game's theater.
 *
 * Two compositor passes:
 *  1. THE MASK, right after the scene renders: its own target, at half resolution, where each
 *     covered texel carries (ally, enemy, flare, player depth). Players are rendered into it
 *     with a mask material (bones and poses those of the frame), map or not: a player hidden
 *     by a wall still enters it. A player out of view does not enter it; a distant player
 *     enters it through its stick-figure silhouette placed on its bones (`outlineStand3d`, one
 *     draw call instead of its armor and weapon pieces), its silhouette only making a few
 *     texels (`maskDrawOf`).
 *  2. THE LINE, last (after the pass to screen colors, so the team color comes out as the
 *     settings give it), at full resolution, from the mask's smoothed edge
 *     (`outlineShaders3d`): a pixel outside the silhouette takes the color of the nearest
 *     player within the line's radius, a wall in front included.
 *
 * The hit shield's flare (`BodyFxState.shield`) thickens and brightens the player's line; the
 * energy shell (`bodyShell3d`) floods its body with the same color. Nothing is kept from one
 * frame to the next: the scene re-adds the players every frame (`begin`, `add`).
 */
import * as THREE from 'three'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'

import { BODY_CENTER } from './body3d'
import type { BodyFxState } from './bodyShell3d'
import { LINE_FRAGMENT, QUAD_VERTEX, SUBJECT_FRAGMENT, SUBJECT_VERTEX } from './outlineShaders3d'
import { skeletonOf, StandFigure } from './outlineStand3d'

/** The line's thickness (CSS px): crisp at a glance at game distances. */
export const OUTLINE_PX = 1.5
/** What the shield's flare adds to it at most (CSS px). */
export const FLARE_PX = 2.5
/** The width of the line's edge fade (CSS px): the anti-aliasing. */
const SOFT_PX = 1
/** The mask is rendered at 1 / MASK_SCALE of the screen's resolution, on each side. */
const MASK_SCALE = 2
/**
 * The radius of the sphere that contains a standing player (u), centered on its group (the
 * body's center): feet and head at `BODY_CENTER`, weapon extended, arms of a clip.
 */
export const AVATAR_RADIUS = 0.6
/** A standing player's height (u): the on-screen size it makes is measured against it. */
const AVATAR_HEIGHT = 2 * BODY_CENTER
/**
 * Below this on-screen height (target px), a player enters the mask through its stick-figure
 * silhouette: it fits in under sixteen texels there, where armor and sticks no longer stand
 * apart under a 1.5 px line. Above it, the sticks depart from the armor (weapon, twisted
 * torso): whole.
 */
export const STAND_BELOW_PX = 32

/** How a player enters the mask: not at all (out of view), as sticks, or whole. */
export type MaskDraw = 'skip' | 'stand' | 'whole'

/**
 * maskDrawOf: how a player in view or not (`inView`), `heightPx` tall on screen, with or
 * without a skeleton for its stick-figure silhouette (`hasStand`), enters the mask.
 */
export function maskDrawOf(inView: boolean, heightPx: number, hasStand: boolean): MaskDraw {
  if (!inView) return 'skip'
  return hasStand && heightPx < STAND_BELOW_PX ? 'stand' : 'whole'
}

/**
 * projectedHeightPx: the on-screen height (px) of a standing player at depth `viewDepth` (u,
 * along the camera's axis), under a vertical field of view `fovDeg` on `viewHeightPx` pixels.
 */
export function projectedHeightPx(viewDepth: number, fovDeg: number, viewHeightPx: number): number {
  if (viewDepth <= 0) return Infinity
  return (AVATAR_HEIGHT / (2 * viewDepth * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2))) * viewHeightPx
}

/**
 * A player to draw this frame: its root (body and weapon), its skeleton (null without a
 * Spartan, surveyed by `plan`), its team, its shield's flare.
 */
interface Subject {
  root: THREE.Object3D
  skeleton: THREE.Skeleton | null
  ally: boolean
  flare: number
}

export class Outline3d {
  /** The mask pass, to place right after the scene renders. */
  readonly maskPass: Pass
  /** The line pass, to place last. */
  readonly linePass: Pass
  private readonly camera: THREE.PerspectiveCamera
  private readonly mask = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  })
  private readonly lineQuad: FullScreenQuad
  private readonly subjects: Subject[] = []
  private count = 0
  private preparedPlan: 'whole' | 'stand' | null = null
  /** One mask material per frame's player (team and flare are its uniforms). */
  private readonly materials: THREE.ShaderMaterial[] = []
  private readonly swapped: { mesh: THREE.Mesh; material: THREE.Mesh['material'] }[] = []
  private readonly hidden: THREE.Object3D[] = []
  /** The distant players' stick-figure silhouettes, rendered together. */
  private readonly stands = new THREE.Group()
  private readonly figures: StandFigure[] = []
  private readonly clear = new THREE.Color()
  /** The team colors, in screen colors (the compositor has already converted them). */
  private readonly ally = new THREE.Color()
  private readonly enemy = new THREE.Color()
  private readonly frustum = new THREE.Frustum()
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), AVATAR_RADIUS)
  private readonly viewProj = new THREE.Matrix4()
  private readonly center = new THREE.Vector3()

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.stands.matrixWorldAutoUpdate = false
    this.lineQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader: LINE_FRAGMENT,
        uniforms: {
          tDiffuse: { value: null },
          tMask: { value: this.mask.texture },
          uTexel: { value: new THREE.Vector2() },
          uBase: { value: 1 },
          uFlare: { value: 1 },
          uSoft: { value: 1 },
          uMaskPx: { value: MASK_SCALE },
          uAlly: { value: this.ally },
          uEnemy: { value: this.enemy },
        },
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      }),
    )
    this.maskPass = new OutlinePass((renderer, read) => this.drawMask(renderer, read), false)
    this.linePass = new OutlinePass((renderer, read, write, screen) => this.drawLine(renderer, read, write, screen), true)
  }

  /** begin empties the frame's player list. */
  begin(): void {
    this.count = 0
  }

  /**
   * add draws the player with root `root` at state `fx`; with no team or under camo, nothing
   * (the game doesn't draw an invisible player). The player must be visible: a hidden group
   * draws nothing.
   */
  add(root: THREE.Object3D, fx: BodyFxState): void {
    if (fx.ally === null || fx.equip.camo > 0) return
    // The team's screen color: the settings' own, as the label shows it.
    ;(fx.ally ? this.ally : this.enemy).copy(fx.teamColor).convertLinearToSRGB()
    const s = this.subjects[this.count] ?? (this.subjects[this.count] = { root, skeleton: null, ally: false, flare: 0 })
    s.root = root
    s.skeleton = null
    s.ally = fx.ally
    s.flare = Math.min(1, Math.max(fx.shield.hit, fx.shield.broke))
    this.count++
  }

  /** subjectsOf: the frame's placed players (tests). */
  subjectsOf(): readonly { root: THREE.Object3D; ally: boolean; flare: number }[] {
    return this.subjects.slice(0, this.count).map((s) => ({ root: s.root, ally: s.ally, flare: s.flare }))
  }

  /** Draws the mask's two shapes for the prepared roots, then renders the frame's subjects. */
  withPreparedSubjects(roots: readonly THREE.Object3D[], render: (plan: (mode: 'whole' | 'stand') => void) => void): void {
    const subjects = this.subjects.splice(0)
    const count = this.count
    const enabled = this.maskPass.enabled
    const visibilities = this.stands.children.map((o) => o.visible)
    this.subjects.push(...roots.map((root) => ({ root, skeleton: null, ally: true, flare: 0 })))
    this.count = roots.length
    this.maskPass.enabled = true
    try { render((mode) => { this.preparedPlan = mode }) } finally {
      this.subjects.splice(0, this.subjects.length, ...subjects)
      this.count = count
      this.maskPass.enabled = enabled
      this.preparedPlan = null
      this.stands.children.forEach((o, i) => { o.visible = visibilities[i] ?? false })
    }
  }

  /**
   * plan: how each of the frame's players enters the mask, as seen from the camera (matrices
   * up to date) on a target `viewHeightPx` pixels tall.
   */
  plan(viewHeightPx: number): MaskDraw[] {
    const cam = this.camera
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.viewProj)
    const out: MaskDraw[] = []
    for (let i = 0; i < this.count; i++) {
      const s = this.subjects[i]
      if (this.preparedPlan) {
        s.skeleton = this.preparedPlan === 'stand' ? skeletonOf(s.root) : null
        out.push(s.skeleton ? 'stand' : 'whole')
        continue
      }
      this.sphere.center.setFromMatrixPosition(s.root.matrixWorld)
      const inView = this.frustum.intersectsSphere(this.sphere)
      const depth = -this.center.copy(this.sphere.center).applyMatrix4(cam.matrixWorldInverse).z
      const heightPx = projectedHeightPx(depth, cam.fov, viewHeightPx)
      s.skeleton = inView && heightPx < STAND_BELOW_PX ? skeletonOf(s.root) : null
      out.push(maskDrawOf(inView, heightPx, s.skeleton !== null))
    }
    return out
  }

  dispose(): void {
    this.mask.dispose()
    this.lineQuad.dispose()
    for (const m of this.materials) m.dispose()
    for (const f of this.figures) f.mesh.dispose()
  }

  private drawMask(renderer: THREE.WebGLRenderer, read: THREE.WebGLRenderTarget): void {
    const w = Math.max(1, Math.ceil(read.width / MASK_SCALE))
    const h = Math.max(1, Math.ceil(read.height / MASK_SCALE))
    if (this.mask.width !== w || this.mask.height !== h) this.mask.setSize(w, h)
    const before = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    renderer.getClearColor(this.clear)
    const clearAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(this.mask)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, false)
    renderer.autoClear = false
    try {
      const plan = this.plan(read.height)
      let stands = 0
      for (let i = 0; i < this.count; i++) {
        if (plan[i] === 'skip') continue
        const s = this.subjects[i]
        const m = this.materialOf(i)
        if (plan[i] === 'stand') {
          this.placeStand(stands++, s.skeleton as THREE.Skeleton, m)
          continue
        }
        this.wear(s.root, m)
        try { renderer.render(s.root, this.camera) } finally { this.undress() }
      }
      for (let i = 0; i < this.stands.children.length; i++) this.stands.children[i].visible = i < stands
      if (stands > 0) renderer.render(this.stands, this.camera)
    } finally {
      renderer.autoClear = autoClear
      renderer.setClearColor(this.clear, clearAlpha)
      renderer.setRenderTarget(before)
    }
  }

  private drawLine(renderer: THREE.WebGLRenderer, read: THREE.WebGLRenderTarget, write: THREE.WebGLRenderTarget, screen: boolean): void {
    const u = (this.lineQuad.material as THREE.ShaderMaterial).uniforms
    const ratio = renderer.getPixelRatio()
    u.tDiffuse.value = read.texture
    ;(u.uTexel.value as THREE.Vector2).set(1 / read.width, 1 / read.height)
    u.uBase.value = OUTLINE_PX * ratio
    u.uFlare.value = FLARE_PX * ratio
    u.uSoft.value = SOFT_PX * ratio
    renderer.setRenderTarget(screen ? null : write)
    this.lineQuad.render(renderer)
  }

  /** materialOf: the frame's player `i`'s mask material, at its team and its flare. */
  private materialOf(i: number): THREE.ShaderMaterial {
    const m = this.materials[i] ?? (this.materials[i] = subjectMaterial())
    const s = this.subjects[i]
    m.uniforms.uSide.value.set(s.ally ? 1 : 0, s.ally ? 0 : 1, s.flare)
    return m
  }

  /** placeStand places stick-figure silhouette `k` onto `skeleton`, with material `m`. */
  private placeStand(k: number, skeleton: THREE.Skeleton, m: THREE.Material): void {
    let figure = this.figures[k]
    if (!figure) {
      figure = this.figures[k] = new StandFigure()
      this.stands.add(figure.mesh)
    }
    figure.pose(skeleton)
    figure.mesh.material = m
  }

  /**
   * wear dresses `root`'s visible meshes with the mask material; the energy shell
   * (`noOutline`) is hidden for the mask's duration, where its own shader would write its
   * color.
   */
  private wear(root: THREE.Object3D, m: THREE.Material): void {
    root.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh)) return
      if (o.userData.noOutline) {
        o.visible = false
        this.hidden.push(o)
        return
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      if (!mats.some((x: THREE.Material) => x.visible)) return
      this.swapped.push({ mesh: o, material: o.material })
      o.material = m
    })
  }

  private undress(): void {
    for (const s of this.swapped) s.mesh.material = s.material
    for (const o of this.hidden) o.visible = true
    this.swapped.length = 0
    this.hidden.length = 0
  }
}

/** subjectMaterial: a player's mask material (bones and poses of the frame). */
function subjectMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SUBJECT_VERTEX,
    fragmentShader: SUBJECT_FRAGMENT,
    uniforms: {
      uSide: { value: new THREE.Vector3() },
    },
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
  })
}

type PassBody = (renderer: THREE.WebGLRenderer, read: THREE.WebGLRenderTarget, write: THREE.WebGLRenderTarget, screen: boolean) => void

/** OutlinePass: a compositor pass that delegates to the outline. */
class OutlinePass extends Pass {
  private readonly body: PassBody

  constructor(body: PassBody, swap: boolean) {
    super()
    this.body = body
    this.needsSwap = swap
  }

  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    this.body(renderer, read, write, this.renderToScreen)
  }
}
