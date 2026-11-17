// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * muzzle3d.ts — THE MUZZLE OF THE HELD WEAPON, where the 3D scene's shots leave from.
 *
 * A shot leaves from the barrel of the model the shooter's Spartan holds on the shot's frame: that
 * frame's pose (shot heading, pitch, that frame's game clips) is replayed on a bone-only copy,
 * never drawn (`MuzzleProbe`), and the muzzle is the front of the model's box along the barrel,
 * carried the way the avatar carries it (`GRIP_TO_WEAPON` on `b_r_grip`). The result only depends
 * on the shot's frame: the layer computes it once per shot. In first person, the weapon is carried
 * by the aim cone the way `viewGrip3d` holds it (`viewMuzzle`).
 *
 * The flash itself sits at the end of the model the scene draws on the shown frame (`drawnMuzzle`):
 * it follows the weapon on screen, whatever the camera.
 */
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import { GRIP_TO_WEAPON, MODEL_TURN, type DrawnWeapon } from './avatar3d'
import { poseSpartan, type SpartanPose, type SpartanRig } from './pose3d'
import { recoilActive, type Recoil } from './recoil3d'
import { recoilArms, recoilPoint } from './recoilPose3d'
import { rigOf } from './spartan3d'
import type { ViewGrip } from './viewGrip3d'

const muzzles = new WeakMap<THREE.Object3D, THREE.Vector3>()
const toLocal = new THREE.Matrix4()

// The thickness of the model's front slice whose center makes the muzzle (u, ~3 cm): the tip of
// the barrel, not the middle of the cross-section (a magazine under the weapon would pull it down).
const MUZZLE_SLICE = 0.01

/**
 * muzzleOfModel: a weapon model's muzzle in its own frame (X toward the muzzle, origin at the
 * grip): the point furthest forward along the barrel, centered on the vertices of the front slice
 * (`MUZZLE_SLICE`). Once per model.
 */
export function muzzleOfModel(model: THREE.Object3D): THREE.Vector3 {
  const known = muzzles.get(model)
  if (known) return known
  // Vertex by vertex, in the model's own frame: a world-space box brought back later would be inflated.
  let front = -Infinity
  forEachVertex(model, (v) => {
    front = Math.max(front, v.x)
  })
  const sum = new THREE.Vector3()
  let n = 0
  forEachVertex(model, (v) => {
    if (v.x < front - MUZZLE_SLICE) return
    sum.add(v)
    n++
  })
  const m = n === 0 ? new THREE.Vector3() : sum.divideScalar(n).setX(front)
  muzzles.set(model, m)
  return m
}

/** forEachVertex: every vertex of `model`'s meshes, in `model`'s own frame. */
function forEachVertex(model: THREE.Object3D, visit: (v: THREE.Vector3) => void): void {
  model.updateMatrixWorld(true)
  toLocal.copy(model.matrixWorld).invert()
  const rel = new THREE.Matrix4()
  const v = new THREE.Vector3()
  model.traverse((o) => {
    const pos = o instanceof THREE.Mesh ? (o.geometry as THREE.BufferGeometry).getAttribute('position') : undefined
    if (!pos) return
    rel.multiplyMatrices(toLocal, o.matrixWorld)
    for (let i = 0; i < pos.count; i++) visit(v.fromBufferAttribute(pos, i).applyMatrix4(rel))
  })
}

/**
 * muzzleWorld: the world-space muzzle of a weapon held by the grip bone at `grip` (world),
 * with world orientation `gripQ`: the weapon is carried the way the avatar carries it
 * (`GRIP_TO_WEAPON`).
 */
export function muzzleWorld(grip: THREE.Vector3, gripQ: THREE.Quaternion, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(local).applyQuaternion(GRIP_TO_WEAPON).applyQuaternion(gripQ).add(grip)
}

/**
 * drawnMuzzle: the muzzle (world, in `pos`) and the barrel axis (world, unit, in `barrel`) of the
 * drawn weapon model `drawn`, wherever the last pose placed it, in first person as in third.
 */
