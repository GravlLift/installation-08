/**
 * topDownView3d.ts — the top-down view of the replay scene: the same scene, drawn from
 * straight above with an orthographic camera, cut at a height that follows the followed player
 * (`topDownLogic.CutFollower`), with a marker per player, framed between the page's chrome and
 * zoomed and panned by the viewer (`topDownNavLogic`, gestures in `topDownInput3d`). It also owns
 * the corner minimap drawn over the 3D view (`topDownMinimap3d`), which shares its staging and ghost.
 *
 * The camera rides `TOP_LIFT` above the cut and its near plane sits on the cut, so every slab
 * over the followed player's head is not drawn; its far plane sits under the lowest walked
 * height, so the floor he stands on shows with the floors below it through openings, and the
 * terrain and backdrop under the played area do not. Near/far instead of
 * `renderer.clippingPlanes`: no global state to save and restore, and no leak into the shadow
 * pass. What the cut leaves empty shows the floors above it faintly (`topDownGhost3d`); the
 * fog, background, hidden helpers and overhead light of every top-down render are `topDownStage3d`.
 *
 * The draw runs through the composer on the orthographic camera so the scene gets the same
 * final color treatment as the 3D view (tone mapping, output color space, the grade). Only the
 * camera-agnostic passes run; the perspective-bound ones (team outline mask and line, ambient
 * occlusion) are skipped, which is why the composer is re-pointed, not rebuilt.
 */
import * as THREE from 'three'
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { Pass } from 'three/addons/postprocessing/Pass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

import { cssColor } from './cssColor'
import { PlayerMarkers3d, type DeadPose, type MarkerPose } from './playerMarkers3d'
import { TopDownGhost } from './topDownGhost3d'
import { TopDownInput } from './topDownInput3d'
import { CUT_HEADROOM, CutFollower, highestDrawn, lowestDrawn } from './topDownLogic'
import { TopDownMinimap, type MinimapDraw } from './topDownMinimap3d'
import { NAV_HOME, NO_INSETS, followed, frameOf, insetsFrom, panBy, screenAt, zoomAt, type Insets, type NavContext, type NavState, type Span, type TopDownBounds, type Viewport } from './topDownNavLogic'
import { TOP_LIFT, TopDownStage } from './topDownStage3d'

/** Margin around the walked X/Z area in the frame (u): the walls just past the last footstep. */
const TOP_MARGIN = 3
/** The passes that read no camera: the scene render, the output, the grade, the antialias. */
const CAMERA_AGNOSTIC = [RenderPass, OutputPass, ShaderPass, SMAAPass]
/** How often the chrome's place is read from the page (ms): it moves only on a resize or a font load. */
const INSETS_EVERY_MS = 500

/** cameraAgnostic — a composer pass that needs no perspective camera. */
function cameraAgnostic(pass: Pass): boolean {
  return CAMERA_AGNOSTIC.some((Ctor) => pass instanceof Ctor)
}

/** What one top-down draw needs from the scene. */
export interface TopDownDraw {
  composer: EffectComposer
  /** One pose per living player. */
  players: readonly MarkerPose[]
  /** One pose per dead player waiting to come back. */
  dead: readonly DeadPose[]
  /** The followed player, null in free camera. */
  followed: string | null
}

/** What the view is built on: the scene and its renderer, the sun, the walked heights and box (scene axes). */
export interface TopDownSetup {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  sun: THREE.DirectionalLight
  heights: readonly number[]
  walked: THREE.Box3
}

export class TopDownView3d {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  private readonly scene: THREE.Scene
  private readonly renderer: THREE.WebGLRenderer
  private readonly stage: TopDownStage
  private readonly ghost: TopDownGhost
  private readonly markers: PlayerMarkers3d
  private readonly minimap: TopDownMinimap
  private readonly input: TopDownInput
  private readonly lowestY: number
  private readonly bounds: TopDownBounds
  private readonly cut: CutFollower
  private nav: NavState = NAV_HOME
  private insets: Insets = NO_INSETS
  private insetsAt = -Infinity
  /** The light edge under each marker, the page's `--ink` token; null if absent. */
  private edge: THREE.Color | null | undefined

  constructor(s: TopDownSetup) {
    this.scene = s.scene
    this.renderer = s.renderer
    this.stage = new TopDownStage(s.scene, s.sun)
    this.lowestY = lowestDrawn(s.heights)
    const area = s.walked.clone().expandByScalar(TOP_MARGIN)
    this.bounds = { minX: area.min.x, minZ: area.min.z, maxX: area.max.x, maxZ: area.max.z }
    this.ghost = new TopDownGhost(s.scene, area, highestDrawn(s.heights), this.lowestY)
    this.markers = new PlayerMarkers3d(s.scene)
    this.cut = new CutFollower(this.lowestY)
    this.minimap = new TopDownMinimap({ renderer: s.renderer, stage: this.stage, ghost: this.ghost, lowestY: this.lowestY })
    this.input = new TopDownInput(s.renderer.domElement, {
      zoom: (x, y, factor) => (this.nav = zoomAt(this.navContext(), x, y, factor)),
      pan: (dx, dy) => (this.nav = panBy(this.navContext(), dx, dy)),
      reset: () => (this.nav = NAV_HOME),
    })
  }

