/**
 * topDownGhost3d.ts — the floors above the cut, kept faintly on the top-down view.
 *
 * Cut over a player on a low floor, the view showed nothing where the floors above stand on solid
 * structure: the cut opens that structure, whose inside faces are not drawn, and the players
 * upstairs floated over the studio color. The ghost fills exactly those places: the whole map seen
 * from straight above, cut a headroom over the highest walked floor (so no roof), is rendered once
 * into an image (`renderTopImage`), and that image lies flat under everything the cut view draws, at
 * the bottom of its depth range. The current floor and the floors seen below it through openings
 * cover it, fully painted; where the cut view has nothing, the floor above shows through, light and
 * half transparent over the studio color, so the map's whole outline is always there and a player
 * upstairs stands on something. A floor that overhangs the current one (a bridge over a hall) is not
 * drawn over it: the current floor stays the clear one.
 *
 * The map is static, so the image is rendered once per scene graph (a layer posed later redoes it),
 * in world space: zooming and panning only move the camera over it.
 */
import * as THREE from 'three'

import type { TopDownStage } from './topDownStage3d'
import { TOP_LIFT } from './topDownStage3d'

/** The ghost image's side (px): about 50 px per unit on an arena (Recharge, ~43 u across), 7 on a 300 u team map. */
const GHOST_PX = 2048
/**
 * The ghost's tint and opacity over the studio color: the floor above as a light, cool, translucent
 * layer, its layout plain (it is drawn in the flat light) but clearly not the floor being followed,
 * which is fully painted and shaded around his height.
 */
const GHOST_TINT: readonly [number, number, number] = [0.9, 0.95, 1]
const GHOST_OPACITY = 0.5
/** How far over the bottom of the cut view's depth range the ghost lies (u). */
const GHOST_LIFT = 0.02

/** A square area seen from above: its center (X, Z) and side (u). */
export interface TopSquare {
  center: [number, number]
  side: number
}

/** squareAround — the square (X, Z) that holds a box, centered on it. */
export function squareAround(box: THREE.Box3): TopSquare {
  const side = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1)
  return { center: [(box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2], side }
}

/** One cached top-down image: where it looks, what it cuts, where it goes. */
export interface TopImage {
  renderer: THREE.WebGLRenderer
  stage: TopDownStage
  camera: THREE.OrthographicCamera
  target: THREE.WebGLRenderTarget
  square: TopSquare
  /** The cut (nothing above it is drawn) and the lowest height drawn (scene Y). */
  cutY: number
  lowestY: number
  /** Objects drawn besides the map (the ghost under a minimap image). */
  keep?: readonly THREE.Object3D[]
  /** Clear to the studio color (true) or leave the background empty, alpha 0 (false, the default). */
  clear?: boolean
  /** The followed player's floor (scene Y) the map is shaded around; none for an even image (the ghost). */
  floorY?: number | null
}

/** placeTopCamera — an orthographic camera straight down over a square, near plane on the cut. */
export function placeTopCamera(camera: THREE.OrthographicCamera, square: TopSquare, cutY: number, lowestY: number): void {
  const half = square.side / 2
  Object.assign(camera, { left: -half, right: half, top: half, bottom: -half, near: TOP_LIFT, far: TOP_LIFT + Math.max(cutY - lowestY, 0.1) })
  camera.position.set(square.center[0], cutY + TOP_LIFT, square.center[1])
  camera.up.set(0, 0, -1)
  camera.lookAt(square.center[0], cutY, square.center[1])
  camera.updateProjectionMatrix()
}

/** renderTopImage — render the map alone, staged for the top-down view, into the image's target (alpha 0 where nothing is). */
export function renderTopImage(img: TopImage): void {
  const { renderer, target } = img
  placeTopCamera(img.camera, img.square, img.cutY, img.lowestY)
  const savedTarget = renderer.getRenderTarget()
  const savedAlpha = renderer.getClearAlpha()
  renderer.setClearAlpha(0)
  img.stage.run({ mapOnly: true, keep: img.keep, clear: img.clear ?? false, floorY: img.floorY ?? null }, () => {
    renderer.setRenderTarget(target)
    renderer.clear()
    renderer.render(img.stage.scene, img.camera)
  })
  renderer.setRenderTarget(savedTarget)
  renderer.setClearAlpha(savedAlpha)
}

/** A half-float target (the scene's linear light, tone mapped where it is shown) with an alpha. */
export function topTarget(size: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace })
}

export class TopDownGhost {
  /** The flat image under the cut view; visible only during a top-down render. */
  readonly fill: THREE.Mesh
  private readonly target = topTarget(GHOST_PX)
  private readonly camera = new THREE.OrthographicCamera()
  private readonly square: TopSquare
  private readonly cutY: number
  private readonly lowestY: number
  private stale = true

  /** `area` the walked box (scene axes, margins applied); `highestY`/`lowestY` the ghost's cut and bottom. */
  constructor(scene: THREE.Scene, area: THREE.Box3, highestY: number, lowestY: number) {
    this.square = squareAround(area)
    this.cutY = highestY
    this.lowestY = lowestY
    const material = new THREE.MeshBasicMaterial({
      map: this.target.texture,
      color: new THREE.Color(...GHOST_TINT),
      transparent: true,
      opacity: GHOST_OPACITY,
      depthWrite: false,
      fog: false,
    })
    const plane = new THREE.PlaneGeometry(this.square.side, this.square.side).rotateX(-Math.PI / 2)
    this.fill = new THREE.Mesh(plane, material)
    this.fill.name = 'fantome-vue-dessus'
    this.fill.position.set(this.square.center[0], lowestY + GHOST_LIFT, this.square.center[1])
    this.fill.visible = false
    this.fill.matrixAutoUpdate = false
    this.fill.updateMatrix()
    scene.add(this.fill)
  }

  /** The scene graph changed (a layer posed or removed): the image is redone at the next use. */
  invalidate(): void {
    this.stale = true
  }

  /** Render the image if it is stale (once per scene graph). */
  ensure(renderer: THREE.WebGLRenderer, stage: TopDownStage): void {
    if (!this.stale) return
    this.stale = false
    renderTopImage({ renderer, stage, camera: this.camera, target: this.target, square: this.square, cutY: this.cutY, lowestY: this.lowestY })
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.fill)
    this.fill.geometry.dispose()
    ;(this.fill.material as THREE.Material).dispose()
    this.target.dispose()
  }
}
