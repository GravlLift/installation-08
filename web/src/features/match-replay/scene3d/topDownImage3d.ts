/**
 * topDownImage3d.ts — a cached top-down picture of the map: an orthographic camera straight down
 * over a square, near plane on a cut, the map alone staged for the top-down views
 * (`topDownStage3d`), rendered into a half-float target. The corner minimap draws its window of
 * the map out of one (`topDownMinimap3d`).
 */
import * as THREE from 'three'

import type { TopDownStage } from './topDownStage3d'
import { TOP_LIFT } from './topDownStage3d'

/** A square area seen from above: its center (X, Z) and side (u). */
export interface TopSquare {
  center: [number, number]
  side: number
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
  /** Clear to the studio color (true) or leave the background empty, alpha 0 (false, the default). */
  clear?: boolean
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
  img.stage.run({ mapOnly: true, clear: img.clear ?? false }, () => {
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
