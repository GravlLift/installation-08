// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { muzzlePose, muzzlePoseCamera, muzzleLocalPose, muzzleWorldPose, type MuzzleLocal } from './muzzleRig3d'
import { applyRigGrip } from './firstPersonArms3d'
import { ROTATION_RIG_CAMERA } from './firstPersonRig3d'
import type { ViewGrip } from './viewGrip3d'

const ZERO: ViewGrip = { x: 0, y: 0, z: 0, roll: 0 }

/** A test rig: a holder (group) containing a scene with a barrel (box) and an arm. */
function testRig(): { holder: THREE.Group; root: THREE.Group } {
  const holder = new THREE.Group()
  const root = new THREE.Group()
  holder.add(root)
  // The barrel: a 1 u long box along +X, offset to run from -0.4 to +0.6.
  const barrelGeo = new THREE.BoxGeometry(1, 0.2, 0.2).translate(0.1, 0, 0)
  root.add(new THREE.Mesh(barrelGeo, new THREE.MeshStandardMaterial()))
  // An arm: a box with an arm material, at the back (-0.5), excluded from the measurement.
  const armMat = new THREE.MeshStandardMaterial()
  armMat.userData.surfaceBrute = { asg: 0 }
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1).translate(-0.5, 0, 0), armMat))
  return { holder, root }
}

/** The arm material is recognized the way `isArmMaterial` does: surfaceBrute with no texture. */
const isArm = (m: THREE.Material) =>
  m instanceof THREE.MeshStandardMaterial && !!m.userData.surfaceBrute && !m.map

describe('muzzlePose', () => {
  it('the muzzle is the front of the barrel (the +X end of the 1 u box), centered on the other axes', () => {
    const { holder, root } = testRig()
    const out = { muzzle: new THREE.Vector3(), axis: new THREE.Vector3() }
    const ok = muzzlePose(root, holder, isArm, new THREE.Vector3(1, 0, 0), out)
    expect(ok).toBe(true)
    // The front of the box is at +0.6 (the box runs from -0.4 to +0.6 on X); the 0.01 u slice
    // and the push onto the front plane put the muzzle just under that, ~+0.6.
    expect(out.muzzle.x).toBeGreaterThan(0.5)
    expect(out.muzzle.x).toBeLessThan(0.65)
    // Centered on Y and Z (the box is symmetric on those axes).
    expect(out.muzzle.y).toBeCloseTo(0, 4)
    expect(out.muzzle.z).toBeCloseTo(0, 4)
    // The axis is the barrel's.
    expect(out.axis.x).toBeCloseTo(1, 5)
    expect(out.axis.y).toBeCloseTo(0, 5)
    expect(out.axis.z).toBeCloseTo(0, 5)
  })

  it('arm meshes are ignored', () => {
    // A scene carrying only arm meshes: no weapon mesh, no muzzle.
    const holder = new THREE.Group()
    const root = new THREE.Group()
    holder.add(root)
    const armMat = new THREE.MeshStandardMaterial()
    armMat.userData.surfaceBrute = { asg: 0 }
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1).translate(-0.5, 0, 0), armMat))
    const out = { muzzle: new THREE.Vector3(), axis: new THREE.Vector3() }
    expect(muzzlePose(root, holder, isArm, new THREE.Vector3(1, 0, 0), out)).toBe(false)
  })

  it("the muzzle does not depend on the holder's world pose (moved, rotated, scaled)", () => {
    const rest = testRig()
    const expected = { muzzle: new THREE.Vector3(), axis: new THREE.Vector3() }
    muzzlePose(rest.root, rest.holder, isArm, new THREE.Vector3(1, 0, 0), expected)
    const { holder, root } = testRig()
    holder.position.set(12, 5, -7)
    holder.quaternion.setFromEuler(new THREE.Euler(0.3, 1.1, -0.4))
    holder.scale.set(1.5, 1.5, 1)
    const out = { muzzle: new THREE.Vector3(), axis: new THREE.Vector3() }
    expect(muzzlePose(root, holder, isArm, new THREE.Vector3(1, 0, 0), out)).toBe(true)
    expect(out.muzzle.distanceTo(expected.muzzle)).toBeLessThan(1e-6)
  })

  it('counts only weapon meshes, not arms mixed in', () => {
    const { holder, root } = testRig()
    const out = { muzzle: new THREE.Vector3(), axis: new THREE.Vector3() }
    // The barrel is the only weapon mesh: the muzzle is its front, the arm does not enter into it.
    expect(muzzlePose(root, holder, isArm, new THREE.Vector3(1, 0, 0), out)).toBe(true)
    // The front of the barrel is at ~+0.6 (the box runs from -0.4 to +0.6); the arm is at the back (-0.5).
    expect(out.muzzle.x).toBeGreaterThan(0.5)
  })

  it('returns false without a weapon mesh', () => {
    const holder = new THREE.Group()
    const empty = new THREE.Group()
    holder.add(empty)
    const out = { muzzle: new THREE.Vector3(), axis: new THREE.Vector3() }
    expect(muzzlePose(empty, holder, isArm, new THREE.Vector3(1, 0, 0), out)).toBe(false)
  })
})

