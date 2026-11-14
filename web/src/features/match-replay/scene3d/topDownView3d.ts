/**
 * topDownView3d.ts — the top-down view of the replay scene: the same scene, drawn from
 * straight above with an orthographic camera, cut at a height that follows the followed player
 * (`topDownLogic.cutTarget`, smoothed over time), with a marker per living player.
 *
 * The camera rides `TOP_LIFT` above the cut and its near plane sits on the cut, so every slab
 * over the followed player's head is not drawn; its far plane sits under the lowest walked
 * height, so the floor he stands on shows with the floors below it through openings, and the
 * terrain and backdrop under the played area do not. Near/far instead of
 * `renderer.clippingPlanes`: no global state to save and restore, and no leak into the shadow
 * pass. A fog in the page's studio color, starting under the drawn floor, fades the floors
 * below with their depth so they read as lower.
 *
 * The lighting is the 3D view's own, sun shadows included: the map's shadow casters (the
 * `ombre-carte` proxies) stay in the scene, so a floor under a roof stays in the roof's shade
 * and reads the same color in 2D as in 3D. Only the sky and the structure back faces are hidden.
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

import { BACK_FACE_NAME } from './backFaces3d'
import { cssColor } from './cssColor'
import { PlayerMarkers3d, type MarkerPose } from './playerMarkers3d'
import { unitsPerPixel } from './playerMarkers3d_logic'
import { CUT_HEADROOM, cutTarget, lowestDrawn, smoothCut, topDownFrame } from './topDownLogic'

/** The lift of the camera above the cut, keeps the near plane positive (u). */
const TOP_LIFT = 2
/** Margin around the walked X/Z area in the frame (u): the walls just past the last footstep. */
const TOP_MARGIN = 3
/** The fog under the drawn floor: where it starts below it, and the depth it takes to full (u). */
const FADE_START = 0.5
const FADE_DEPTH = 12
/** Helper meshes not drawn in the top-down view (the sky is passed separately to `sync`). */
const HIDDEN_NAMES = new Set([BACK_FACE_NAME])
/** The passes that read no camera: the scene render, the output, the grade, the antialias. */
const CAMERA_AGNOSTIC = [RenderPass, OutputPass, ShaderPass, SMAAPass]

/** cameraAgnostic — a composer pass that needs no perspective camera. */
function cameraAgnostic(pass: Pass): boolean {
  return CAMERA_AGNOSTIC.some((Ctor) => pass instanceof Ctor)
}

/** What one top-down draw needs from the scene. */
export interface TopDownDraw {
  renderer: THREE.WebGLRenderer
  composer: EffectComposer
  /** One pose per living player. */
  players: readonly MarkerPose[]
  /** The followed player, null in free camera. */
  followed: string | null
}

export class TopDownView3d {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  private readonly scene: THREE.Scene
  private readonly markers: PlayerMarkers3d
  private readonly lowestY: number
  private readonly bounds: THREE.Box3
  private hidden: { obj: THREE.Object3D; visible: boolean }[] = []
  /** The cut drawn last, and when (performance.now ms); null before the first draw. */
  private cut: number | null = null
  private cutAt = 0
  /** The followed player and his feet when last seen alive (scene Y), for the frames he is out of life. */
  private lastFollowed: { xuid: string | null; y: number | null } = { xuid: null, y: null }
  /** The page's studio color, read from its `--studio-950` token once; null if absent. */
  private studio: THREE.Color | null = null
  private fog: THREE.Fog | null = null

  /** `heights` the walked feet heights, `walked` the box of the walked positions (scene axes). */
  constructor(scene: THREE.Scene, heights: readonly number[], walked: THREE.Box3) {
    this.scene = scene
    this.markers = new PlayerMarkers3d(scene)
    this.lowestY = lowestDrawn(heights)
    this.bounds = walked.clone().expandByScalar(TOP_MARGIN)
  }

  /** Collect the helper meshes to hide (by name) plus the sky; run when the scene graph changes. */
  sync(sky: THREE.Object3D | null): void {
    this.hidden = []
    if (sky) this.hidden.push({ obj: sky, visible: sky.visible })
    this.scene.traverse((obj) => {
      if (HIDDEN_NAMES.has(obj.name)) this.hidden.push({ obj, visible: obj.visible })
    })
  }

