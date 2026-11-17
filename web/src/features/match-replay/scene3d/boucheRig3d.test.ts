// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { boucheRig, boucheRigCamera, boucheRigLocale, boucheMondeRig, type BoucheLocale } from './boucheRig3d'
import { appliquerTenueRig } from './brasPremierePersonne3d'
import { ROTATION_RIG_CAMERA } from './premierePersonne3d'
import type { ViewGrip } from './viewGrip3d'

const ZERO: ViewGrip = { x: 0, y: 0, z: 0, roll: 0 }

/** A test rig: a carrier (group) holding a scene with a barrel (box) and an arm. */
function testRig(): { porteur: THREE.Group; root: THREE.Group } {
  const porteur = new THREE.Group()
  const root = new THREE.Group()
  porteur.add(root)
  // The barrel: a 1u-long box along +X, offset to run from -0.4 to +0.6.
  const barrelGeo = new THREE.BoxGeometry(1, 0.2, 0.2).translate(0.1, 0, 0)
  root.add(new THREE.Mesh(barrelGeo, new THREE.MeshStandardMaterial()))
  // An arm: a box with an arm material, at the back (-0.5), excluded from the measurement.
  const armM = new THREE.MeshStandardMaterial()
  armM.userData.surfaceBrute = { asg: 0 }
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1).translate(-0.5, 0, 0), armM))
  return { porteur, root }
}

/** The arm material is recognized by `estMateriauBras`: surfaceBrute with no texture. */
const isArmMaterial = (m: THREE.Material) =>
  m instanceof THREE.MeshStandardMaterial && !!m.userData.surfaceBrute && !m.map

describe('boucheRig', () => {
  it('the muzzle is the front of the barrel (the +X of the 1u box), centered on the other axes', () => {
    const { porteur, root } = testRig()
    const out = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    const ok = boucheRig(root, porteur, isArmMaterial, new THREE.Vector3(1, 0, 0), out)
    expect(ok).toBe(true)
    // The front of the box is at +0.6 (the box runs from -0.4 to +0.6 on X); the 0.01u slice
    // and the push onto the front plane put the muzzle just below that, ~+0.6.
    expect(out.bouche.x).toBeGreaterThan(0.5)
    expect(out.bouche.x).toBeLessThan(0.65)
    // Centered on Y and Z (the box is symmetric on those axes).
    expect(out.bouche.y).toBeCloseTo(0, 4)
    expect(out.bouche.z).toBeCloseTo(0, 4)
    // The axis is the barrel's.
    expect(out.axe.x).toBeCloseTo(1, 5)
    expect(out.axe.y).toBeCloseTo(0, 5)
    expect(out.axe.z).toBeCloseTo(0, 5)
  })

  it('arm meshes are ignored', () => {
    // A scene carrying only arm meshes: no weapon mesh, no muzzle.
    const porteur = new THREE.Group()
    const root = new THREE.Group()
    porteur.add(root)
    const armM = new THREE.MeshStandardMaterial()
    armM.userData.surfaceBrute = { asg: 0 }
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1).translate(-0.5, 0, 0), armM))
    const out = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    expect(boucheRig(root, porteur, isArmMaterial, new THREE.Vector3(1, 0, 0), out)).toBe(false)
  })

  it('the muzzle does not depend on the carrier\'s pose in the world (moved, rotated, scaled)', () => {
    const rest = testRig()
    const expected = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    boucheRig(rest.root, rest.porteur, isArmMaterial, new THREE.Vector3(1, 0, 0), expected)
    const { porteur, root } = testRig()
    porteur.position.set(12, 5, -7)
    porteur.quaternion.setFromEuler(new THREE.Euler(0.3, 1.1, -0.4))
    porteur.scale.set(1.5, 1.5, 1)
    const out = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    expect(boucheRig(root, porteur, isArmMaterial, new THREE.Vector3(1, 0, 0), out)).toBe(true)
    expect(out.bouche.distanceTo(expected.bouche)).toBeLessThan(1e-6)
  })

  it('counts only weapon meshes, not arms mixed in', () => {
    const { porteur, root } = testRig()
    const out = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    // The barrel is the scene's only weapon mesh: the muzzle is its front, the arm plays no part.
    expect(boucheRig(root, porteur, isArmMaterial, new THREE.Vector3(1, 0, 0), out)).toBe(true)
    // The front of the barrel is at ~+0.6 (the box runs from -0.4 to +0.6); the arm is at the back (-0.5).
    expect(out.bouche.x).toBeGreaterThan(0.5)
  })

  it('returns false with no weapon mesh', () => {
    const porteur = new THREE.Group()
    const empty = new THREE.Group()
    porteur.add(empty)
    const out = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    expect(boucheRig(empty, porteur, isArmMaterial, new THREE.Vector3(1, 0, 0), out)).toBe(false)
  })
})