describe('muzzlePoseCamera', () => {
  it('with a zero grip, the muzzle in camera frame is the holder-frame point rotated by ROTATION_RIG_CAMERA', () => {
    const st = { muzzle: new THREE.Vector3(0.5, 0, 0), axis: new THREE.Vector3(1, 0, 0) }
    const out = muzzlePoseCamera(st, ZERO, new THREE.Vector3())
    const expected = new THREE.Vector3(0.5, 0, 0).applyQuaternion(ROTATION_RIG_CAMERA)
    expect(out.distanceTo(expected)).toBeLessThan(1e-9)
  })

  it('with a grip x = 0.1, the muzzle moves forward by +0.1 on the camera X', () => {
    const st = { muzzle: new THREE.Vector3(0.5, 0, 0), axis: new THREE.Vector3(1, 0, 0) }
    const zero = muzzlePoseCamera(st, ZERO, new THREE.Vector3())
    const out = muzzlePoseCamera(st, { x: 0.1, y: 0, z: 0, roll: 0 }, new THREE.Vector3())
    // The grip's offset is in camera frame, before the rig's rotation.
    expect(out.x - zero.x).toBeCloseTo(0.1, 6)
    expect(out.y - zero.y).toBeCloseTo(0, 6)
    expect(out.z - zero.z).toBeCloseTo(0, 6)
  })

  it('with a nonzero roll, the muzzle matches the point placed by applyRigGrip × ROTATION_RIG_CAMERA', () => {
    const st = { muzzle: new THREE.Vector3(0.5, 0, 0), axis: new THREE.Vector3(1, 0, 0) }
    const grip: ViewGrip = { x: 0.1, y: -0.05, z: 0.2, roll: 0.35 }
    const out = muzzlePoseCamera(st, grip, new THREE.Vector3())
    const obj = new THREE.Object3D()
    applyRigGrip(obj.position, obj.quaternion, grip)
    obj.quaternion.multiply(ROTATION_RIG_CAMERA)
    obj.updateMatrix()
    const expected = st.muzzle.clone().applyMatrix4(obj.matrix)
    expect(out.distanceTo(expected)).toBeLessThan(1e-9)
  })
})

