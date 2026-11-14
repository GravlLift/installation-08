/**
 * topDownView3d.ts — the top-down view of the replay scene: the same scene, drawn from
 * straight above with an orthographic camera, limited to the floor band the followed
 * player stands on.
 *
 * The camera rides a lift above the band's ceiling and its near/far clip to the band, so
 * geometry above it (roofs) or below it (the floor under) is not drawn. Near/far instead
 * of `renderer.clippingPlanes`: no global state to save and restore, and no leak into the
 * shadow pass. The scene fog and the helper meshes (the sky, the structure back faces
 * `envers-structure`, the shadow proxies `ombre-carte`) are saved and restored around the
 * draw, the way the scene expects.
 *
 * The draw runs through the composer on the orthographic camera so the scene gets the same
 * final color treatment as the 3D view (tone mapping, output color space, the grade): a floor
 * reads the same in 2D as in 3D. Only the camera-agnostic passes run; the perspective-bound
 * ones (team outline mask and line, ambient occlusion) are skipped, which is why the composer
 * is re-pointed, not rebuilt. The background is the page's dark studio, the sky stays hidden,
 * and the sun's shadows are off: a baked sun reads as walls from straight above.
 */
import * as THREE from 'three'
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { Pass } from 'three/addons/postprocessing/Pass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

import { cssColor } from './cssColor'
import { bandAt, topDownFrame, type FloorBand, type TopDownBounds } from './topDownLogic'

/** The lift of the camera above the band ceiling, keeps the near plane positive (u). */
const TOP_LIFT = 2
/** The clip slack past each side of the band, so nothing of the floor is shaved (u). */
const TOP_SLACK = 0.5
/** Helper meshes not drawn in the top-down view (the sky is passed separately to `sync`). */
const HIDDEN_NAMES = new Set(['envers-structure', 'ombre-carte'])
/** The passes that read no camera: the scene render, the output, the grade, the antialias. */
const CAMERA_AGNOSTIC = [RenderPass, OutputPass, ShaderPass, SMAAPass]

/** cameraAgnostic — a composer pass that needs no perspective camera. */
function cameraAgnostic(pass: Pass): boolean {
  return CAMERA_AGNOSTIC.some((Ctor) => pass instanceof Ctor)
}

export class TopDownView3d {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  private readonly bands: FloorBand[]
  private readonly bounds: TopDownBounds
  private hidden: { obj: THREE.Object3D; visible: boolean }[] = []
  /** The last band drawn, kept for frames where no player height is on the map. */
  private lastBand: FloorBand | null = null
  /** The page's studio background, read from its `--studio-950` token once; null if absent. */
  private studioBackground: THREE.Color | null = null

  constructor(bands: FloorBand[], bounds: TopDownBounds) {
    this.bands = bands
    this.bounds = bounds
  }

  /** The floor bands this view draws; the markers read them to tell a player's floor. */
  get floorBands(): readonly FloorBand[] {
    return this.bands
  }

  /** Collect the helper meshes to hide (by name) plus the sky; run when the scene graph changes. */
  sync(scene: THREE.Scene, sky: THREE.Object3D | null): void {
    this.hidden = []
    if (sky) this.hidden.push({ obj: sky, visible: sky.visible })
    scene.traverse((obj) => {
      if (HIDDEN_NAMES.has(obj.name)) this.hidden.push({ obj, visible: obj.visible })
    })
  }

  /** The band of the height `y` (scene up axis), else the last one drawn; null with no band at all. */
  bandFor(y: number | null): FloorBand | null {
    if (this.bands.length === 0) return this.lastBand
    if (y === null) return this.lastBand
    this.lastBand = bandAt(this.bands, y)
    return this.lastBand
  }

  /**
   * Draw the scene straight down over the band through the composer (its camera-agnostic
   * passes); false when there is no band to draw.
   */
  draw(scene: THREE.Scene, renderer: THREE.WebGLRenderer, composer: EffectComposer, band: FloorBand | null): boolean {
    if (!band) return false
    const savedFog = scene.fog
    scene.fog = null
    const savedBackground = scene.background
    const studio = this.studioBg(savedBackground)
    if (studio) scene.background = studio
    const savedShadow = renderer.shadowMap.enabled
    renderer.shadowMap.enabled = false
    for (const h of this.hidden) h.obj.visible = false
    this.frame(renderer, band)
    this.renderComposer(composer)
    renderer.shadowMap.enabled = savedShadow
    scene.fog = savedFog
    if (studio) scene.background = savedBackground
    for (const h of this.hidden) h.obj.visible = h.visible
    return true
  }

  /**
   * The page's dark studio background from its `--studio-950` token, read once; null if the
   * token is absent or the scene background is not a color. The scene's own background is the
   * fallback the resolver takes when the token cannot be painted, so no color is invented here.
   */
  private studioBg(saved: THREE.Color | THREE.Texture | null): THREE.Color | null {
    if (this.studioBackground === null) {
      const value = getComputedStyle(document.documentElement).getPropertyValue('--studio-950').trim()
      if (value && saved instanceof THREE.Color) this.studioBackground = cssColor(value, saved)
    }
    return this.studioBackground
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
      for (const d of disabled) d.pass.enabled = d.enabled
    }
  }

  /** Place the camera above the band, clip it to the band, and frame the played area. */
  private frame(renderer: THREE.WebGLRenderer, band: FloorBand): void {
    const size = renderer.getSize(new THREE.Vector2())
    const aspect = size.y > 0 ? size.x / size.y : 1
    const f = topDownFrame(this.bounds, aspect)
    this.camera.left = -f.halfWidth
    this.camera.right = f.halfWidth
    this.camera.top = f.halfHeight
    this.camera.bottom = -f.halfHeight
    this.camera.position.set(f.center[0], band.ceilingY + TOP_LIFT, f.center[1])
    this.camera.up.set(0, 0, -1)
    this.camera.lookAt(f.center[0], 0, f.center[1])
    this.camera.near = TOP_LIFT - TOP_SLACK
    this.camera.far = TOP_LIFT + (band.ceilingY - band.floorY) + TOP_SLACK
    this.camera.updateProjectionMatrix()
  }
}
