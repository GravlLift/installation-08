// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** mapCut3d.test.ts — the map's cutaway plane: where it is aimed, its rest, and which materials carry it. */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MAP_CUT_REST, MapCut3d } from './mapCut3d'

/** A camera at `pos` looking at `at`, its world matrix current. */
function cameraAt(pos: [number, number, number], at: [number, number, number]): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.02, 700)
  camera.position.set(...pos)
  camera.lookAt(...at)
  camera.updateMatrixWorld()
  return camera
}

describe('MapCut3d', () => {
  it('aims the plane at position + forward * near, facing forward (three clips the negative side)', () => {
    const camera = cameraAt([1, 2, 3], [4, 6, 3]) // forward (0.6, 0.8, 0)
    const cut = new MapCut3d()
    cut.aim(camera, 2.5)
    expect(cut.active).toBe(true)
    const forward = camera.getWorldDirection(new THREE.Vector3())
    expect(cut.plane.normal.distanceTo(forward)).toBeCloseTo(0, 9)
    const onPlane = camera.position.clone().addScaledVector(forward, 2.5)
    expect(cut.plane.distanceToPoint(onPlane)).toBeCloseTo(0, 9)
    // A wall 1.5 u ahead is cut (negative side); a player 1.5 u ahead is not the map's, and the
    // map's own surfaces 3 u ahead are kept (positive side).
    expect(cut.plane.distanceToPoint(camera.position.clone().addScaledVector(forward, 1.5))).toBeLessThan(0)
    expect(cut.plane.distanceToPoint(camera.position.clone().addScaledVector(forward, 3))).toBeGreaterThan(0)
    // Off the view axis, the cut is still a depth along it: a point 2 u ahead and 5 u aside is cut.
    const side = new THREE.Vector3(0, 0, 1)
    expect(cut.plane.distanceToPoint(camera.position.clone().addScaledVector(forward, 2).addScaledVector(side, 5))).toBeLessThan(0)
  })

  it('follows a rolled or shaken camera: the normal is its actual forward', () => {
    const camera = cameraAt([0, 0, 0], [0, 0, -10])
    camera.rotateY(0.3)
    camera.updateMatrixWorld()
    const cut = new MapCut3d()
    cut.aim(camera, 1)
    const forward = camera.getWorldDirection(new THREE.Vector3())
    expect(cut.plane.normal.distanceTo(forward)).toBeCloseTo(0, 9)
  })

  it('rests for a null near, and at rest keeps every map point', () => {
    const camera = cameraAt([0, 0, 0], [10, 0, 0])
    const cut = new MapCut3d()
    expect(cut.active).toBe(false)
    expect(cut.plane.constant).toBe(MAP_CUT_REST)
    cut.aim(camera, 3)
    cut.aim(camera, null)
    expect(cut.active).toBe(false)
    expect(cut.plane.normal.toArray()).toEqual([0, 1, 0])
    expect(cut.plane.constant).toBe(MAP_CUT_REST)
    for (const p of [[0, 0, 0], [5000, -9000, -5000], [-3, 400, 2], [0.5, 0, 0]] as const) {
      expect(cut.plane.distanceToPoint(new THREE.Vector3(...p))).toBeGreaterThan(0)
    }
  })

  it('during aims for the draw and rests after it, even when the draw throws', () => {
    const camera = cameraAt([0, 0, 0], [10, 0, 0])
    const cut = new MapCut3d()
    let seen: boolean | null = null
    cut.during(camera, 2, () => { seen = cut.active })
    expect(seen).toBe(true)
    expect(cut.active).toBe(false)
    expect(() => cut.during(camera, 2, () => { throw new Error('draw') })).toThrow('draw')
    expect(cut.active).toBe(false)
    cut.during(camera, null, () => { seen = cut.active })
    expect(seen).toBe(false)
  })

  it('installs the one shared plane on every mesh material under the roots, and nothing else', () => {
    const cut = new MapCut3d()
    const map = new THREE.Group()
    const wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial(), new THREE.MeshBasicMaterial()])
    const nested = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), wall.material))
    map.add(wall, multi, nested)
    const layer = new THREE.Group().add(new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2))
    const player = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    // A probe copy made before the install carries a clone of a stranger plane: replaced.
    const copy = new THREE.MeshStandardMaterial()
    copy.clippingPlanes = [new THREE.Plane()]
    map.add(new THREE.Mesh(new THREE.BoxGeometry(), copy))

    expect(cut.install([map, layer])).toBe(5) // wall (shared by nested), multi's two, the layer's, the copy
    const carried = [wall.material, ...multi.material, (layer.children[0] as THREE.InstancedMesh).material as THREE.Material, copy]
    for (const m of carried) {
      expect(m.clippingPlanes).toHaveLength(1)
      expect(m.clippingPlanes![0]).toBe(cut.plane)
      expect(m.clipShadows).toBe(false) // a cut wall still casts its shadow
    }
    expect(player.material.clippingPlanes).toBeNull()
  })

  it('keeps the plane count constant: aiming and resting never change the installed array', () => {
    const cut = new MapCut3d()
    const material = new THREE.MeshStandardMaterial()
    cut.install([new THREE.Mesh(new THREE.BoxGeometry(), material)])
    const planes = material.clippingPlanes
    cut.aim(cameraAt([0, 0, 0], [1, 0, 0]), 4)
    cut.rest()
    expect(material.clippingPlanes).toBe(planes)
    expect(material.clippingPlanes).toHaveLength(1)
  })
})