describe('boucheRigCamera', () => {
  it('with a null grip, the muzzle in camera frame is the carrier point rotated by ROTATION_RIG_CAMERA', () => {
    const st = { bouche: new THREE.Vector3(0.5, 0, 0), axe: new THREE.Vector3(1, 0, 0) }
    const out = boucheRigCamera(st, ZERO, new THREE.Vector3())
    const expected = new THREE.Vector3(0.5, 0, 0).applyQuaternion(ROTATION_RIG_CAMERA)
    expect(out.distanceTo(expected)).toBeLessThan(1e-9)
  })

  it('with a grip x = 0.1, the muzzle moves forward by +0.1 on the camera\'s X', () => {
    const st = { bouche: new THREE.Vector3(0.5, 0, 0), axe: new THREE.Vector3(1, 0, 0) }
    const zero = boucheRigCamera(st, ZERO, new THREE.Vector3())
    const out = boucheRigCamera(st, { x: 0.1, y: 0, z: 0, roll: 0 }, new THREE.Vector3())
    // The grip's offset is in the camera frame, before the rig's rotation.
    expect(out.x - zero.x).toBeCloseTo(0.1, 6)
    expect(out.y - zero.y).toBeCloseTo(0, 6)
    expect(out.z - zero.z).toBeCloseTo(0, 6)
  })

  it('with a non-zero roll, the muzzle coincides with the point placed by appliquerTenueRig × ROTATION_RIG_CAMERA', () => {
    const st = { bouche: new THREE.Vector3(0.5, 0, 0), axe: new THREE.Vector3(1, 0, 0) }
    const grip: ViewGrip = { x: 0.1, y: -0.05, z: 0.2, roll: 0.35 }
    const out = boucheRigCamera(st, grip, new THREE.Vector3())
    const obj = new THREE.Object3D()
    appliquerTenueRig(obj.position, obj.quaternion, grip)
    obj.quaternion.multiply(ROTATION_RIG_CAMERA)
    obj.updateMatrix()
    const expected = st.bouche.clone().applyMatrix4(obj.matrix)
    expect(out.distanceTo(expected)).toBeLessThan(1e-9)
  })
})

describe('boucheRigLocale', () => {
  it('a plain mesh: the local carrier is the mesh, the point is its front, the axis is the barrel', () => {
    const { porteur, root } = testRig()
    const locale: BoucheLocale = { porteurLocal: null as unknown as THREE.Object3D, point: new THREE.Vector3(), axe: new THREE.Vector3() }
    expect(boucheRigLocale(root, porteur, isArmMaterial, new THREE.Vector3(1, 0, 0), locale)).toBe(true)
    // The local carrier is the barrel's mesh (the scene's only weapon mesh).
    expect(locale.porteurLocal).toBe(root.children[0])
    // The point is the barrel's front in the mesh's local frame, the axis is the barrel's.
    expect(locale.point.x).toBeGreaterThan(0.5)
    expect(locale.point.x).toBeLessThan(0.65)
    expect(locale.axe.x).toBeCloseTo(1, 5)
    expect(locale.axe.y).toBeCloseTo(0, 5)
  })
})

describe('boucheRigLocale then boucheMondeRig', () => {
  it('carrier and mesh moved and rotated: the re-read world muzzle is the barrel\'s front, the axis is the barrel\'s', () => {
    const { porteur, root } = testRig()
    porteur.position.set(4, -2, 9)
    porteur.quaternion.setFromEuler(new THREE.Euler(0.2, -0.9, 0.5))
    const barrel = root.children[0]
    barrel.position.set(0.3, 0.1, -0.2)
    barrel.quaternion.setFromEuler(new THREE.Euler(0.4, 0.6, -0.3))
    porteur.updateMatrixWorld(true)
    // The barrel's axis in the carrier's frame: the mesh's +X axis, rotated like it.
    const carrierAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(barrel.quaternion)
    const locale: BoucheLocale = { porteurLocal: null as unknown as THREE.Object3D, point: new THREE.Vector3(), axe: new THREE.Vector3() }
    expect(boucheRigLocale(root, porteur, isArmMaterial, carrierAxis, locale)).toBe(true)
    const pos = new THREE.Vector3()
    const axe = new THREE.Vector3()
    boucheMondeRig(locale.porteurLocal, locale.point, locale.axe, pos, axe)
    const expected = new THREE.Vector3(0.6, 0, 0).applyMatrix4(barrel.matrixWorld)
    expect(pos.distanceTo(expected)).toBeLessThan(1e-6)
    const expectedAxis = new THREE.Vector3(1, 0, 0).transformDirection(barrel.matrixWorld)
    expect(axe.distanceTo(expectedAxis)).toBeLessThan(1e-6)
  })
})

describe('boucheMondeRig', () => {
  it('the world muzzle follows the mesh when it is moved and rotated', () => {
    const porteur = new THREE.Group()
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.2).translate(0.1, 0, 0), new THREE.MeshStandardMaterial())
    porteur.add(barrel)
    const point = new THREE.Vector3(0.6, 0, 0) // the front, in the mesh's local frame
    const axe = new THREE.Vector3(1, 0, 0)
    barrel.position.set(2, 3, -4)
    barrel.rotation.z = 0.7
    const pos = new THREE.Vector3()
    const outAxe = new THREE.Vector3()
    boucheMondeRig(barrel, point, axe, pos, outAxe)
    const expected = point.clone().applyMatrix4(barrel.matrixWorld)
    expect(pos.distanceTo(expected)).toBeLessThan(1e-9)
    expect(outAxe.length()).toBeCloseTo(1, 9)
  })

  it('the carrier moved, rotated and scaled (1.5,1.5,1): the world muzzle equals the mesh\'s front transformed by the whole chain', () => {
    const porteur = new THREE.Group()
    porteur.position.set(12, 5, -7)
    porteur.quaternion.setFromEuler(new THREE.Euler(0.3, 1.1, -0.4))
    porteur.scale.set(1.5, 1.5, 1)
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.2).translate(0.1, 0, 0), new THREE.MeshStandardMaterial())
    porteur.add(barrel)
    const point = new THREE.Vector3(0.6, 0, 0)
    const axe = new THREE.Vector3(1, 0, 0)
    const pos = new THREE.Vector3()
    const outAxe = new THREE.Vector3()
    boucheMondeRig(barrel, point, axe, pos, outAxe)
    const expected = point.clone().applyMatrix4(barrel.matrixWorld)
    expect(pos.distanceTo(expected)).toBeLessThan(1e-9)
  })
})