export function drawnMuzzle(drawn: DrawnWeapon, pos: THREE.Vector3, barrel: THREE.Vector3): void {
  drawn.model.updateWorldMatrix(true, false)
  const m = drawn.model.matrixWorld
  pos.copy(muzzleOfModel(drawn.source)).applyMatrix4(m)
  barrel.setFromMatrixColumn(m, 0).normalize()
}

const aimBasis = new THREE.Matrix4()
const aimQ = new THREE.Quaternion()
const turnQ = new THREE.Quaternion()
const gripAt = new THREE.Vector3()
const ORIGIN = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
// The aim axis in the cone's own frame: the first-person carry rolls around it.
const AIM_AXIS = new THREE.Vector3(0, 0, 1)

/**
 * viewMuzzle: the world-space muzzle of the weapon held in first person, placed the way
 * `showWeapon` places it: carried by the aim cone, which starts at eye `eye` and looks along `dir`
 * (unit), in carry `view` (`viewGrip3d`), rotated by `MODEL_TURN`; `local`: the muzzle in the
 * model's own frame, shifted by the frame's recoil (`recoilPoint`) when the weapon is recoiling,
 * the way `showWeapon` shifts it.
 */
export function viewMuzzle(eye: THREE.Vector3, dir: THREE.Vector3, view: ViewGrip, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  // The cone looks the way `Object3D.lookAt` turns it: its +Z toward the target.
  aimQ.setFromRotationMatrix(aimBasis.lookAt(dir, ORIGIN, UP))
  turnQ.setFromAxisAngle(AIM_AXIS, view.roll).multiply(MODEL_TURN)
  return out.copy(local).applyQuaternion(turnQ).add(gripAt.set(view.x, view.y, view.z)).applyQuaternion(aimQ).add(eye)
}

/**
 * MuzzleProbe — a copy of the Spartan's bones (no mesh), posed on demand to read where the right
 * hand holds the weapon at a given frame. Every call starts over from rest (`poseSpartan`): no
 * state carries from one shot to the next.
 */
export class MuzzleProbe {
  private source: THREE.Object3D | null = null
  private rig: SpartanRig | null = null
  private readonly grip = new THREE.Vector3()
  private readonly gripQ = new THREE.Quaternion()
  private readonly kicked = new THREE.Vector3()

  /**
   * at: the muzzle (three axes) of `weapon` held by Spartan `source`, feet at `feet`, in pose
   * `pose` (heading, pitch, that shot frame's clips, weapon recoil placed the way the avatar
   * places it); null if `source` does not have the Spartan's bones.
   */
  at(
    source: THREE.Object3D,
    weapon: THREE.Object3D,
    feet: THREE.Vector3,
    pose: SpartanPose & { recoil?: Recoil | null },
    out: THREE.Vector3,
  ): THREE.Vector3 | null {
    if (source !== this.source) this.rebuild(source)
    const rig = this.rig
    if (!rig) return null
    rig.root.position.copy(feet)
    poseSpartan(rig, pose)
    let local = muzzleOfModel(weapon)
    if (recoilActive(pose.recoil) && !recoilArms(rig.arms, rig.rightGrip, GRIP_TO_WEAPON, pose.recoil)) {
      local = recoilPoint(local, pose.recoil, this.kicked)
    }
    rig.rightGrip.getWorldPosition(this.grip)
    rig.rightGrip.getWorldQuaternion(this.gripQ)
    return muzzleWorld(this.grip, this.gripQ, local, out)
  }

  private rebuild(source: THREE.Object3D): void {
    this.source = source
    const root = cloneSkinned(source)
    // Bones only: the copied meshes and their skeletons serve no purpose here.
    const meshes: THREE.SkinnedMesh[] = []
    root.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) meshes.push(o)
    })
    for (const m of meshes) {
      m.skeleton.dispose()
      m.removeFromParent()
    }
    this.rig = rigOf(root, source)
  }
}