  /** Collect the helpers to hide plus the sky, and the map roots; run when the scene graph changes (the cached images are redone). */
  sync(sky: THREE.Object3D | null, roots: readonly THREE.Object3D[]): void {
    this.stage.sync(sky, roots)
    this.ghost.invalidate()
    this.minimap.invalidate()
  }

  /** The 3D view draws: the markers go, the cut restarts from the target at the next top draw. */
  idle(): void {
    this.markers.hide()
    this.cut.reset()
    this.input.active = false
  }

  /** Show or hide the corner minimap over the 3D view. */
  setMinimap(on: boolean): void {
    this.minimap.enabled = on
  }

  /** Draw the corner minimap over the 3D frame just drawn (nothing when it is off or has no player). */
  drawMinimap(d: MinimapDraw): void {
    this.minimap.draw(d, this.viewport(), this.readInsets())
  }

  /** minimapHit — a canvas point (x, y in CSS px from the canvas's top left) on the corner minimap, while it is drawn. */
  minimapHit(x: number, y: number): boolean {
    return this.minimap.hit(x, y)
  }

  /** Draw the scene straight down, cut over the followed player, with the player markers. */
  draw(d: TopDownDraw): void {
    this.input.active = true
    const followedPose = d.followed ? d.players.find((p) => p.xuid === d.followed) ?? null : null
    const cutY = this.cut.step(performance.now(), d.followed, followedPose ? followedPose.feet.y : null, d.players.map((p) => p.feet.y))
    this.ghost.ensure(this.renderer, this.stage)
    const view = this.viewport()
    this.readInsets()
    this.nav = followed(this.navContext(), followedPose ? [followedPose.feet.x, followedPose.feet.z] : null)
    const frame = this.frame(view, cutY)
    const toScreen = (x: number, z: number) => screenAt(frame, view, x, z)
    this.markers.update(d.players, d.dead, { cutY, followed: d.followed, unitsPerPx: frame.unitsPerPx, halo: this.stage.studioColor(), edge: this.edgeColor(), toScreen })
    this.ghost.fill.visible = true
    try {
      this.stage.run({ mapOnly: false }, () => this.renderComposer(d.composer))
    } finally {
      this.ghost.fill.visible = false
    }
  }

  /** Remove what the view added to the scene and the page, and free it. */
  dispose(): void {
    this.input.dispose()
    this.markers.dispose(this.scene)
    this.minimap.dispose()
    this.ghost.dispose(this.scene)
  }

  private viewport(): Viewport {
    const size = this.renderer.getSize(new THREE.Vector2())
    return { width: size.x, height: size.y }
  }

  private navContext(): NavContext {
    return { bounds: this.bounds, view: this.viewport(), insets: this.insets, nav: this.nav }
  }

  /**
   * The page's chrome over the canvas (`insetsFrom`): the player's top strip and transport bar,
   * found by their classes in the player around the canvas, re-read every `INSETS_EVERY_MS`. Their
   * place is kept while they fade out, so the map does not jump when the chrome hides.
   */
  private readInsets(): Insets {
    const now = performance.now()
    if (now - this.insetsAt < INSETS_EVERY_MS) return this.insets
    this.insetsAt = now
    const canvas = this.renderer.domElement
    const player = canvas.closest('.bc-player')
    const span = (el: Element | null | undefined): Span | null => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom }
    }
    this.insets = insetsFrom(span(canvas) as Span, span(player?.querySelector('.bc-player-top')), span(player?.querySelector('.bc-player-transport')))
    return this.insets
  }

  /** The light marker edge from the page's `--ink` token, read once. */
  private edgeColor(): THREE.Color | null {
    if (this.edge === undefined) {
      const value = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
      this.edge = value ? cssColor(value, new THREE.Color()) : null
    }
    return this.edge
  }

  /**
   * Render the composer on the orthographic camera, skipping the perspective-bound passes.
   * The render pass is re-pointed, and the disabled passes restored, around the draw.
   */
  private renderComposer(composer: EffectComposer): void {
    const renderPass = composer.passes[0] as RenderPass
    const savedCamera = renderPass.camera
    const disabled: { pass: Pass; enabled: boolean }[] = []
    for (const pass of composer.passes) {
      if (!cameraAgnostic(pass)) {
        disabled.push({ pass, enabled: pass.enabled })
        pass.enabled = false
      }
    }
    renderPass.camera = this.camera
    try {
      composer.render()
    } finally {
      renderPass.camera = savedCamera
      for (const p of disabled) p.pass.enabled = p.enabled
    }
  }

  /** Place the camera `TOP_LIFT` over the cut, near plane on the cut and far plane under the lowest walked floor, on the navigation's frame. */
  private frame(view: Viewport, cutY: number): ReturnType<typeof frameOf> {
    const f = frameOf(this.bounds, view, this.insets, this.nav)
    Object.assign(this.camera, { left: -f.halfWidth, right: f.halfWidth, top: f.halfHeight, bottom: -f.halfHeight })
    this.camera.position.set(f.center[0], cutY + TOP_LIFT, f.center[1])
    this.camera.up.set(0, 0, -1)
    this.camera.lookAt(f.center[0], cutY, f.center[1])
    this.camera.near = TOP_LIFT
    this.camera.far = TOP_LIFT + Math.max(cutY - this.lowestY, CUT_HEADROOM)
    this.camera.updateProjectionMatrix()
    return f
  }
}
