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
 * The post effects (occlusion, team outline, grain) are skipped: the composer is bound to
 * the perspective camera, and the top-down view needs none of them. Players, weapons on
 * the ground, objectives and effects live in the same scene graph and are drawn as is.
 */
import * as THREE from 'three'
import { bandAt, topDownFrame, type FloorBand, type TopDownBounds } from './topDownLogic'

/** The lift of the camera above the band ceiling, keeps the near plane positive (u). */
const TOP_LIFT = 2
/** The clip slack past each side of the band, so nothing of the floor is shaved (u). */
const TOP_SLACK = 0.5
/** Helper meshes not drawn in the top-down view (the sky is passed separately to `sync`). */
const HIDDEN_NAMES = new Set(['envers-structure', 'ombre-carte'])

export class TopDownView3d {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  private readonly bands: FloorBand[]
  private readonly bounds: TopDownBounds
  private hidden: { obj: THREE.Object3D; visible: boolean }[] = []
  /** The last band drawn, kept for frames where no player height is on the map. */
  private lastBand: FloorBand | null = null

  constructor(bands: FloorBand[], bounds: TopDownBounds) {
    this.bands = bands
    this.bounds = bounds
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

  /** Draw the scene straight down over the band; false when there is no band to draw. */
  draw(scene: THREE.Scene, renderer: THREE.WebGLRenderer, band: FloorBand | null): boolean {
    if (!band) return false
    const savedFog = scene.fog
    scene.fog = null
    for (const h of this.hidden) h.obj.visible = false
    this.frame(renderer, band)
    renderer.render(scene, this.camera)
    scene.fog = savedFog
    for (const h of this.hidden) h.obj.visible = h.visible
    return true
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