  /** The 3D view draws: the markers go, the cut restarts from the target at the next top draw. */
  idle(): void {
    this.markers.hide()
    this.cut = null
    this.lastFollowed = { xuid: null, y: null }
  }

  /** Draw the scene straight down, cut over the followed player, with the player markers. */
  draw(d: TopDownDraw): void {
    const scene = this.scene
    const saved = { fog: scene.fog, background: scene.background }
    const studio = this.studioColor(saved.background)
    const cutY = this.moveCut(d)
    const unitsPerPx = this.frame(d.renderer, cutY)
    this.markers.update(d.players, { cutY, followed: d.followed, unitsPerPx, rim: studio })
    if (studio) {
      scene.background = studio
      scene.fog = this.fadeBelow(studio)
    } else {
      scene.fog = null
    }
    for (const h of this.hidden) h.obj.visible = false
    try {
      this.renderComposer(d.composer)
    } finally {
      scene.fog = saved.fog
      scene.background = saved.background
      for (const h of this.hidden) h.obj.visible = h.visible
    }
  }

  /** Remove the markers from the scene and free them. */
  dispose(): void {
    this.markers.dispose(this.scene)
  }

  /** Move the cut toward this frame's target (`cutTarget`), smoothed over the time since the last draw. */
  private moveCut(d: TopDownDraw): number {
    const now = performance.now()
    const followed = d.followed ? d.players.find((p) => p.xuid === d.followed) ?? null : null
    if (d.followed !== this.lastFollowed.xuid) this.lastFollowed = { xuid: d.followed, y: null }
    if (followed) this.lastFollowed.y = followed.feet.y
    const target = cutTarget({
      followedY: followed ? followed.feet.y : null,
      lastFollowedY: this.lastFollowed.y,
      livingY: d.players.map((p) => p.feet.y),
      previous: this.cut,
      lowestY: this.lowestY,
    })
    this.cut = smoothCut(this.cut, target, (now - this.cutAt) / 1000)
    this.cutAt = now
    return this.cut
  }

  /**
   * The fog that fades what lies under the drawn floor into the studio color with its depth;
   * distances are from the camera, which rides `TOP_LIFT` over the cut.
   */
  private fadeBelow(color: THREE.Color): THREE.Fog {
    const near = TOP_LIFT + CUT_HEADROOM + FADE_START
    this.fog ??= new THREE.Fog(color, near, near + FADE_DEPTH)
    return this.fog
  }

  /**
   * The page's dark studio color from its `--studio-950` token, read once; null if the token is
   * absent or the scene background is not a color. The scene's own background is the fallback the
   * resolver takes when the token cannot be painted, so no color is invented here.
   */
  private studioColor(saved: THREE.Color | THREE.Texture | null): THREE.Color | null {
    if (this.studio === null) {
      const value = getComputedStyle(document.documentElement).getPropertyValue('--studio-950').trim()
      if (value && saved instanceof THREE.Color) this.studio = cssColor(value, saved)
    }
    return this.studio
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

  /**
   * Place the camera `TOP_LIFT` over the cut, near plane on the cut and far plane under the
   * lowest walked floor, framing the walked area; returns the view's world units per CSS pixel.
   */
  private frame(renderer: THREE.WebGLRenderer, cutY: number): number {
    const size = renderer.getSize(new THREE.Vector2())
    const aspect = size.y > 0 ? size.x / size.y : 1
    const { min, max } = this.bounds
    const f = topDownFrame({ minX: min.x, minZ: min.z, maxX: max.x, maxZ: max.z }, aspect)
    this.camera.left = -f.halfWidth
    this.camera.right = f.halfWidth
    this.camera.top = f.halfHeight
    this.camera.bottom = -f.halfHeight
    this.camera.position.set(f.center[0], cutY + TOP_LIFT, f.center[1])
    this.camera.up.set(0, 0, -1)
    this.camera.lookAt(f.center[0], cutY, f.center[1])
    this.camera.near = TOP_LIFT
    this.camera.far = TOP_LIFT + Math.max(cutY - this.lowestY, CUT_HEADROOM)
    this.camera.updateProjectionMatrix()
    return unitsPerPixel(f.halfHeight, size.y)
  }
}