describe('muzzleLocalPose', () => {
  it('a plain mesh: the local holder is the mesh, the point is its front, the axis is the barrel', () => {
    const { holder, root } = testRig()
    const local: MuzzleLocal = { localHolder: null as unknown as THREE.Object3D, point: new THREE.Vector3(), axis: new THREE.Vector3() }
    expect(muzzleLocalPose(root, holder, isArm, new THREE.Vector3(1, 0, 0), local)).toBe(true)
    // The local holder is the barrel mesh (the scene's only weapon mesh).
    expect(local.localHolder).toBe(root.children[0])
    // The point is the front of the barrel in the mesh's local frame, the axis is the barrel's.
    expect(local.point.x).toBeGreaterThan(0.5)
    expect(local.point.x).toBeLessThan(0.65)
    expect(local.axis.x).toBeCloseTo(1, 5)
    expect(local.axis.y).toBeCloseTo(0, 5)
  })
})

describe('muzzleLocalPose then muzzleWorldPose', () => {
  it('holder and mesh moved and rotated: the re-read world muzzle is the front of the barrel, the axis is the barrel', () => {
    const { holder, root } = testRig()
    holder.position.set(4, -2, 9)
    holder.quaternion.setFromEuler(new THREE.Euler(0.2, -0.9, 0.5))
    const barrel = root.children[0]
    barrel.position.set(0.3, 0.1, -0.2)
    barrel.quaternion.setFromEuler(new THREE.Euler(0.4, 0.6, -0.3))
    holder.updateMatrixWorld(true)
    // The barrel axis in the holder's frame: the mesh's +X axis, rotated like it.
    const holderAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(barrel.quaternion)
    const local: MuzzleLocal = { localHolder: null as unknown as THREE.Object3D, point: new THREE.Vector3(), axis: new THREE.Vector3() }
    expect(muzzleLocalPose(root, holder, isArm, holderAxis, local)).toBe(true)
    const pos = new THREE.Vector3()
    const axis = new THREE.Vector3()
    muzzleWorldPose(local.localHolder, local.point, local.axis, pos, axis)
    const expected = new THREE.Vector3(0.6, 0, 0).applyMatrix4(barrel.matrixWorld)
    expect(pos.distanceTo(expected)).toBeLessThan(1e-6)
    const expectedAxis = new THREE.Vector3(1, 0, 0).transformDirection(barrel.matrixWorld)
    expect(axis.distanceTo(expectedAxis)).toBeLessThan(1e-6)
  })
})

describe('muzzleWorldPose', () => {
  it('the world muzzle follows the mesh when it is moved and rotated', () => {
    const holder = new THREE.Group()
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.2).translate(0.1, 0, 0), new THREE.MeshStandardMaterial())
    holder.add(barrel)
    const point = new THREE.Vector3(0.6, 0, 0) // the front, in the mesh's local frame
    const axis = new THREE.Vector3(1, 0, 0)
    barrel.position.set(2, 3, -4)
    barrel.rotation.z = 0.7
    const pos = new THREE.Vector3()
    const outAxis = new THREE.Vector3()
    muzzleWorldPose(barrel, point, axis, pos, outAxis)
    const expected = point.clone().applyMatrix4(barrel.matrixWorld)
    expect(pos.distanceTo(expected)).toBeLessThan(1e-9)
    expect(outAxis.length()).toBeCloseTo(1, 9)
  })

  it('the holder moved, rotated and scaled (1.5,1.5,1): the world muzzle = the front of the mesh transformed by the whole chain', () => {
    const holder = new THREE.Group()
    holder.position.set(12, 5, -7)
    holder.quaternion.setFromEuler(new THREE.Euler(0.3, 1.1, -0.4))
    holder.scale.set(1.5, 1.5, 1)
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.2).translate(0.1, 0, 0), new THREE.MeshStandardMaterial())
    holder.add(barrel)
    const point = new THREE.Vector3(0.6, 0, 0)
    const axis = new THREE.Vector3(1, 0, 0)
    const pos = new THREE.Vector3()
    const outAxis = new THREE.Vector3()
    muzzleWorldPose(barrel, point, axis, pos, outAxis)
    const expected = point.clone().applyMatrix4(barrel.matrixWorld)
    expect(pos.distanceTo(expected)).toBeLessThan(1e-9)
  })
})
