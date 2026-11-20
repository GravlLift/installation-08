// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * mapCut3d.ts — A CAMERA SCRIPT'S CUTAWAY, ON THE MAP ONLY: the map geometry nearer to the lens
 * than the script's `near` (a depth along the view axis, `cameraScript3d`) is cut away, so a
 * scripted camera can sit behind a wall and see through it. Players, armor, weapons, corpses,
 * grenades, projectiles, effects, beams, shields and the sky are never cut: the camera's own near
 * plane stays where it is, and only the map's materials carry the cut.
 *
 * HOW. One world-space clip plane, shared by every map material (`install`: the `clippingPlanes`
 * of each mesh material under the map's and the layer's roots, back faces, batches and probe copies
 * included). Aimed (`aim`), its normal is the camera's forward and it passes through
 * `position + forward * near`: what lies beyond it is kept, what is nearer is discarded. At rest it
 * keeps everything (`MAP_CUT_REST`). The plane count on those materials never changes once
 * installed, so three never recompiles their shaders for it; at rest it costs one dot product per
 * map fragment.
 *
 * WHEN. It is aimed only around the 3D view's composer render (`during`), screen and export
 * alike, and rests at every other draw: the plane is in world space, so the top-down view, the
 * minimap's cached picture and the environment probes, drawn from other cameras, would otherwise
 * be cut by it.
 *
 * WHAT SEES IT. The scene pass draws the map with it, so the cut wall is not in the depth buffer:
 * ambient occlusion (`GtaoScenePass`) and depth of field (`dof3d`) read that depth and see no
 * wall. The outline's mask draws the players alone, into its own target. Shadows ignore it
 * (`clipShadows` stays false): a wall cut away still casts its shadow.
 */
import * as THREE from 'three'

/**
 * The resting plane's constant (u): with an up normal, every point above y = -MAP_CUT_REST is on
 * its kept side, which holds every map by orders of magnitude while staying a plain float.
 */
export const MAP_CUT_REST = 1e6

export class MapCut3d {
  /** The shared clip plane (world space): at rest, or aimed at a camera's cut. */
  readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), MAP_CUT_REST)
  /** The one array every map material carries: a constant count of one plane. */
  readonly planes: readonly THREE.Plane[] = [this.plane]
  private readonly forward = new THREE.Vector3()
  private readonly point = new THREE.Vector3()
  private aimed = false

  /** active: the plane is aimed at a cut, not at rest. */
  get active(): boolean { return this.aimed }

  /**
   * install gives every mesh material under `roots` the shared plane (an array material, each of
   * its entries); returns how many materials it set. Run again whenever the roots' materials
   * change (an attach's probe copies and batches, a layer's): a material's `clone` copies its
   * planes, so a copy carries a stranger plane until it is installed again.
   */
  install(roots: readonly THREE.Object3D[]): number {
    const set = new Set<THREE.Material>()
    for (const root of roots) {
      root.traverse((o) => {
        const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
        if (!material || !(o as THREE.Mesh).isMesh) return
        for (const m of Array.isArray(material) ? material : [material]) set.add(m)
      })
    }
    for (const m of set) {
      m.clippingPlanes = this.planes as THREE.Plane[]
      m.clipShadows = false // a cut wall still casts its shadow
    }
    return set.size
  }

  /**
   * aim points the plane at `camera`'s cut `near` (u, a depth along its view axis): normal the
   * camera's forward, through `position + forward * near`. A null `near` rests it.
   */
  aim(camera: THREE.Camera, near: number | null): void {
    if (near === null) { this.rest(); return }
    camera.getWorldDirection(this.forward)
    camera.getWorldPosition(this.point).addScaledVector(this.forward, near)
    this.plane.setFromNormalAndCoplanarPoint(this.forward, this.point)
    this.aimed = true
  }

  /** rest puts the plane where it keeps everything. */
  rest(): void {
    this.plane.normal.set(0, 1, 0)
    this.plane.constant = MAP_CUT_REST
    this.aimed = false
  }

  /** during runs `draw` with the plane aimed at `camera`'s cut `near` (null: at rest), and rests it after. */
  during<T>(camera: THREE.Camera, near: number | null, draw: () => T): T {
    this.aim(camera, near)
    try { return draw() } finally { this.rest() }
  }
}
